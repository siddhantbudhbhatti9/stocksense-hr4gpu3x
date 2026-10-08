import { findCatalogStock, getStockCatalog, searchCatalog } from "../lib/stock-catalog.js";

function boundedInteger(value, fallback, max) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.max(0, Math.min(max, number)) : fallback;
}

function publicStock(stock) {
  const { _missingRuns, ...visible } = stock;
  return visible;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const catalog = await getStockCatalog();
  const stocks = catalog.stocks || [];
  const includeInactive = req.query?.includeInactive === "true";
  const offset = boundedInteger(req.query?.offset, 0, 100_000);
  const limit = boundedInteger(req.query?.limit, 12, 100);

  if (req.query?.symbol) {
    const stock = findCatalogStock(stocks, req.query.symbol);
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({ stock: stock ? publicStock(stock) : null, updatedAt: catalog.updatedAt || null });
  }
  if (req.query?.symbols) {
    const requested = String(req.query.symbols).split(",").map((value) => value.trim()).filter(Boolean).slice(0, 30);
    const results = requested.map((symbol) => findCatalogStock(stocks, symbol)).filter(Boolean);
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({ stocks: results.map(publicStock), total: results.length, updatedAt: catalog.updatedAt || null });
  }

  const query = String(req.query?.query || "").trim();
  const result = searchCatalog(stocks, query, { offset, limit, includeInactive });
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=180");
  return res.status(200).json({
    stocks: result.results.map(publicStock),
    total: result.total,
    offset,
    limit,
    hasMore: offset + result.results.length < result.total,
    updatedAt: catalog.updatedAt || null,
  });
}

