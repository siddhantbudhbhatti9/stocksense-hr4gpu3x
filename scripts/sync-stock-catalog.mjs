import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

const NSE_URL = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv";
const BSE_URL = "https://api.bseindia.com/BseIndiaAPI/api/ListofScripData_new/w?Group=&Scripcode=&segment=Equity&status=Active&scripName=";
const USER_AGENT = "StockSense/1.0 (+https://stocksense-hr4gpu3x.vercel.app)";
const YAHOO_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9",
};
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 800;
const DATA_URL = process.env.STOCK_DATA_URL || "https://github.com/siddhantbudhbhatti9/stocksense-hr4gpu3x/releases/latest/download/stock-data.json.gz";

const isoDate = (date) => date.toISOString().slice(0, 10);
function todayIST() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function addDays(dateText, days) {
  if (!dateText) return null;
  const date = new Date(`${dateText}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}
const normalized = (value) => String(value || "").trim().toUpperCase();
const isinValid = (value) => /^IN[A-Z0-9]{10}$/.test(normalized(value));

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  const headers = (rows.shift() || []).map((value) => value.trim().toUpperCase());
  return rows.filter((values) => values.some((value) => value.trim())).map((values) => Object.fromEntries(headers.map((header, index) => [header, (values[index] || "").trim()])));
}

function parseNseDate(value) {
  const match = String(value || "").trim().match(/^(\d{1,2})-([A-Z]{3})-(\d{4})$/i);
  if (!match) return null;
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const month = months.indexOf(match[2].toUpperCase());
  if (month < 0) return null;
  return `${match[3]}-${String(month + 1).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`;
}

async function fetchWithRetry(url, { headers = {}, timeoutMs = 12_000, attempts = MAX_RETRIES + 1 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { headers, cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("Request failed");
}

function normalizeNse(text) {
  const records = parseCsv(text).flatMap((row) => {
    const symbol = normalized(row.SYMBOL);
    const isin = normalized(row["ISIN NUMBER"]);
    const company = String(row["NAME OF COMPANY"] || "").trim();
    if (!symbol || !company || !isinValid(isin)) return [];
    return [{
      exchange: "NSE",
      symbol,
      yahooTicker: `${symbol}.NS`,
      isin,
      company,
      series: normalized(row.SERIES) || null,
      listingDate: parseNseDate(row["DATE OF LISTING"]),
      status: "active",
      sourceStatus: "listed",
    }];
  });
  if (records.length < 500) throw new Error(`NSE file validation failed (${records.length} rows)`);
  return records;
}

function normalizeBse(text) {
  const rows = JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error("BSE list was not an array");
  const records = rows.flatMap((row) => {
    const isin = normalized(row.ISIN_NUMBER);
    const scripCode = String(row.SCRIP_CD || "").trim();
    const symbol = normalized(row.scrip_id || scripCode);
    const company = String(row.Issuer_Name || row.Scrip_Name || "").trim();
    const status = normalized(row.Status) === "ACTIVE" ? "active" : "inactive";
    if (!isinValid(isin) || !scripCode || !symbol || !company) return [];
    return [{
      exchange: "BSE",
      symbol,
      scripCode,
      yahooTicker: `${scripCode}.BO`,
      isin,
      company,
      series: normalized(row.GROUP) || null,
      listingDate: null,
      status,
      sourceStatus: normalized(row.Status) || "unknown",
    }];
  });
  if (records.length < 1000) throw new Error(`BSE file validation failed (${records.length} rows)`);
  return records;
}

function validateFeedSize(exchange, records, previous) {
  const priorActive = (previous.stocks || []).reduce((count, stock) => count + (stock.listings || []).filter((listing) => listing.exchange === exchange && listing.status === "active").length, 0);
  if (priorActive >= 1000 && records.length < priorActive * 0.8) {
    throw new Error(`${exchange} feed unexpectedly shrank from ${priorActive} active listings to ${records.length}; keeping the previous snapshot`);
  }
  return records;
}

function keyFor(record) { return record.isin || `${record.exchange}:${record.symbol}`; }
function listingKey(record) { return `${record.exchange}:${record.yahooTicker}:${record.series || ""}`; }
function noticeId(kind, stock) { return createHash("sha1").update(`${kind}|${stock.id}`).digest("hex").slice(0, 16); }
function createNotice(kind, stock, message, missingData = []) {
  return {
    id: noticeId(kind, stock),
    kind,
    title: kind === "new-listing" ? "New listing" : kind === "data-live" ? "Stock data is live" : "Data delayed",
    message,
    symbol: stock.yahooTicker,
    company: stock.company,
    exchange: stock.exchange,
    listingDate: stock.listing_date || null,
    expectedDate: stock.data_available_from || null,
    missingData,
    createdAt: new Date().toISOString(),
  };
}

function groupListings(latest, previous, runDate) {
  const oldById = new Map((previous.stocks || []).map((stock) => [stock.id || stock.isin, stock]));
  const grouped = new Map();
  for (const listing of latest) {
    const id = keyFor(listing);
    if (!grouped.has(id)) grouped.set(id, []);
    const records = grouped.get(id);
    const key = listingKey(listing);
    if (!records.some((item) => listingKey(item) === key)) records.push(listing);
  }

  let added = 0;
  let reactivated = 0;
  let removed = 0;
  const notifications = [...(previous.notifications || [])];
  const stocks = [];
  const allIds = new Set([...grouped.keys(), ...oldById.keys()]);

  for (const id of allIds) {
    const old = oldById.get(id);
    const sourceListings = grouped.get(id) || [];
    const oldListings = old?.listings || [];
    const seenKeys = new Set(sourceListings.map(listingKey));
    const listings = sourceListings.map((listing) => {
      const oldListing = oldListings.find((item) => listingKey(item) === listingKey(listing));
      return { ...listing, missingRuns: 0, status: listing.status };
    });
    for (const oldListing of oldListings) {
      if (seenKeys.has(listingKey(oldListing))) continue;
      const missingRuns = (oldListing.missingRuns || 0) + (sourceListings.length || latest.length ? 1 : 0);
      const status = missingRuns >= 3 ? "inactive" : oldListing.status || "active";
      listings.push({ ...oldListing, missingRuns, status });
    }
    if (!listings.length) continue;

    const activeListings = listings.filter((item) => item.status === "active");
    const sorted = [...listings].sort((a, b) => (a.exchange === "NSE" ? -1 : 1) - (b.exchange === "NSE" ? -1 : 1));
    const primary = [...activeListings].sort((a, b) => (a.exchange === "NSE" ? -1 : 1) - (b.exchange === "NSE" ? -1 : 1))[0] || sorted[0];
    const nseDate = listings.filter((item) => item.exchange === "NSE" && item.listingDate).map((item) => item.listingDate).sort()[0] || null;
    const listingDate = nseDate || old?.listing_date || null;
    const isNew = !old;
    if (isNew) added++;
    if (old?.status === "inactive" && activeListings.length) reactivated++;
    const status = activeListings.length ? "active" : "inactive";
    if (old?.status === "active" && status === "inactive") removed++;

    const dateAdded = old?.date_added || runDate;
    // BSE's public equity scrip endpoint does not provide a listing date. For a
    // first-seen BSE-only issue, wait 14 days from detection without inventing a
    // listing date; the source of the availability date remains explicit.
    const availabilitySource = listingDate ? "exchange_listing_date" : old?.data_available_from_source || (isNew ? "first_seen_on_bse_feed" : null);
    const dataAvailableFrom = listingDate ? addDays(listingDate, 14) : old?.data_available_from || (isNew ? addDays(runDate, 14) : null);
    const stillInWait = dataAvailableFrom && dataAvailableFrom > runDate;
    // A newly discovered record must get a successful Yahoo snapshot before it
    // is marked ready, even when its exchange listing date is already 14 days old.
    const dataReady = stillInWait ? false : (old ? Boolean(old.data_ready) : false);
    const stock = {
      id,
      symbol: primary.symbol,
      company: listings.find((item) => item.exchange === "NSE")?.company || primary.company,
      exchange: primary.exchange,
      isin: primary.isin || null,
      series: primary.series || null,
      listing_date: listingDate,
      listing_date_source: listingDate ? "NSE EQUITY_L.csv" : null,
      yahoo_ticker: primary.yahooTicker,
      status,
      date_added: dateAdded,
      data_ready: dataReady,
      data_available_from: dataAvailableFrom,
      data_available_from_source: availabilitySource,
      data_status: stillInWait ? "new_listing" : dataReady ? "ready" : old?.data_status || "pending",
      missing_data: old?.missing_data || [],
      delayed_notification_sent_at: old?.delayed_notification_sent_at || null,
      live_notification_sent_at: old?.live_notification_sent_at || null,
      last_data_attempt_at: old?.last_data_attempt_at || null,
      listings,
    };
    stocks.push(stock);

    if (isNew && (!listingDate || dataAvailableFrom > runDate)) {
      const listedText = listingDate
        ? `was listed on ${listingDate}`
        : `was first detected on ${runDate} in the BSE active scrip feed; BSE does not publish the listing date in that feed`;
      notifications.push(createNotice(
        "new-listing",
        stock,
        `${stock.company} (${primary.exchange}) ${listedText}. Fundamental and technical data are unavailable during the 14-day new-listing period. Real data is expected after ${dataAvailableFrom || "the listing date is confirmed"}.`,
        ["technical", "fundamental"],
      ));
    }
  }
  return { stocks, notifications: notifications.slice(-500), added, removed, reactivated };
}

async function timedText(url, options = {}) {
  return fetchWithRetry(url, options);
}

function captureCookies(response, jar) {
  const cookieHeaders = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") || ""];
  for (const header of cookieHeaders) {
    for (const match of header.matchAll(/(?:^|,\s*)([A-Za-z0-9!#$%&'*+.^_`|~-]+)=([^;,\s]+)/g)) {
      if (match[2]) jar.set(match[1], match[2]);
    }
  }
}

