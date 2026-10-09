import seed from "../data/stocks.json" with { type: "json" };
import { gunzipSync } from "node:zlib";

const ARCHIVE_URL = "https://github.com/siddhantbudhbhatti9/stocksense-hr4gpu3x/releases/latest/download/stock-data.json.gz";
const REMOTE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3500;
let catalogCache = null;
let catalogCacheAt = 0;
let catalogPromise = null;
let searchIndexCache = null;

function validCatalog(value) {
  return value && Array.isArray(value.stocks) ? value : null;
}

function normalizeBseTickers(catalog) {
  for (const stock of catalog.stocks) {
    for (const listing of stock.listings || []) {
      if (listing.exchange !== "BSE") continue;
      const symbol = String(listing.symbol || "").trim().toUpperCase();
      if (symbol) listing.yahooTicker = `${symbol}.BO`;
    }
    if (stock.exchange === "BSE") {
      const bseListings = (stock.listings || []).filter((listing) => listing.exchange === "BSE");
      const primary = bseListings.find((listing) => listing.status !== "inactive") || bseListings[0];
      if (primary?.symbol) stock.symbol = String(primary.symbol).trim().toUpperCase();
      if (primary?.yahooTicker) stock.yahoo_ticker = primary.yahooTicker;
    }
  }
  return catalog;
}

async function loadRelease() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(ARCHIVE_URL, {
      headers: { "User-Agent": "StockSense/1.0", Accept: "application/octet-stream" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 40_000_000) return null;
    const payload = JSON.parse(gunzipSync(bytes, { maxOutputLength: 120_000_000 }).toString("utf8"));
    return validCatalog(payload) ? payload : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function getStockCatalog({ force = false } = {}) {
  if (!force && catalogCache && Date.now() - catalogCacheAt < REMOTE_TTL_MS) return catalogCache;
  if (catalogPromise) return catalogPromise;
  catalogPromise = loadRelease().then((remote) => {
    catalogCache = normalizeBseTickers(remote || validCatalog(seed) || { stocks: [], notifications: [], runLogs: [] });
    catalogCacheAt = Date.now();
    searchIndexCache = null;
    return catalogCache;
  }).finally(() => { catalogPromise = null; });
  return catalogPromise;
}

function normalized(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function buildSearchIndex(stocks) {
  const grams = new Map();
  const prefixes = new Map();
  const symbolIndex = new Map();
  const nameIndex = new Map();
  const addPrefixes = (key, index) => {
    for (let length = 1; length <= Math.min(4, key.length); length++) {
      const prefix = key.slice(0, length);
      if (!prefixes.has(prefix)) prefixes.set(prefix, new Set());
      prefixes.get(prefix).add(index);
    }
  };
  stocks.forEach((stock, index) => {
    const symbols = [stock.symbol, stock.yahooTicker, stock.isin, ...(stock.listings || []).flatMap((item) => [item.symbol, item.yahooTicker, item.scripCode])];
    for (const value of symbols) {
      const key = normalized(value);
      if (!key) continue;
      symbolIndex.set(key, index);
      addPrefixes(key, index);
    }
    const name = normalized(stock.company || stock.name);
    if (name) { nameIndex.set(name, index); addPrefixes(name, index); }
    const fields = [name, ...symbols.map(normalized)].filter(Boolean);
    for (const field of fields) {
      if (field.length < 3) continue;
      const seen = new Set();
      for (let i = 0; i <= field.length - 3; i++) seen.add(field.slice(i, i + 3));
      for (const gram of seen) {
        if (!grams.has(gram)) grams.set(gram, new Set());
        grams.get(gram).add(index);
      }
    }
  });
  return { grams, prefixes, symbolIndex, nameIndex };
}

function getSearchIndex(stocks) {
  if (!searchIndexCache) searchIndexCache = buildSearchIndex(stocks);
  return searchIndexCache;
}

export function searchCatalog(stocks, query, { offset = 0, limit = 12, includeInactive = false } = {}) {
  const q = normalized(query);
  const index = getSearchIndex(stocks);
  if (!q) {
    const items = stocks.filter((stock) => includeInactive || stock.status === "active");
    return { total: items.length, results: items.slice(offset, offset + limit) };
  }
  let candidates = null;
  const exact = index.symbolIndex.get(q) ?? index.nameIndex.get(q);
  if (exact !== undefined) candidates = new Set([exact]);
  if (!candidates && q.length <= 4) candidates = new Set(index.prefixes.get(q) || []);
  if (!candidates && q.length >= 3) {
    const queryGrams = new Set();
    for (let i = 0; i <= q.length - 3; i++) queryGrams.add(q.slice(i, i + 3));
    const lists = [...queryGrams].map((gram) => index.grams.get(gram) || new Set()).sort((a, b) => a.size - b.size);
    candidates = new Set(lists[0] || []);
    for (const list of lists.slice(1)) for (const candidate of candidates) if (!list.has(candidate)) candidates.delete(candidate);
  }
  if (!candidates) candidates = new Set(stocks.map((_, i) => i));
  const results = [];
  for (const i of candidates) {
    const stock = stocks[i];
    if (!stock || (!includeInactive && stock.status !== "active")) continue;
    const fields = [stock.symbol, stock.yahooTicker, stock.isin, stock.company, stock.name, ...(stock.listings || []).flatMap((item) => [item.symbol, item.yahooTicker, item.scripCode])];
    if (fields.some((value) => normalized(value).includes(q))) results.push(stock);
  }
  results.sort((a, b) => normalized(a.company || a.name).localeCompare(normalized(b.company || b.name)));
  return { total: results.length, results: results.slice(offset, offset + limit) };
}

export function findCatalogStock(stocks, symbol) {
  const wanted = normalized(symbol);
  return stocks.find((stock) => {
    const values = [stock.symbol, stock.yahooTicker, ...(stock.listings || []).flatMap((item) => [item.symbol, item.yahooTicker, item.scripCode])];
    return values.some((value) => normalized(value) === wanted);
  }) || null;
}

export function resolveMarketDataKey(stock) {
  return stock?.id || stock?.isin || `${stock?.exchange || "STOCK"}:${stock?.symbol || ""}`;
}

export function getMarketData(stock, catalog) {
  return catalog?.marketData?.[resolveMarketDataKey(stock)] || null;
}

