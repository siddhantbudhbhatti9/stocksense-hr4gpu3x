import { mkdir, writeFile } from "node:fs/promises";
import { normalizeNse, normalizeBse, makeSeedCatalog } from "./stock-catalog-utils.mjs";

async function fetchText(url, headers) {
  const response = await fetch(url, { headers, cache: "no-store" });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129 Safari/537.36",
  Accept: "text/csv, application/json, text/plain, */*",
  Referer: "https://www.bseindia.com/",
};
const nseUrl = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv";
const bseUrl = "https://api.bseindia.com/BseIndiaAPI/api/ListofScripData_new/w?Group=&Scripcode=&segment=Equity&status=Active&scripName=";
const [nseResult, bseResult] = await Promise.allSettled([fetchText(nseUrl, headers), fetchText(bseUrl, headers)]);
if (nseResult.status === "rejected" || bseResult.status === "rejected") {
  throw new Error(`A complete NSE+BSE seed requires both official feeds. Existing catalog was not changed. NSE: ${nseResult.status === "rejected" ? nseResult.reason : "ok"}; BSE: ${bseResult.status === "rejected" ? bseResult.reason : "ok"}`);
}
const nse = normalizeNse(nseResult.value);
const bse = normalizeBse(bseResult.value);
const catalog = makeSeedCatalog(nse, bse);
await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(new URL("../data/stocks.json", import.meta.url), `${JSON.stringify(catalog)}\n`);
await writeFile(new URL("../data/notifications.json", import.meta.url), `${JSON.stringify(catalog.notifications, null, 2)}\n`);
console.log(JSON.stringify({ stocks: catalog.stocks.length, nse: nse.length, bse: bse.length, notifications: catalog.notifications.length, errors: catalog.runLogs[0].errors, updatedAt: catalog.updatedAt }));

