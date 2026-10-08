import { createHash } from "node:crypto";

const todayIST = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const normalized = (value) => String(value || "").trim().toUpperCase();
const validIsin = (value) => /^IN[A-Z0-9]{10}$/.test(normalized(value));
const addDays = (value, days) => {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
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
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  const headers = (rows.shift() || []).map((value) => value.trim().toUpperCase());
  return rows.filter((values) => values.some((value) => value.trim())).map((values) => Object.fromEntries(headers.map((header, index) => [header, (values[index] || "").trim()])));
}

function listingDate(value) {
  const match = String(value || "").trim().match(/^(\d{1,2})-([A-Z]{3})-(\d{4})$/i);
  const month = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].indexOf(match?.[2]?.toUpperCase());
  return match && month >= 0 ? `${match[3]}-${String(month + 1).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}` : null;
}

export function normalizeNse(text) {
  const records = parseCsv(text).flatMap((row) => {
    const symbol = normalized(row.SYMBOL), isin = normalized(row["ISIN NUMBER"]), company = String(row["NAME OF COMPANY"] || "").trim();
    if (!symbol || !company || !validIsin(isin)) return [];
    return [{ exchange: "NSE", symbol, yahooTicker: `${symbol}.NS`, isin, company, series: normalized(row.SERIES) || null, listingDate: listingDate(row["DATE OF LISTING"]), status: "active" }];
  });
  if (records.length < 500) throw new Error(`NSE source validation failed: only ${records.length} rows`);
  return records;
}

export function normalizeBse(text) {
  const rows = JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error("BSE source response is not a list");
  const records = rows.flatMap((row) => {
    const isin = normalized(row.ISIN_NUMBER), scripCode = String(row.SCRIP_CD || "").trim();
    const symbol = normalized(row.scrip_id || scripCode), company = String(row.Issuer_Name || row.Scrip_Name || "").trim();
    if (!validIsin(isin) || !scripCode || !symbol || !company) return [];
    return [{ exchange: "BSE", symbol, scripCode, yahooTicker: `${scripCode}.BO`, isin, company, series: normalized(row.GROUP) || null, listingDate: null, status: normalized(row.Status) === "ACTIVE" ? "active" : "inactive" }];
  });
  if (records.length < 1000) throw new Error(`BSE source validation failed: only ${records.length} rows`);
  return records;
}

function uniqueListings(records) {
  const byKey = new Map();
  for (const item of records) {
    const key = `${item.exchange}|${item.yahooTicker}|${item.series || ""}`;
    if (!byKey.has(key)) byKey.set(key, item);
  }
  return [...byKey.values()];
}

export function makeSeedCatalog(nse, bse) {
  const today = todayIST();
  const grouped = new Map();
  for (const item of [...nse, ...bse]) {
    if (!grouped.has(item.isin)) grouped.set(item.isin, []);
    grouped.get(item.isin).push(item);
  }
  const stocks = [...grouped.entries()].map(([isin, values]) => {
    const listings = uniqueListings(values).sort((a, b) => (a.exchange === "NSE" ? -1 : 1) - (b.exchange === "NSE" ? -1 : 1));
    const primary = listings.find((item) => item.exchange === "NSE") || listings[0];
    const date = listings.find((item) => item.exchange === "NSE" && item.listingDate)?.listingDate || null;
    const availableFrom = addDays(date, 14);
    const current = Boolean(availableFrom && availableFrom > today);
    const company = listings.find((item) => item.exchange === "NSE")?.company || primary.company;
    const id = isin;
    return {
      id,
      symbol: primary.symbol,
      company,
      exchange: primary.exchange,
      isin,
      series: primary.series,
      listing_date: date,
      listing_date_source: date ? "NSE EQUITY_L.csv" : null,
      yahoo_ticker: primary.yahooTicker,
      status: listings.some((item) => item.status === "active") ? "active" : "inactive",
      date_added: today,
      data_ready: !current,
      data_available_from: availableFrom,
      data_available_from_source: date ? "exchange_listing_date" : null,
      data_status: current ? "new_listing" : "ready",
      missing_data: [],
      delayed_notification_sent_at: null,
      live_notification_sent_at: null,
      last_data_attempt_at: null,
      listings: listings.map((item) => ({
        exchange: item.exchange,
        symbol: item.symbol,
        scripCode: item.scripCode || undefined,
        yahooTicker: item.yahooTicker,
        series: item.series,
        listingDate: item.listingDate,
        status: item.status,
        missingRuns: 0,
      })),
    };
  }).sort((a, b) => a.company.localeCompare(b.company));
  const notifications = stocks.filter((stock) => !stock.data_ready && stock.data_available_from).map((stock) => ({
    id: createHash("sha1").update(`new-listing|${stock.id}`).digest("hex").slice(0, 16),
    kind: "new-listing",
    title: "New listing",
    message: `${stock.company} (${stock.exchange}) was listed on ${stock.listing_date}. Fundamental and technical data are unavailable during the 14-day new-listing period. Real data is expected after ${stock.data_available_from}.`,
    symbol: stock.yahoo_ticker,
    company: stock.company,
    exchange: stock.exchange,
    listingDate: stock.listing_date,
    expectedDate: stock.data_available_from,
    missingData: ["technical", "fundamental"],
    createdAt: new Date().toISOString(),
  }));
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    stocks,
    notifications,
    marketData: {},
    runLogs: [{ date: today, status: "seeded", sourceRows: { nse: nse.length, bse: bse.length }, added: stocks.length, removed: 0, reactivated: 0, dataAttempts: 0, dataReady: stocks.filter((stock) => stock.data_ready).length, errors: [] }],
  };
}

