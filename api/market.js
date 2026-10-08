const PRIMARY = "https://yfin-h.tigzig.com/v1/get-all-prices/";
const YAHOO_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
const CACHE_MS = 30_000;
const YAHOO_TIMEOUT_MS = 2_500;
const PRIMARY_TIMEOUT_MS = 3_000;
const MAX_CONCURRENT = 12;

const cache = new Map();
const inFlight = new Map();

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function daysForRange(range) {
  return { "5d": 10, "1mo": 45, "3mo": 120, "6mo": 220, "1y": 400 }[range] || 10;
}

async function getJson(url, timeoutMs, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Provider returned ${response.status}`);
    return JSON.parse(body);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeBars(raw, symbol) {
  const rows = [];
  for (const [date, day] of Object.entries(raw || {})) {
    const item = day?.[symbol];
    if (!item) continue;
    const close = Number(item.Close);
    if (!Number.isFinite(close) || close <= 0) continue;
    const open = Number(item.Open);
    const high = Number(item.High);
    const low = Number(item.Low);
    const volume = Number(item.Volume);
    rows.push({
      date,
      open: Number.isFinite(open) ? open : null,
      high: Number.isFinite(high) ? high : null,
      low: Number.isFinite(low) ? low : null,
      close,
      volume: Number.isFinite(volume) ? volume : null,
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

function quoteFromBars(symbol, bars, provider) {
  if (bars.length < 2) throw new Error("Provider returned insufficient history");
  const last = bars[bars.length - 1];
  const previous = bars[bars.length - 2];
  const closes = bars.map((bar) => bar.close);
  if (!Number.isFinite(previous.close) || previous.close <= 0) {
    throw new Error("Provider returned an invalid previous close");
  }
  return {
    symbol,
    price: last.close,
    prev: previous.close,
    change: last.close - previous.close,
    changePct: ((last.close - previous.close) / previous.close) * 100,
    open: Number.isFinite(last.open) ? last.open : null,
    closes,
    timestamps: bars.map((bar) => Math.floor(Date.parse(`${bar.date}T00:00:00Z`) / 1000)),
    opens: bars.map((bar) => bar.open),
    highs: bars.map((bar) => bar.high),
    lows: bars.map((bar) => bar.low),
    volumes: bars.map((bar) => bar.volume),
    high: last.high,
    low: last.low,
    vol: last.volume,
    high52: Math.max(...closes),
    low52: Math.min(...closes),
    provider,
  };
}

async function primaryBatch(symbols, range) {
  const end = new Date();
  const start = new Date(end.getTime() - daysForRange(range) * 86_400_000);
  const url = `${PRIMARY}?tickers=${encodeURIComponent(symbols.join(","))}&start_date=${isoDate(start)}&end_date=${isoDate(end)}&format=json`;
  const json = await getJson(url, PRIMARY_TIMEOUT_MS, { "User-Agent": "Mozilla/5.0" });
  const result = new Map();
  for (const symbol of symbols) {
    const bars = normalizeBars(json, symbol);
    try {
      result.set(symbol, quoteFromBars(symbol, bars, "yfin-h"));
    } catch {
      // A provider can omit individual symbols from an otherwise valid batch.
    }
  }
  return result;
}

function chartBars(result) {
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  return timestamps
    .map((timestamp, index) => ({
      timestamp,
      open: quote.open?.[index] ?? null,
      high: quote.high?.[index] ?? null,
      low: quote.low?.[index] ?? null,
      close: quote.close?.[index] ?? null,
      volume: quote.volume?.[index] ?? null,
    }))
    .filter((bar) => Number.isFinite(bar.close));
}

async function yahoo(symbol, range) {
  let lastError;
  for (const host of YAHOO_HOSTS) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${encodeURIComponent(range)}&events=history`;
      const json = await getJson(url, YAHOO_TIMEOUT_MS);
      const result = json?.chart?.result?.[0];
      const bars = chartBars(result);
      if (bars.length < 2) throw new Error("Yahoo returned insufficient history");
      const meta = result.meta || {};
      const latest = bars[bars.length - 1];
      const previous = bars[bars.length - 2];
      const price = Number.isFinite(meta.regularMarketPrice) ? meta.regularMarketPrice : latest.close;
      // chartPreviousClose can refer to the beginning of the requested range
      // (for example, one year ago), not the previous trading session.
      const prev = previous.close;
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(prev) || prev <= 0) {
        throw new Error("Yahoo returned an invalid quote");
      }
      const closes = bars.map((bar) => bar.close);
      return {
        symbol,
        price,
        prev,
        change: price - prev,
        changePct: ((price - prev) / prev) * 100,
        open: Number.isFinite(meta.regularMarketOpen) ? meta.regularMarketOpen : latest.open,
        closes,
        timestamps: bars.map((bar) => bar.timestamp),
        opens: bars.map((bar) => bar.open),
        highs: bars.map((bar) => bar.high),
        lows: bars.map((bar) => bar.low),
        volumes: bars.map((bar) => bar.volume),
        high: Number.isFinite(meta.regularMarketDayHigh) ? meta.regularMarketDayHigh : latest.high,
        low: Number.isFinite(meta.regularMarketDayLow) ? meta.regularMarketDayLow : latest.low,
        vol: Number.isFinite(meta.regularMarketVolume) ? meta.regularMarketVolume : latest.volume,
        high52: Number.isFinite(meta.fiftyTwoWeekHigh) ? meta.fiftyTwoWeekHigh : Math.max(...closes),
        low52: Number.isFinite(meta.fiftyTwoWeekLow) ? meta.fiftyTwoWeekLow : Math.min(...closes),
        provider: "yahoo",
      };
    } catch (error) {
      lastError = error;
      if (error?.name === "AbortError") break;
    }
  }
  throw lastError || new Error("Market providers unavailable");
}