let yahooSessionCache = null;
let yahooSessionPromise = null;
async function yahooSession() {
  if (yahooSessionCache) return yahooSessionCache;
  if (yahooSessionPromise) return yahooSessionPromise;
  yahooSessionPromise = (async () => {
  const jar = new Map();
  let url = "https://fc.yahoo.com";
  for (let i = 0; i < 6; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    let response;
    try { response = await fetch(url, { headers: YAHOO_HEADERS, redirect: "manual", signal: controller.signal }); }
    finally { clearTimeout(timer); }
    captureCookies(response, jar);
    const redirect = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !redirect) break;
    const next = new URL(redirect, url);
    if (next.protocol !== "https:" || !(next.hostname === "yahoo.com" || next.hostname.endsWith(".yahoo.com"))) throw new Error("Yahoo cookie redirect was rejected");
    url = next.href;
  }
  const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  if (!cookie) throw new Error("Yahoo did not issue a data cookie");
  const crumb = (await timedText("https://query1.finance.yahoo.com/v1/test/getcrumb", { headers: { ...YAHOO_HEADERS, Cookie: cookie }, timeoutMs: 7000 })).trim();
  if (!crumb || crumb.includes("Too Many Requests") || /<html/i.test(crumb)) throw new Error("Yahoo data crumb unavailable");
  return { cookie, crumb };
  })();
  try {
    yahooSessionCache = await yahooSessionPromise;
    return yahooSessionCache;
  } finally {
    yahooSessionPromise = null;
  }
}

