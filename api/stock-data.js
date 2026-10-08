import { findCatalogStock, getMarketData, getStockCatalog } from "../lib/stock-catalog.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const symbol = String(req.query?.symbol || "").trim().toUpperCase();
  if (!/^[A-Z0-9^=_&.-]{1,32}$/.test(symbol)) return res.status(400).json({ error: "Invalid symbol" });
  const catalog = await getStockCatalog();
  const stock = findCatalogStock(catalog.stocks || [], symbol);
  if (!stock) return res.status(404).json({ error: "Stock is not in the exchange catalog" });
  const data = getMarketData(stock, catalog);
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=900");
  return res.status(200).json({ data, dataReady: Boolean(stock.data_ready), status: stock.data_status || (stock.data_ready ? "ready" : "pending") });
}

