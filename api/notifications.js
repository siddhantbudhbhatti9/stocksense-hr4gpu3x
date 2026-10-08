import { getStockCatalog } from "../lib/stock-catalog.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const catalog = await getStockCatalog();
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return res.status(200).json({ notifications: catalog.notifications || [], updatedAt: catalog.updatedAt || null });
}

