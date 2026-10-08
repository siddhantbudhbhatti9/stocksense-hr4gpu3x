const FEEDS = [
  { url: "https://www.moneycontrol.com/rss/marketreports.xml", publisher: "Moneycontrol" },
  { url: "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms", publisher: "The Economic Times" },
];
const CACHE_MS = 5 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 3_500;
const MAX_FEED_BYTES = 1_000_000;
let cacheEntry = null;

function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => {
      const point = code[0].toLowerCase() === "x"
        ? Number.parseInt(code.slice(1), 16)
        : Number.parseInt(code, 10);
      return Number.isFinite(point) && point <= 0x10ffff ? String.fromCodePoint(point) : "";
    })
    .replace(/&(nbsp|quot|apos|lt|gt|amp|rsquo|lsquo|rdquo|ldquo|ndash|mdash|hellip|trade|copy);/gi, (_, entity) => ({
      nbsp: " ", quot: '"', apos: "'", lt: "<", gt: ">", amp: "&",
      rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…", trade: "™", copy: "©",
    })[entity.toLowerCase()])
    .replace(/\s+/g, " ")
    .trim();
}

function readTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}\\s*>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function validLink(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function parseItems(xml, publisher) {
  const items = [];
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi)) {
    const item = match[1];
    const title = readTag(item, "title");
    const link = validLink(readTag(item, "link") || readTag(item, "guid"));
    if (!title || !link) continue;
    const rawDate = readTag(item, "pubDate") || readTag(item, "published") || readTag(item, "date");
    const timestamp = Date.parse(rawDate);
    items.push({
      title,
      publisher,
      link,
      published: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
    });
  }
  return items;
}

async function fetchFeed(feed) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(feed.url, {
      headers: {
        "User-Agent": "StockSense/1.0 (+https://stocksense-hr4gpu3x.vercel.app)",
        Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`News feed returned ${response.status}`);
    const xml = await response.text();
    if (xml.length > MAX_FEED_BYTES) throw new Error("News feed exceeded the size limit");
    return parseItems(xml, feed.publisher);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeCount(value) {
  const count = Number(value);
  return Math.min(8, Math.max(1, Number.isFinite(count) ? Math.floor(count) : 6));
}

export default async function handler(req, res) {
  const count = normalizeCount(req.query?.count);
  if (cacheEntry && Date.now() - cacheEntry.time < CACHE_MS) {
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=900");
    return res.status(200).json({ news: cacheEntry.news.slice(0, count) });
  }

  const results = await Promise.allSettled(FEEDS.map(fetchFeed));
  const collected = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const seen = new Set();
  const news = collected
    .filter((item) => {
      const key = item.title.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (Date.parse(b.published || "") || 0) - (Date.parse(a.published || "") || 0))
    .slice(0, count);

  if (news.length) cacheEntry = { time: Date.now(), news };
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", news.length ? "public, s-maxage=300, stale-while-revalidate=900" : "no-store");
  return res.status(200).json({ news });
}

