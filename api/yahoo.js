export default async function handler(req, res) {
  const raw = req.query?.url;
  if (!raw) return res.status(400).json({ error: "Missing url" });

  let target;
  try {
    target = new URL(raw);
  } catch {
    return res.status(400).json({ error: "Invalid url" });
  }

  if (target.hostname !== "query1.finance.yahoo.com" && target.hostname !== "query2.finance.yahoo.com") {
    return res.status(403).json({ error: "Upstream host not allowed" });
  }

  try {
    const response = await fetch(target.toString(), {
      headers: { "User-Agent": "SignalSense/1.0" },
      cache: "no-store"
    });
    const body = await response.text();
    res.setHeader("Content-Type", response.headers.get("content-type") || "application/json");
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(response.status).send(body);
  } catch {
    return res.status(502).json({ error: "Market data provider unavailable" });
  }
}