function rawNumber(value) {
  const number = typeof value === "number" ? value : value?.raw;
  return Number.isFinite(number) ? number : null;
}

async function fetchYahooSnapshot(stock) {
  const ticker = stock.yahoo_ticker;
  const session = await yahooSession();
  const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5y&interval=1d&events=history`;
  const quoteUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}&crumb=${encodeURIComponent(session.crumb)}`;
  const summaryUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=price,summaryDetail,defaultKeyStatistics,financialData&crumb=${encodeURIComponent(session.crumb)}`;
  const yahooHeaders = { ...YAHOO_HEADERS, Cookie: session.cookie };
  const results = await Promise.allSettled([
    timedText(chartUrl, { headers: yahooHeaders, timeoutMs: 12_000 }),
    timedText(quoteUrl, { headers: yahooHeaders, timeoutMs: 12_000 }),
    timedText(summaryUrl, { headers: yahooHeaders, timeoutMs: 12_000 }),
  ]);
  let chart = null, quote = null, summary = null;
  if (results[0].status === "fulfilled") {
    const json = JSON.parse(results[0].value);
    const result = json?.chart?.result?.[0];
    const values = result?.indicators?.quote?.[0] || {};
    const timestamps = result?.timestamp || [];
    const bars = timestamps.map((timestamp, index) => ({
      date: isoDate(new Date(timestamp * 1000)),
      open: Number.isFinite(values.open?.[index]) ? values.open[index] : null,
      high: Number.isFinite(values.high?.[index]) ? values.high[index] : null,
      low: Number.isFinite(values.low?.[index]) ? values.low[index] : null,
      close: Number.isFinite(values.close?.[index]) ? values.close[index] : null,
      volume: Number.isFinite(values.volume?.[index]) ? values.volume[index] : null,
    })).filter((bar) => Number.isFinite(bar.close)).slice(-1260);
    if (bars.length >= 2) chart = { bars, currency: result?.meta?.currency || null, exchange: result?.meta?.fullExchangeName || null };
  }
  if (results[1].status === "fulfilled") {
    const json = JSON.parse(results[1].value);
    quote = json?.quoteResponse?.result?.find((item) => item.symbol?.toUpperCase() === ticker.toUpperCase()) || null;
  }
  if (results[2].status === "fulfilled") {
    const json = JSON.parse(results[2].value);
    summary = json?.quoteSummary?.result?.[0] || null;
  }

  const quoteValid = Boolean(quote && quote.symbol);
  const summaryValid = Boolean(summary);
  const technicalAvailable = Boolean(chart && chart.bars.length >= 2);
  const fundamentalsAvailable = quoteValid || summaryValid;
  const sd = summary?.summaryDetail || {};
  const ks = summary?.defaultKeyStatistics || {};
  const fd = summary?.financialData || {};
  const fundamentals = {
    marketCap: rawNumber(quote?.marketCap) ?? rawNumber(sd.marketCap),
    trailingPE: rawNumber(quote?.trailingPE) ?? rawNumber(sd.trailingPE),
    priceToBook: rawNumber(quote?.priceToBook) ?? rawNumber(ks.priceToBook),
    eps: rawNumber(quote?.epsTrailingTwelveMonths) ?? rawNumber(ks.trailingEps),
    bookValue: rawNumber(quote?.bookValue) ?? rawNumber(ks.bookValue),
    dividendYield: rawNumber(quote?.dividendYield) ?? rawNumber(sd.dividendYield),
    beta: rawNumber(quote?.beta) ?? rawNumber(ks.beta),
    returnOnEquity: rawNumber(fd.returnOnEquity),
    profitMargins: rawNumber(fd.profitMargins),
    totalRevenue: rawNumber(fd.totalRevenue),
    netIncome: rawNumber(fd.netIncomeToCommon),
    totalDebt: rawNumber(fd.totalDebt),
    freeCashFlow: rawNumber(fd.freeCashflow),
  };
  const latest = chart?.bars?.at(-1) || null;
  return {
    ticker,
    fetchedAt: new Date().toISOString(),
    source: "Yahoo Finance chart, quote and fundamentals endpoints",
    quoteAvailable: quoteValid || technicalAvailable,
    technicalAvailable,
    fundamentalsAvailable,
    missingData: [!technicalAvailable && "technical", !fundamentalsAvailable && "fundamental"].filter(Boolean),
    errors: results.flatMap((result, index) => result.status === "rejected" ? [`${["chart", "quote", "fundamentals"][index]}: ${result.reason?.message || result.reason}`] : []),
    quote: {
      price: rawNumber(quote?.regularMarketPrice) ?? latest?.close ?? null,
      previousClose: rawNumber(quote?.regularMarketPreviousClose) ?? null,
      open: rawNumber(quote?.regularMarketOpen) ?? latest?.open ?? null,
      high: rawNumber(quote?.regularMarketDayHigh) ?? latest?.high ?? null,
      low: rawNumber(quote?.regularMarketDayLow) ?? latest?.low ?? null,
      volume: rawNumber(quote?.regularMarketVolume) ?? latest?.volume ?? null,
      high52: rawNumber(quote?.fiftyTwoWeekHigh),
      low52: rawNumber(quote?.fiftyTwoWeekLow),
    },
    fundamentals,
    bars: chart?.bars || [],
  };
}

async function readPrevious() {
  try {
    const response = await fetch(DATA_URL, { headers: { "User-Agent": USER_AGENT, Accept: "application/octet-stream" }, cache: "no-store" });
    if (response.ok) {
      const bytes = Buffer.from(await response.arrayBuffer());
      const parsed = JSON.parse(gunzipSync(bytes, { maxOutputLength: 120_000_000 }).toString("utf8"));
      if (Array.isArray(parsed.stocks)) return parsed;
    }
  } catch { /* First run or unavailable release; use the repository seed. */ }
  try {
    const seed = JSON.parse(await readFile(new URL("../data/stocks.json", import.meta.url), "utf8"));
    if (Array.isArray(seed.stocks)) return { ...seed, notifications: seed.notifications || [], marketData: seed.marketData || {}, runLogs: seed.runLogs || [] };
  } catch { /* The repo seed is optional before the first initialization. */ }
  return { stocks: [], notifications: [], marketData: {}, runLogs: [] };
}

async function concurrencyMap(items, concurrency, fn) {
  const output = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try { output[index] = await fn(items[index]); }
      catch (error) { output[index] = { error: error?.message || String(error) }; }
    }
  }));
  return output;
}

async function main() {
  const startedAt = new Date().toISOString();
  const runDate = todayIST();
  const errors = [];
  const [previous, nseFetch, bseFetch] = await Promise.all([
    readPrevious(),
    fetchWithRetry(NSE_URL, { headers: { "User-Agent": YAHOO_HEADERS["User-Agent"], Accept: "text/csv,*/*" } }).then((text) => ({ text })).catch((error) => ({ error: error?.message || String(error) })),
    fetchWithRetry(BSE_URL, { headers: { ...YAHOO_HEADERS, Referer: "https://www.bseindia.com/", Accept: "application/json, text/plain, */*" } }).then((text) => ({ text })).catch((error) => ({ error: error?.message || String(error) })),
  ]);
  let nse = null, bse = null;
  if (nseFetch.text) { try { nse = validateFeedSize("NSE", normalizeNse(nseFetch.text), previous); } catch (error) { errors.push(`NSE: ${error.message}`); } }
  else errors.push(`NSE: ${nseFetch.error}`);
  if (bseFetch.text) { try { bse = validateFeedSize("BSE", normalizeBse(bseFetch.text), previous); } catch (error) { errors.push(`BSE: ${error.message}`); } }
  else errors.push(`BSE: ${bseFetch.error}`);

  let merged = { stocks: previous.stocks || [], notifications: previous.notifications || [], added: 0, removed: 0, reactivated: 0 };
  if (nse || bse) {
    const latest = [...(nse || []), ...(bse || [])];
    // An unavailable exchange feed must not make its securities look delisted.
    const sourcesAvailable = new Set([...(nse ? ["NSE"] : []), ...(bse ? ["BSE"] : [])]);
    if (nse || bse) {
      const oldWithFilteredListings = {
        ...previous,
        stocks: (previous.stocks || []).map((stock) => ({
          ...stock,
          listings: (stock.listings || []).filter((listing) => sourcesAvailable.has(listing.exchange)),
        })),
      };
      merged = groupListings(latest, oldWithFilteredListings, runDate);
      // Preserve records/listings from an exchange whose official feed failed.
      if (sourcesAvailable.size < 2) {
        const currentIds = new Set(merged.stocks.map((stock) => stock.id));
        for (const old of previous.stocks || []) {
          const retained = (old.listings || []).filter((item) => !sourcesAvailable.has(item.exchange));
          if (!retained.length) continue;
          const existing = merged.stocks.find((stock) => stock.id === old.id);
          if (existing) {
            existing.listings.push(...retained);
            existing.status = existing.listings.some((item) => item.status === "active") ? "active" : "inactive";
            if (!existing.listing_date) existing.listing_date = old.listing_date || null;
          } else if (!currentIds.has(old.id)) merged.stocks.push(old);
        }
      }
    }
  }

  const marketData = { ...(previous.marketData || {}) };
  const due = merged.stocks.filter((stock) => !stock.data_ready && stock.status === "active" && stock.data_available_from && stock.data_available_from <= runDate);
  let attempted = 0;
  let ready = 0;
  const snapshots = await concurrencyMap(due, 2, async (stock) => {
    attempted++;
    return { stockId: stock.id, result: await fetchYahooSnapshot(stock) };
  });
  for (let i = 0; i < snapshots.length; i++) {
    const outcome = snapshots[i];
    const stock = due[i];
    stock.last_data_attempt_at = new Date().toISOString();
    if (outcome?.error) {
      errors.push(`${stock.yahoo_ticker}: ${outcome.error}`);
      stock.missing_data = ["technical", "fundamental"];
    } else {
      const snapshot = outcome.result;
      for (const endpointError of snapshot.errors || []) errors.push(`${stock.yahoo_ticker} ${endpointError}`);
      if (snapshot.technicalAvailable || snapshot.fundamentalsAvailable) marketData[stock.id] = snapshot;
      stock.missing_data = snapshot.missingData;
      stock.data_ready = snapshot.technicalAvailable && snapshot.fundamentalsAvailable;
    }
    if (stock.data_ready) {
      stock.data_status = "ready";
      ready++;
      if (!stock.live_notification_sent_at) {
        stock.live_notification_sent_at = new Date().toISOString();
        merged.notifications.push(createNotice("data-live", stock, `Real Yahoo Finance data is now live for ${stock.company} (${stock.exchange}).`));
      }
    } else {
      stock.data_status = "pending";
      if (!stock.delayed_notification_sent_at) {
        stock.delayed_notification_sent_at = new Date().toISOString();
        const missing = stock.missing_data.length ? stock.missing_data : ["technical", "fundamental"];
        merged.notifications.push(createNotice(
          "data-delayed",
          stock,
          `Real data for ${stock.company} is still pending after the 14-day wait. Missing: ${missing.join(" and ")}. The daily job will retry.`,
          missing,
        ));
      }
    }
  }

  const log = {
    date: runDate,
    startedAt,
    completedAt: new Date().toISOString(),
    status: errors.length ? "completed_with_errors" : "completed",
    sourceRows: { nse: nse?.length || 0, bse: bse?.length || 0 },
    added: merged.added,
    removed: merged.removed,
    reactivated: merged.reactivated,
    dataAttempts: attempted,
    dataReady: ready,
    errors: errors.slice(0, 200),
  };
  const output = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    stocks: merged.stocks,
    notifications: (merged.notifications || []).slice(-500),
    marketData,
    runLogs: [...(previous.runLogs || []), log].slice(-90),
  };

  const outputDir = path.resolve(process.argv[process.argv.indexOf("--out") + 1] || ".stock-sync-output");
  await mkdir(path.join(outputDir, "market-data"), { recursive: true });
  await writeFile(path.join(outputDir, "stocks.json"), `${JSON.stringify({ schemaVersion: 1, updatedAt: output.updatedAt, stocks: output.stocks })}\n`);
  await writeFile(path.join(outputDir, "notifications.json"), `${JSON.stringify(output.notifications, null, 2)}\n`);
  await writeFile(path.join(outputDir, "run-log.json"), `${JSON.stringify(log, null, 2)}\n`);
  await writeFile(path.join(outputDir, "stock-data.json.gz"), gzipSync(Buffer.from(JSON.stringify(output)), { level: 9 }));
  console.log(JSON.stringify({ status: log.status, stocks: output.stocks.length, added: log.added, removed: log.removed, dataAttempts: attempted, dataReady: ready, errors: errors.length }));
}

main().catch((error) => {
  console.error(`Stock catalog sync failed: ${error?.stack || error}`);
  process.exitCode = 1;
});