async function loadFallback(symbol, range) {
  const key = `${symbol}|${range}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.time < CACHE_MS) return cached.data;
  if (inFlight.has(key)) return inFlight.get(key);

  const promise = yahoo(symbol, range);
  inFlight.set(key, promise);
  try {
    const data = await promise;
    cache.set(key, { time: Date.now(), data });
    return data;
  } finally {
    inFlight.delete(key);
  }
}

async function yahooBatch(symbols, range) {
  const result = new Map();
  let cursor = 0;
  const worker = async () => {
    while (cursor < symbols.length) {
      const symbol = symbols[cursor++];
      try {
        result.set(symbol, await loadFallback(symbol, range));
      } catch {
        // Missing quotes are collected and sent to the batch fallback below.
      }
    }
  };
  const workerCount = Math.min(MAX_CONCURRENT, symbols.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return result;
}

export default async function handler(req, res) {
  const raw = String(req.query?.symbols || "");
  const range = String(req.query?.range || "5d");
  if (!raw) return res.status(400).json({ error: "Missing symbols" });
  if (!["5d", "1mo", "3mo", "6mo", "1y"].includes(range)) {
    return res.status(400).json({ error: "Invalid range" });
  }

  const symbols = [...new Set(raw.split(",").map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => /^[A-Z0-9^=_-]+\.(NS|BO)$/.test(symbol) || /^[A-Z0-9^=_-]+$/.test(symbol)))].slice(0, 30);
  if (!symbols.length) return res.status(400).json({ error: "No valid symbols" });

  const quotesBySymbol = await yahooBatch(symbols, range);
  const missing = symbols.filter((symbol) => !quotesBySymbol.has(symbol));
  if (missing.length) {
    try {
      const primary = await primaryBatch(missing, range);
      for (const [symbol, quote] of primary) quotesBySymbol.set(symbol, quote);
    } catch (error) {
      console.warn("[market] Batch fallback failed", { count: missing.length, message: error.message });
    }
  }

  const quotes = symbols.map((symbol) => quotesBySymbol.get(symbol)).filter(Boolean);
  const unavailableSymbols = symbols.filter((symbol) => !quotesBySymbol.has(symbol));
  if (!quotes.length) {
    console.warn("[market] No quote data returned", { range, count: symbols.length });
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ quotes: [], error: "Market data is temporarily unavailable" });
  }

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
  if (unavailableSymbols.length) {
    console.warn("[market] Partial quote response", { range, unavailableSymbols });
  }
  return res.status(200).json({ quotes, unavailableSymbols });
}

