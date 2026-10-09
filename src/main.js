import { getQuote, getQuotesBatch, getFastQuote, getTechnicalData, getNews, getAISignal, getMarketCap, formatCompactNumber, searchSymbols, calcRSI, calcSMA, getStockCatalogPage, getStocksBySymbols, getCatalogStock, getSavedStockData, getCatalogNotifications } from "./utils/api.js";

let STOCK_META=new Map();
const PORTFOLIO_KEY="ss_portfolio";
const PORTFOLIO_MAX=30;
const NOTIFICATION_STATE_KEY="ss_notifications_v1";
const notificationState={read:new Set(),cleared:new Set()};
let appNotifications=[];
let screenerPage=0;
let screenerType="BUY";
let portfolio=[];
let currentSymbol="SBIN.NS";
let stockRequestId=0;
let globalMarketLoadedAt=0;
let globalMarketPromise=null;
let generalNewsLoadedAt=0;
let generalNewsPromise=null;
const GLOBAL_MARKET_CACHE_MS=30_000;
const GENERAL_NEWS_CACHE_MS=5*60_000;
function loadPortfolioData(){
  try{
    const saved=JSON.parse(localStorage.getItem(PORTFOLIO_KEY)||"[]");
    portfolio=Array.isArray(saved)?saved.filter(s=>typeof s==="string").map(normalizeSymbol).filter(Boolean).slice(0,PORTFOLIO_MAX):[];
  }catch{portfolio=[];}
  localStorage.setItem(PORTFOLIO_KEY,JSON.stringify(portfolio));
}
loadPortfolioData();
function savePortfolio(){localStorage.setItem(PORTFOLIO_KEY,JSON.stringify(portfolio));}
function symbolLabel(symbol){
  return symbol.replace(/\.(NS|BO)$/,"");
}
function listingForTicker(stock,ticker){
  const key=String(ticker||"").toUpperCase();
  return (stock?.listings||[]).find(item=>String(item.yahooTicker||item.yahoo_ticker||"").toUpperCase()===key)||null;
}
function selectedExchange(stock,ticker){
  const listing=listingForTicker(stock,ticker),key=String(ticker||"").toUpperCase();
  return listing?.exchange||(/\.BO$/.test(key)?"BSE":/\.NS$/.test(key)?"NSE":stock?.exchange||"");
}
function selectedDisplay(stock,ticker){
  const listing=listingForTicker(stock,ticker),key=String(ticker||"").toUpperCase();
  if(listing?.symbol)return listing.symbol;
  if(String(stock?.yahoo_ticker||"").toUpperCase()===key&&stock?.symbol)return stock.symbol;
  return symbolLabel(String(ticker||""));
}
function selectableListings(stock){
  const listings=(stock?.listings||[]).filter(item=>item?.status!=="inactive"&&(item.yahooTicker||item.yahoo_ticker));
  const primaryTicker=String(stock?.yahoo_ticker||"").toUpperCase();
  if(primaryTicker&&!listings.some(item=>String(item.yahooTicker||item.yahoo_ticker).toUpperCase()===primaryTicker)){
    listings.unshift({exchange:stock.exchange,symbol:stock.symbol,yahooTicker:stock.yahoo_ticker,status:stock.status});
  }
  const unique=new Map();
  for(const item of listings){const ticker=String(item.yahooTicker||item.yahoo_ticker||"").toUpperCase();if(ticker&&!unique.has(ticker))unique.set(ticker,{...item,yahooTicker:ticker});}
  return [...unique.values()].sort((a,b)=>(a.exchange==="NSE"?0:1)-(b.exchange==="NSE"?0:1));
}
function normalizeSymbol(value){
  let v=value.trim().toUpperCase();
  if(!v) return "";
  if(!/\.(NS|BO)$/.test(v)) v+=".NS";
  return v;
}
function setText(id,value){
  const el=document.getElementById(id); if(el) el.textContent=value;
}
function escapeHtml(value){
  return String(value ?? "").replace(/[&<>'"]/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[character]));
}
function safeExternalUrl(value){
  try{
    const url=new URL(value || "#", window.location.origin);
    return ["http:","https:"].includes(url.protocol) ? url.href : "#";
  }catch{return "#";}
}
function readStoredArray(key){
  try{
    const value=JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  }catch{return [];}
}
function loadNotificationState(){
  try{
    const saved=JSON.parse(localStorage.getItem(NOTIFICATION_STATE_KEY)||"{}");
    notificationState.read=new Set(Array.isArray(saved.read)?saved.read:[]);
    notificationState.cleared=new Set(Array.isArray(saved.cleared)?saved.cleared:[]);
  }catch{notificationState.read=new Set();notificationState.cleared=new Set();}
}
function saveNotificationState(){
  localStorage.setItem(NOTIFICATION_STATE_KEY,JSON.stringify({read:[...notificationState.read],cleared:[...notificationState.cleared]}));
}
function notificationDate(value){
  const date=new Date(value||"");
  return Number.isFinite(date.getTime())?date.toLocaleString("en-IN",{timeZone:"Asia/Kolkata",day:"numeric",month:"short",hour:"numeric",minute:"2-digit"}):"";
}
function renderNotifications(){
  const badge=document.getElementById("notificationBadge"),list=document.getElementById("notificationList");
  const visible=appNotifications.filter(item=>item?.id&&!notificationState.cleared.has(item.id)).slice(0,100);
  const unread=visible.filter(item=>!notificationState.read.has(item.id)).length;
  if(badge){badge.textContent=unread>99?"99+":String(unread);badge.style.display=unread?"block":"none";}
  if(!list)return;
  list.innerHTML=visible.length?visible.map(item=>{
    const isRead=notificationState.read.has(item.id);
    const date=notificationDate(item.createdAt);
    return `<article class="ss-notification-row ${isRead?"":"is-unread"}"><div style="font-size:10px;font-weight:800;color:${item.kind==="data-delayed"?"#ffcc66":"#8fb8ff"}">${escapeHtml(item.title||"Stock update")}</div><div class="ss-notification-message">${escapeHtml(item.message||"")}</div><div class="ss-notification-meta"><span>${escapeHtml(date)}</span>${isRead?"<span>Read</span>":`<button type="button" data-notification-read="${escapeHtml(item.id)}" style="border:0;background:none;color:#8fb8ff;cursor:pointer;font-size:9px">Mark as read</button>`}</div></article>`;
  }).join(""):"<div style='padding:18px 12px;text-align:center;color:#7C8DB0;font-size:10px'>You're all caught up.</div>";
  list.querySelectorAll("[data-notification-read]").forEach(button=>button.onclick=()=>{
    notificationState.read.add(button.dataset.notificationRead);saveNotificationState();renderNotifications();
  });
}
async function refreshNotifications(){
  try{appNotifications=await getCatalogNotifications();renderNotifications();}
  catch(error){console.warn("[StockSense] notifications",error);}
}
function setupNotifications(){
  loadNotificationState();
  const button=document.getElementById("notificationButton"),panel=document.getElementById("notificationPanel");
  button.onclick=()=>{const open=panel.style.display!=="block";panel.style.display=open?"block":"none";button.setAttribute("aria-expanded",String(open));};
  document.getElementById("markAllNotificationsRead").onclick=()=>{
    appNotifications.forEach(item=>notificationState.read.add(item.id));saveNotificationState();renderNotifications();
  };
  document.getElementById("clearNotifications").onclick=()=>{
    appNotifications.forEach(item=>notificationState.cleared.add(item.id));saveNotificationState();renderNotifications();
  };
  document.addEventListener("click",event=>{
    if(!event.target.closest(".ss-notification-wrap")){panel.style.display="none";button.setAttribute("aria-expanded","false");}
  });
  refreshNotifications();
  setInterval(refreshNotifications,5*60_000);
}
function money(value){
  return Number.isFinite(value)?"₹"+value.toFixed(2):"--";
}
function signedMoney(value){
  return Number.isFinite(value)?(value>=0?"+":"−")+"₹"+Math.abs(value).toFixed(2):"--";
}
const indexNumberFormat=new Intl.NumberFormat("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
function formatIndexNumber(value){
  return Number.isFinite(value)?indexNumberFormat.format(value):"--";
}
function percent(value){
  return Number.isFinite(value)?(value>=0?"+":"")+value.toFixed(2)+"%":"--";
}
function installDesignSystem(){
  if(document.getElementById("ss-design-system")) return;
  const style=document.createElement("style"); style.id="ss-design-system"; style.textContent=`
    :root{color-scheme:dark}
    *{box-sizing:border-box}
    body{margin:0;background:#050914;color:#eef4ff;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    button,input,select{font:inherit}
    button{transition:transform .16s ease,background .16s ease,border-color .16s ease,box-shadow .16s ease}
    button:hover{transform:translateY(-1px)}
    input:focus,select:focus{border-color:#4f8cff!important;box-shadow:0 0 0 3px rgba(79,140,255,.12)}
    .ss-card{background:linear-gradient(180deg,rgba(18,26,51,.98),rgba(10,17,35,.98))!important;border:1px solid rgba(91,121,180,.22)!important;box-shadow:0 18px 50px rgba(0,0,0,.20),inset 0 1px 0 rgba(255,255,255,.025)}
    .ss-subcard{background:rgba(5,9,20,.62)!important;border:1px solid rgba(91,121,180,.18)!important}
    #ss-shell{align-items:start}
    #ss-shell>.ss-watch{align-self:start;min-width:0;max-height:calc(100vh - 148px)}
    #ss-shell>.ss-detail{min-width:0}
    .ss-portfolio-head,.ss-portfolio-row{display:grid;grid-template-columns:minmax(68px,1fr) 62px 56px 44px 18px;gap:4px;align-items:center}
    .ss-portfolio-head{padding:8px 10px;font-size:8px;color:#7C8DB0;font-weight:800;border-bottom:1px solid #1e2d5a;background:#0e1429}
    .ss-portfolio-row{padding:9px 10px;border-bottom:1px solid rgba(91,121,180,.12);cursor:pointer}
    .ss-portfolio-row:hover{background:rgba(91,121,180,.08)}
    .ss-portfolio-stock{min-width:0}.ss-portfolio-symbol{font-size:11px;font-weight:850;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ss-portfolio-company{font-size:8px;color:#7C8DB0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
    .ss-portfolio-number{text-align:right;font-size:9px;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}
    .ss-portfolio-remove{width:18px;height:22px;padding:0;background:none;border:0;color:#ff6b78;cursor:pointer;font-size:16px;line-height:1}
    .ss-portfolio-empty{display:grid;justify-items:center;gap:5px;padding:20px 16px;text-align:center;color:#7C8DB0;font-size:9px;line-height:1.45}
    .ss-portfolio-empty-mark{display:grid;place-items:center;width:28px;height:28px;border:1px solid rgba(0,212,255,.25);border-radius:9px;background:rgba(0,212,255,.08);color:#00d4ff;font-size:18px}
    .ss-portfolio-summary{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px 10px;border-top:1px solid #1e2d5a;background:#0e1429}
    .ss-portfolio-summary-item{min-width:0;font-size:8px;color:#7C8DB0}.ss-portfolio-summary-item b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9px;margin-top:3px}
    .ss-search-result{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid #1a274a}
    .ss-search-result-copy{min-width:0}.ss-search-result-copy b,.ss-search-result-copy span{overflow:hidden;text-overflow:ellipsis}
    .ss-listing-options{display:flex;gap:5px;flex:0 0 auto}.ss-listing-option{padding:5px 7px;background:#121a33;border:1px solid #263967;border-radius:7px;color:#dce8ff;font-size:8px;cursor:pointer;white-space:nowrap}.ss-listing-option:hover{border-color:#00d4ff;background:#132344}
        #newsBox a{color:#dce8ff!important;text-decoration:none}
    #newsBox a:hover{text-decoration:underline}
     .ss-kicker{letter-spacing:.12em;text-transform:uppercase;font-size:9px;color:#7890b8;font-weight:800}
    .ss-global-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
    .ss-global-card{background:#0e1429;border:1px solid rgba(91,121,180,.16);border-radius:11px;padding:12px}
    .ss-global-top{display:flex;justify-content:space-between;gap:8px;align-items:start}
    .ss-global-name{font-size:10px;font-weight:850}.ss-global-region{font-size:8px;color:#7185aa;margin-top:2px}
    .ss-global-price{font-size:16px;font-weight:900;margin-top:10px;font-variant-numeric:tabular-nums}.ss-global-change{display:inline-flex;align-items:center;gap:5px;max-width:100%;margin-top:7px;padding:5px 8px;border-radius:999px;font-size:9px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.2}
    .ss-global-time{margin-top:9px;padding-top:8px;border-top:1px solid rgba(91,121,180,.12);font-size:8px;color:#7C8DB0;line-height:13px}
    @media(max-width:900px){.ss-global-grid{grid-template-columns:repeat(2,1fr)}}
    @media(max-width:560px){.ss-global-grid{grid-template-columns:1fr}}
    .ss-index-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.ss-index-card{background:#0e1429;border:1px solid rgba(91,121,180,.14);border-radius:9px;padding:8px;display:flex;justify-content:space-between;align-items:center;min-height:52px}.ss-index-name{font-size:9px;color:#a9b9d6;line-height:12px}.ss-index-price{font-size:11px;font-weight:800;margin-top:2px}.ss-index-change{font-size:9px;font-weight:800;margin-left:6px}@media(max-width:520px){.ss-index-grid{grid-template-columns:1fr}}
    .ss-analysis{margin-top:12px;display:grid;grid-template-columns:1.15fr .85fr;gap:10px}
    .ss-analysis-card{background:linear-gradient(180deg,rgba(9,16,34,.96),rgba(6,11,24,.96));border:1px solid rgba(91,121,180,.18);border-radius:12px;padding:12px}
    .ss-analysis-title{font-size:9px;color:#7890b8;font-weight:800;letter-spacing:.1em;text-transform:uppercase}
    .ss-signal-hero{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:8px}
    .ss-signal-pill{font-size:16px;font-weight:900;letter-spacing:.02em}
    .ss-signal-score{font-size:10px;color:#7C8DB0;text-align:right}
    .ss-signal-bands{font-size:8px;color:#7890b8;margin-top:6px;line-height:1.5}
    .ss-score-track{height:7px;background:#17213d;border-radius:999px;overflow:hidden;margin-top:8px}
    .ss-score-fill{height:100%;width:0%;border-radius:999px;transition:width .25s ease}
    .ss-quote-stats{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
    .ss-quote-stat{display:inline-flex;align-items:center;gap:5px;padding:5px 8px;border:1px solid rgba(91,121,180,.16);border-radius:7px;background:#0e1429;font-size:9px;color:#7890b8;font-variant-numeric:tabular-nums}
    .ss-quote-stat b{color:#eef4ff;font-size:10px}
    .ss-target-card{margin-top:10px;padding:9px 10px;border:1px solid rgba(79,140,255,.18);border-radius:9px;background:linear-gradient(100deg,rgba(35,72,145,.18),rgba(14,20,41,.85))}
    .ss-target-top{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap}
    .ss-target-price{font-size:16px;font-weight:900;font-variant-numeric:tabular-nums}
    .ss-target-range,.ss-target-note{font-size:8px;color:#8da0c2;line-height:1.5;margin-top:4px}
    .ss-breakdown{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:10px}
    .ss-break{padding:8px;border:1px solid rgba(91,121,180,.14);border-radius:8px;background:#0e1429}
    .ss-break-label{font-size:8px;color:#7890b8;text-transform:uppercase;font-weight:800}
    .ss-break-value{font-size:10px;font-weight:800;margin-top:3px}
    .ss-rsi-gauge{position:relative;height:9px;border-radius:999px;background:linear-gradient(90deg,#ef4444 0 30%,#f59e0b 30% 45%,#22c55e 45% 70%,#f59e0b 70% 85%,#ef4444 85%);overflow:hidden;margin-top:9px}
    .ss-rsi-marker{position:absolute;top:-3px;width:3px;height:15px;background:white;border-radius:3px;box-shadow:0 0 0 2px rgba(255,255,255,.15)}
    .ss-rsi-labels{display:flex;justify-content:space-between;font-size:7px;color:#7890b8;margin-top:4px}
    .ss-trend-list{display:grid;gap:7px;margin-top:8px}
    .ss-trend-row{display:flex;justify-content:space-between;align-items:center;padding:7px 8px;background:#0e1429;border-radius:8px;border:1px solid rgba(91,121,180,.14)}
    .ss-trend-name{font-size:9px;color:#7890b8}.ss-trend-value{font-size:10px;font-weight:800}
    .ss-news-item{padding:9px 10px;background:#0e1429;border:1px solid rgba(91,121,180,.14);border-radius:8px;margin:6px 0}
    .ss-news-title{font-size:11px;line-height:1.45;font-weight:700}
    .ss-news-meta{font-size:9px;color:#7C8DB0;margin-top:5px}
    .ss-data-banner{display:none;margin-top:10px;padding:9px 11px;border:1px solid rgba(79,140,255,.24);background:rgba(31,66,132,.16);border-radius:9px;color:#bcd5ff;font-size:10px;line-height:1.5}
    .ss-notification-wrap{position:relative}
    .ss-notification-button{position:relative;min-width:40px;height:36px;border:1px solid #1e2d5a;border-radius:20px;background:#121a33;color:#dce8ff;cursor:pointer;font-size:15px}
    .ss-notification-badge{position:absolute;top:-5px;right:-5px;min-width:17px;height:17px;padding:0 4px;border-radius:10px;background:#f87171;color:#10172a;font-size:9px;line-height:17px;font-weight:900}
    .ss-notification-panel{position:absolute;display:none;top:44px;right:0;width:min(390px,calc(100vw - 24px));max-height:440px;overflow:auto;z-index:1000;background:#0f172f;border:1px solid #263967;border-radius:12px;box-shadow:0 18px 48px rgba(0,0,0,.45)}
    .ss-notification-row{padding:11px 12px;border-top:1px solid rgba(91,121,180,.14)}
    .ss-notification-row.is-unread{background:rgba(35,72,145,.16)}
    .ss-notification-message{font-size:10px;line-height:1.55;color:#dce8ff}
    .ss-notification-meta{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-top:7px;color:#7C8DB0;font-size:8px}
    @media(max-width:820px){.ss-analysis{grid-template-columns:1fr}.ss-breakdown{grid-template-columns:repeat(3,1fr)}.ss-tech-grid{grid-template-columns:repeat(2,1fr)!important}} @media(max-width:520px){.ss-tech-grid{grid-template-columns:1fr!important}}
    @media(max-width:1080px){#ss-shell{grid-template-columns:minmax(270px,31vw) minmax(0,1fr)!important}#ss-right-panel{display:none!important}}
    @media(max-width:820px){#ss-header{position:relative!important;padding:12px!important}#ss-header>div{max-width:none!important}#ss-shell{display:flex!important;flex-direction:column!important;padding:8px!important}.ss-watch{width:100%;min-height:0!important;max-height:none!important}.ss-portfolio-list{max-height:min(360px,55vh)!important}.ss-detail{width:100%}#stockPrice{font-size:28px!important}.ss-metrics{grid-template-columns:repeat(2,1fr)!important}.ss-fund{grid-template-columns:1fr!important}#searchAll{min-width:0!important}}
    @media(max-width:520px){#ss-header-actions{width:100%;justify-content:flex-start!important}.ss-metrics{grid-template-columns:1fr 1fr!important}.ss-portfolio-head,.ss-portfolio-row{grid-template-columns:minmax(56px,1fr) 58px 52px 40px 18px;gap:3px;padding-left:8px;padding-right:8px}.ss-listing-options{flex-wrap:wrap;justify-content:flex-end}.ss-search-result{align-items:flex-start}}
  `; document.head.appendChild(style);
}

function ensureUI(){
  installDesignSystem();
  document.getElementById("app").innerHTML=`
  <div style="background:radial-gradient(circle at 20% 0%,rgba(35,72,145,.18),transparent 28%),radial-gradient(circle at 85% 10%,rgba(0,212,255,.08),transparent 24%),#050914;color:white;min-height:100vh;font-family:Inter,sans-serif">
    <div id="ss-header" style="background:#0e1a4d;border-bottom:1px solid #1e2d5a;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;position:sticky;top:0;z-index:20">
      <div style="display:flex;align-items:center;gap:12px"><div style="width:40px;height:40px;background:linear-gradient(135deg,#00d4ff,#7c3aed);border-radius:10px;display:flex;align-items:center;justify-content:center"><span style="color:white;font-weight:900;font-size:22px">₹</span></div><div><div style="display:flex;align-items:center;gap:8px"><span style="font-weight:900;font-size:19px">STOCKSENSE</span><span style="font-size:9px;background:#1e2d5a;color:#00d4ff;padding:2px 6px;border-radius:10px">BETA</span></div><div style="font-size:11px;color:#7C8DB0">Indian Stock Market Intelligence</div></div></div>
      <div style="flex:1;max-width:440px;position:relative"><input id="searchAll" placeholder="Search stocks, symbols or company names…" style="width:100%;padding:10px 16px;background:#070d2b;color:white;border:1px solid #1e2d5a;border-radius:20px;outline:none;font-size:13px"/><div id="searchResults" style="position:absolute;top:44px;left:0;right:0;z-index:9999;background:#0f172f;border:1px solid #1e2d5a;border-radius:12px;max-height:320px;overflow:auto;display:none"></div></div>
      <div id="ss-header-actions" style="display:flex;gap:8px;align-items:center"><div class="ss-notification-wrap"><button id="notificationButton" class="ss-notification-button" type="button" aria-label="Notifications" aria-expanded="false" title="Notifications">🔔<span id="notificationBadge" class="ss-notification-badge" style="display:none">0</span></button><div id="notificationPanel" class="ss-notification-panel" role="region" aria-label="Notifications"><div style="position:sticky;top:0;background:#0f172f;border-bottom:1px solid #263967;padding:10px 12px;display:flex;justify-content:space-between;gap:8px;align-items:center"><b style="font-size:11px">Notifications</b><div style="display:flex;gap:8px"><button id="markAllNotificationsRead" type="button" style="border:0;background:none;color:#8fb8ff;font-size:9px;cursor:pointer">Mark all read</button><button id="clearNotifications" type="button" style="border:0;background:none;color:#ff9d9d;font-size:9px;cursor:pointer">Clear all</button></div></div><div id="notificationList"></div></div></div><div id="marketStatus" style="font-size:11px;padding:7px 12px;background:#121a33;border:1px solid #1e2d5a;border-radius:20px">--</div></div>
    </div>
    <div id="ss-tabs" style="max-width:1450px;margin:0 auto;padding:12px 16px 0;display:flex;gap:8px">
      <button id="tabDashboard" type="button" style="padding:9px 18px;border-radius:10px;border:1px solid #00d4ff;background:#00d4ff;color:#06101f;font-size:11px;font-weight:850;cursor:pointer">Dashboard</button>
      <button id="tabMarket" type="button" style="padding:9px 18px;border-radius:10px;border:1px solid #1e2d5a;background:#121a33;color:#9fb0cf;font-size:11px;font-weight:850;cursor:pointer">Market Overview</button>
    </div>
    <div id="ss-dashboard-view">
    <div id="ss-shell" style="max-width:1450px;margin:0 auto;display:grid;grid-template-columns:320px minmax(0,1fr);gap:16px;padding:16px;min-height:calc(100vh - 130px)">
      <div class="ss-card ss-watch" style="background:#121a33;border:1px solid #1e2d5a;border-radius:12px;display:flex;flex-direction:column;overflow:hidden">
        <div style="padding:14px;border-bottom:1px solid #1e2d5a"><div style="display:flex;justify-content:space-between;align-items:center"><div><div style="font-size:14px;font-weight:850">My Portfolio</div><div id="portfolioCount" style="font-size:9px;color:#7C8DB0">0 / 30 stocks tracked</div></div></div></div>
        <div style="padding:10px 12px;background:#0e1429;border-bottom:1px solid #1e2d5a"><div style="display:flex;gap:6px"><input id="portfolioSearch" placeholder="Ticker, company, or BSE code" style="min-width:0;flex:1;padding:8px 10px;background:#070d2b;border:1px solid #1e2d5a;border-radius:8px;color:white;font-size:10px;outline:none"/><button id="portfolioSearchBtn" style="flex:0 0 auto;padding:8px 10px;background:#00d4ff;color:#070d2b;border:none;border-radius:8px;font-weight:700;font-size:10px">+ Add</button></div><div style="font-size:8px;color:#7C8DB0;margin-top:6px">Add NSE/BSE listings separately (example: SBIN.NS or SBIN.BO).</div></div>
        <div class="ss-portfolio-head"><span>Stock</span><span style="text-align:right">LTP</span><span style="text-align:right">Δ Price</span><span style="text-align:right">Δ %</span><span></span></div>
        <div id="portfolioList" class="ss-portfolio-list" style="flex:1 1 auto;overflow:auto;min-height:104px;max-height:min(420px,calc(100vh - 390px));padding:0"></div>
        <div class="ss-portfolio-summary"><div class="ss-portfolio-summary-item">Top gainer<b id="portfolioTopGainer" style="color:#00ff88">--</b></div><div class="ss-portfolio-summary-item">Top loser<b id="portfolioTopLoser" style="color:#ff4444">--</b></div></div>
      </div>
      <div class="ss-detail" style="display:flex;flex-direction:column;gap:12px">
        <div class="ss-card" style="background:#121a33;border:1px solid #1e2d5a;border-radius:12px;padding:16px">
          <div style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap"><div style="flex:1;min-width:260px"><div id="stockName" style="font-size:11px;color:#7fb2ff;font-weight:800;letter-spacing:.04em">SBIN.NS • NSE</div><div style="display:flex;align-items:baseline;gap:12px;margin-top:4px"><h1 id="stockPrice" style="font-size:36px;margin:0;font-weight:850;letter-spacing:-.03em">₹--</h1><div id="change" style="padding:4px 10px;border-radius:20px;font-weight:700;font-size:12px">--</div></div><div class="ss-quote-stats"><span class="ss-quote-stat">Open <b id="dayOpen">--</b></span><span class="ss-quote-stat">Prev close <b id="prevClose">--</b></span><span class="ss-quote-stat">High <b id="dayHigh">--</b></span><span class="ss-quote-stat">Low <b id="dayLow">--</b></span><span class="ss-quote-stat">Volume <b id="dayVol">--</b></span><span class="ss-quote-stat">52W <b id="w52">--</b></span></div><div id="stockDataNotice" class="ss-data-banner" role="status"></div></div><div style="text-align:right;min-width:125px"><div style="font-size:9px;color:#7C8DB0">AI SIGNAL</div><div id="aiSignal" style="margin-top:6px;padding:6px 14px;border-radius:20px;font-weight:800;font-size:12px;border:1px solid #1e2d5a;background:#1e2d5a">--</div><div id="aiDesc" style="font-size:9px;color:#7C8DB0;margin-top:4px">--</div><button id="addPortfolio" style="margin-top:10px;padding:6px 14px;background:#00d4ff;color:#070d2b;border:none;border-radius:20px;font-weight:700;font-size:11px">+ My Portfolio</button></div></div>
          <div class="ss-analysis">
            <div class="ss-analysis-card">
              <div class="ss-analysis-title">Signal Analysis</div>
              <div class="ss-signal-hero"><div><div id="analysisSignal" class="ss-signal-pill">--</div><div id="analysisSignalDesc" style="font-size:9px;color:#7C8DB0;margin-top:3px">Awaiting technical data</div></div><div class="ss-signal-score"><div>TECHNICAL SCORE</div><b id="analysisScore">--</b></div></div>
              <div class="ss-score-track"><div id="analysisScoreFill" class="ss-score-fill"></div></div>
              <div class="ss-signal-bands">Strong Buy 80–100 · Buy 62–79 · Hold 39–61 · Sell 21–38 · Strong Sell 0–20</div>
              <div class="ss-target-card"><div class="ss-target-top"><span class="ss-analysis-title">20-SESSION MODEL TARGET</span><b id="priceTarget" class="ss-target-price">--</b><span id="targetMove" style="font-size:9px;font-weight:800;color:#9fb0cf">--</span></div><div id="targetRange" class="ss-target-range">Estimated range: --</div><div class="ss-target-note">Trend projection from recent returns and signal score; range reflects ATR-based volatility. An estimate, not a guaranteed price.</div></div>
              <div class="ss-breakdown">
                <div class="ss-break"><div class="ss-break-label">RSI</div><div id="analysisRsiState" class="ss-break-value">--</div></div>
                <div class="ss-break"><div class="ss-break-label">Momentum</div><div id="analysisMomentum" class="ss-break-value">--</div></div>
                <div class="ss-break"><div class="ss-break-label">Trend</div><div id="analysisTrend" class="ss-break-value">--</div></div>
              </div>
            </div>
            <div class="ss-analysis-card">
              <div class="ss-analysis-title">Technical Snapshot</div>
              <div class="ss-trend-list">
                <div class="ss-trend-row"><span class="ss-trend-name">RSI (14)</span><b id="rsiValue" class="ss-trend-value">--</b></div>
                <div class="ss-trend-row"><span class="ss-trend-name">SMA 20 / 50</span><b id="smaStatus" class="ss-trend-value">--</b></div>
                <div class="ss-trend-row"><span class="ss-trend-name">SMA 50 / 200</span><b id="smaLongStatus" class="ss-trend-value">--</b></div>
                <div class="ss-trend-row"><span class="ss-trend-name">Price vs SMA20</span><b id="priceTrend" class="ss-trend-value">--</b></div>
              </div>
              <div class="ss-rsi-gauge"><div id="analysisRsiMarker" class="ss-rsi-marker" style="left:50%"></div></div>
              <div class="ss-rsi-labels"><span>Oversold</span><span>Neutral</span><span>Overbought</span></div>
            </div>
          </div>
          <div class="ss-metrics" style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:12px">
            <div style="background:#070d2b;border:1px solid #1e2d5a;border-radius:10px;padding:10px"><div style="font-size:8px;color:#7C8DB0">MOVING AVERAGES</div><div style="font-size:10px;margin-top:3px">20: <b id="sma20">--</b> · 50: <b id="sma50">--</b></div><div style="font-size:10px">200: <b id="sma200">--</b></div></div>
            <div style="background:#070d2b;border:1px solid #1e2d5a;border-radius:10px;padding:10px"><div style="font-size:8px;color:#7C8DB0">RSI POSITION</div><div id="rsiPosition" style="font-size:12px;font-weight:800;margin-top:4px">--</div><div style="font-size:9px;color:#7C8DB0;margin-top:3px">14-period momentum</div></div>
          </div>
          <div class="ss-technical-panel" style="margin-top:12px;background:#070d2b;border:1px solid #1e2d5a;border-radius:10px;padding:12px">
            <div style="display:flex;justify-content:space-between;align-items:center"><div><div style="font-size:9px;color:#7C8DB0;font-weight:800">📈 TECHNICAL INTELLIGENCE</div><div style="font-size:10px;color:#dce8ff;margin-top:3px">Multi-indicator view for better judgement — price action, momentum, trend, volatility and volume.</div></div><span id="technicalSource" style="font-size:8px;color:#6f86b6">1Y DAILY DATA</span></div>
            <div class="ss-tech-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-top:10px">
              <div class="ss-trend-row"><span class="ss-trend-name">EMA 20</span><b id="ema20Value" class="ss-trend-value">--</b></div>
              <div class="ss-trend-row"><span class="ss-trend-name">EMA 50</span><b id="ema50Value" class="ss-trend-value">--</b></div>
              <div class="ss-trend-row"><span class="ss-trend-name">MACD</span><b id="macdValue" class="ss-trend-value">--</b></div>
              <div class="ss-trend-row"><span class="ss-trend-name">MACD Signal</span><b id="macdSignalValue" class="ss-trend-value">--</b></div>
              <div class="ss-trend-row"><span class="ss-trend-name">Stochastic %K</span><b id="stochValue" class="ss-trend-value">--</b></div>
              <div class="ss-trend-row"><span class="ss-trend-name">ATR 14</span><b id="atrValue" class="ss-trend-value">--</b></div>
              <div class="ss-trend-row"><span class="ss-trend-name">Bollinger Position</span><b id="bbValue" class="ss-trend-value">--</b></div>
              <div class="ss-trend-row"><span class="ss-trend-name">Volume Trend</span><b id="volumeTrend" class="ss-trend-value">--</b></div>
              <div class="ss-trend-row"><span class="ss-trend-name">Support</span><b id="supportValue" class="ss-trend-value">--</b></div>
              <div class="ss-trend-row"><span class="ss-trend-name">Resistance</span><b id="resistanceValue" class="ss-trend-value">--</b></div>
              <div class="ss-trend-row"><span class="ss-trend-name">1M Return</span><b id="return1m" class="ss-trend-value">--</b></div>
              <div class="ss-trend-row"><span class="ss-trend-name">3M Return</span><b id="return3m" class="ss-trend-value">--</b></div>
              <div class="ss-trend-row"><span class="ss-trend-name">6M Return</span><b id="return6m" class="ss-trend-value">--</b></div>
              <div class="ss-trend-row"><span class="ss-trend-name">1Y Return</span><b id="return1y" class="ss-trend-value">--</b></div>
              <div class="ss-trend-row"><span class="ss-trend-name">Market Cap</span><b id="marketCapValue" class="ss-trend-value">--</b></div>
              <div class="ss-trend-row"><span class="ss-trend-name">Trend Strength</span><b id="trendStrengthValue" class="ss-trend-value">--</b></div>
            </div>
          </div>
          <div id="screenerBox" style="margin-top:10px;background:#070d2b;border:1px solid #1e2d5a;border-radius:12px;padding:12px"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><div style="font-size:11px;font-weight:700">Stock Screener <span id="screenerPageLabel" style="font-size:9px;color:#7C8DB0"></span></div><div style="display:flex;gap:6px"><button id="screenerBuy" type="button" style="padding:6px 9px;border-radius:7px;border:1px solid #1e2d5a;background:#142747;color:#9fb0cf;font-size:9px;cursor:pointer">RSI &lt;45</button><button id="screenerDeep" type="button" style="padding:6px 9px;border-radius:7px;border:1px solid #1e2d5a;background:#121a33;color:#9fb0cf;font-size:9px;cursor:pointer">RSI &lt;35</button><button id="screenerPrev" type="button" style="padding:6px 9px;border-radius:7px;border:1px solid #1e2d5a;background:#121a33;color:#9fb0cf;font-size:9px;cursor:pointer">Previous 30</button><button id="screenerNext" type="button" style="padding:6px 9px;border-radius:7px;border:1px solid #1e2d5a;background:#121a33;color:#9fb0cf;font-size:9px;cursor:pointer">Next 30</button></div></div><div id="screenerResults" style="max-height:240px;overflow:auto;margin-top:8px">Choose a scan to load live data from the stock catalog.</div></div>
        </div>
      </div>
    </div>
    </div>
    <div id="ss-market-view" style="display:none;max-width:1450px;margin:0 auto;padding:16px">
      <div class="ss-card" style="background:#121a33;border:1px solid #1e2d5a;border-radius:14px;padding:16px">
        <div style="display:flex;justify-content:space-between;align-items:end;gap:12px;flex-wrap:wrap">
          <div><div style="font-size:16px;font-weight:900">Market Overview</div><div style="font-size:10px;color:#7C8DB0;margin-top:3px">Indian and global index levels, daily changes and local trading hours.</div></div>
          <div id="globalMarketUpdated" style="font-size:9px;color:#7C8DB0">--</div>
        </div>
        <div id="globalIndices" class="ss-global-grid" style="margin-top:14px"></div>
      </div>
      <div class="ss-card" style="margin-top:12px;background:#121a33;border:1px solid #1e2d5a;border-radius:14px;padding:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div style="font-size:14px;font-weight:900;letter-spacing:.08em">NEWS</div><span style="font-size:9px;color:#8fb8ff">MARKET HEADLINES</span></div>
        <div id="newsBox" style="margin-top:10px;font-size:11px"></div>
      </div>
    </div>
    <div style="background:#1a1400;border-top:1px solid #3d3000;padding:12px 16px;text-align:center"><div style="font-size:11px;color:#ffcc66;line-height:16px;max-width:900px;margin:0 auto"><b>⚠️ Disclaimer:</b> This app is a hobby project, made for educational purpose only. Buy/sell signals and 20-session targets are rule-based estimates from historical indicators; they are not guarantees or personalized investment advice. Do your own market research before investing or trading. We are not SEBI registered. Market data may be delayed.</div></div>
  </div>`;
}

async function renderPortfolio(){
  try{
    const stocks=await getStocksBySymbols(portfolio);
    STOCK_META=new Map();
    for(const stock of stocks){
      const aliases=[stock.yahoo_ticker,...(stock.listings||[]).map(item=>item.yahooTicker)];
      for(const alias of aliases.filter(Boolean))STOCK_META.set(alias.toUpperCase(),stock);
    }
  }catch(error){console.warn("[StockSense] portfolio catalog",error);}
  const list=portfolio.map(symbol=>{
    const stock=STOCK_META.get(symbol);
    return {symbol,display:selectedDisplay(stock,symbol),name:stock?.company||selectedDisplay(stock,symbol),exchange:selectedExchange(stock,symbol)};
  });
  setText("portfolioCount",list.length+" / "+PORTFOLIO_MAX+" stocks tracked");
  const box=document.getElementById("portfolioList"); if(!box)return;
  if(!list.length){box.innerHTML="<div class='ss-portfolio-empty'><span class='ss-portfolio-empty-mark'>+</span><b style='color:#dce8ff'>Your portfolio is empty</b><span>Search above to add a stock. NSE and BSE listings can be tracked separately.</span></div>";setText("portfolioTopGainer","--");setText("portfolioTopLoser","--");return;}
  const quotes=await getQuotesBatch(list.map(s=>s.symbol));
  const live=list.map(s=>{const q=quotes.get(String(s.symbol).toUpperCase());return q?{...s,...q}:{...s,price:null,change:null,changePct:null};});
  box.innerHTML=live.map(s=>{
    const changeColor=Number.isFinite(s.change)?(s.change>=0?"#00ff88":"#ff6b78"):"#7C8DB0";
    const percentColor=Number.isFinite(s.changePct)?(s.changePct>=0?"#00ff88":"#ff6b78"):"#7C8DB0";
    return `<div data-row class="ss-portfolio-row" title="View ${escapeHtml(s.display)} on ${escapeHtml(s.exchange)}"><div class="ss-portfolio-stock"><div class="ss-portfolio-symbol">${escapeHtml(s.display)}</div><div class="ss-portfolio-company">${escapeHtml(s.name||"")} · ${escapeHtml(s.exchange)}</div></div><div class="ss-portfolio-number">${money(s.price)}</div><div class="ss-portfolio-number" style="color:${changeColor}">${signedMoney(s.change)}</div><div class="ss-portfolio-number" style="color:${percentColor}">${percent(s.changePct)}</div><button type="button" class="ss-portfolio-remove" data-remove="${escapeHtml(s.symbol)}" aria-label="Remove ${escapeHtml(s.display)}">×</button></div>`;
  }).join("");
  box.querySelectorAll("[data-row]").forEach(row=>row.onclick=()=>loadStockGlobal(row.querySelector("[data-remove]")?.dataset.remove||""));
  box.querySelectorAll("[data-remove]").forEach(btn=>btn.onclick=e=>{e.stopPropagation();removeFromPortfolio(btn.dataset.remove);});
  const valid=live.filter(x=>Number.isFinite(x.changePct));
  if(valid.length){const gain=[...valid].sort((x,y)=>y.changePct-x.changePct)[0],lose=[...valid].sort((x,y)=>x.changePct-y.changePct)[0];setText("portfolioTopGainer",symbolLabel(gain.symbol)+" "+percent(gain.changePct));setText("portfolioTopLoser",symbolLabel(lose.symbol)+" "+percent(lose.changePct));}
}
function addToPortfolio(symbol){
  const canonical=String(symbol||"").toUpperCase(); if(!canonical)return;
  if(portfolio.includes(canonical)){loadStockGlobal(canonical);return;}
  if(portfolio.length>=PORTFOLIO_MAX){alert("Your portfolio can track a maximum of 30 stocks.");return;}
  portfolio.push(canonical);savePortfolio();renderPortfolio();loadStockGlobal(canonical);
}
function removeFromPortfolio(symbol){portfolio=portfolio.filter(s=>s!==symbol);savePortfolio();renderPortfolio();}
async function addPortfolioSearchValue(value){
  const query=String(value||"").trim();if(!query)return;
  const button=document.getElementById("portfolioSearchBtn");
  if(button)button.disabled=true;
  try{
    const matches=await searchSymbols(query);
    const needle=query.toUpperCase();
    const chosen=matches.find(stock=>[stock.symbol,stock.display,stock.isin,...(stock.listings||[]).flatMap(item=>[item.yahooTicker,item.symbol,item.scripCode])].some(value=>String(value||"").toUpperCase()===needle))||matches[0];
    if(!chosen){alert("No active NSE or BSE listing matched that search.");return;}
    const listings=selectableListings(chosen);
    const selected=listings.find(item=>[item.yahooTicker,item.symbol,item.scripCode].some(value=>String(value||"").toUpperCase()===needle))
      ||listings.find(item=>item.yahooTicker===String(chosen.yahoo_ticker||chosen.symbol||"").toUpperCase())
      ||listings[0];
    addToPortfolio(selected?.yahooTicker||chosen.yahoo_ticker||chosen.symbol);
    const input=document.getElementById("portfolioSearch");if(input)input.value="";
  }catch(error){alert("The stock catalog is temporarily unavailable. Please try again.");console.warn("[StockSense] portfolio search",error);}
  finally{if(button)button.disabled=false;}
}
function setupSearch(){
  const input=document.getElementById("searchAll"),results=document.getElementById("searchResults");
  let timer=0,seq=0;
  input.addEventListener("input",()=>{
    const q=input.value.trim();clearTimeout(timer);const my=++seq;
    if(!q){results.style.display="none";return;}
    results.style.display="block";results.innerHTML="<div style='padding:12px;color:#7C8DB0;font-size:11px'>Searching the NSE and BSE stock catalog…</div>";
    const draw=matches=>{results.innerHTML=matches.length?matches.map(stock=>{
      const listings=selectableListings(stock);
      const choices=listings.map(item=>{
        const ticker=item.yahooTicker||item.yahoo_ticker;
        const label=item.symbol||item.scripCode||symbolLabel(ticker);
        return `<button type="button" class="ss-listing-option" data-s="${escapeHtml(ticker)}" aria-label="Open ${escapeHtml(stock.name)} on ${escapeHtml(item.exchange)}">${escapeHtml(item.exchange)} · ${escapeHtml(label)}</button>`;
      }).join("");
      return `<div class="ss-search-result"><div class="ss-search-result-copy"><b>${escapeHtml(stock.display)}</b><span style="display:block;color:#7C8DB0;font-size:9px;margin-top:2px">${escapeHtml(stock.name)}</span></div><div class="ss-listing-options">${choices}</div></div>`;
    }).join(""):"<div style='padding:12px;color:#7C8DB0;font-size:11px'>No matching active NSE/BSE stock found.</div>";results.style.display="block";results.querySelectorAll("[data-s]").forEach(x=>x.onclick=()=>{loadStockGlobal(x.dataset.s);results.style.display="none";input.value="";});};
    timer=setTimeout(async()=>{try{const matches=await searchSymbols(q);if(my!==seq)return;draw(matches);}catch(error){if(my!==seq)return;results.innerHTML="<div style='padding:12px;color:#ffcc66;font-size:11px'>Stock catalog is temporarily unavailable. Please retry.</div>";console.warn("[StockSense] catalog search",error);}},180);
  });
  const pInput=document.getElementById("portfolioSearch"),pBtn=document.getElementById("portfolioSearchBtn");
  const add=()=>addPortfolioSearchValue(pInput.value);
  pBtn.onclick=add;pInput.addEventListener("keydown",e=>{if(e.key==="Enter")add();});
}
function loadPortfolio(){loadPortfolioData();renderPortfolio();}
function setupPortfolio(){document.getElementById("addPortfolio").onclick=()=>addToPortfolio(currentSymbol);}
function renderNews(items){
  const box=document.getElementById("newsBox");
  if(!box)return;
  if(!items?.length){box.innerHTML="<div style='padding:8px;background:#0e1429;border-radius:6px;color:#7C8DB0'>No market headlines are available right now.</div>";return;}
  box.innerHTML=items.map(n=>{
    const published=n.published instanceof Date&&!Number.isNaN(n.published.getTime())?" · "+n.published.toLocaleString("en-IN",{timeZone:"Asia/Kolkata",day:"numeric",month:"short",hour:"numeric",minute:"2-digit"}):"";
    return `<article class="ss-news-item"><a class="ss-news-title" href="${escapeHtml(safeExternalUrl(n.link))}" target="_blank" rel="noopener noreferrer" style="color:white;text-decoration:none">${escapeHtml(n.title || "Untitled news item")}</a><div class="ss-news-meta">${escapeHtml(n.publisher || "Market news")}${escapeHtml(published)}</div></article>`;
  }).join("");
}
function emaSeries(values,period){
  if(!Array.isArray(values)||values.length<period)return [];
  const k=2/(period+1),out=new Array(values.length).fill(null);
  let seed=values.slice(0,period).reduce((a,b)=>a+b,0)/period; out[period-1]=seed;
  for(let i=period;i<values.length;i++) out[i]=values[i]*k+out[i-1]*(1-k);
  return out;
}
function latestFinite(arr){for(let i=arr.length-1;i>=0;i--)if(Number.isFinite(arr[i]))return arr[i];return null;}
function pctFromPrice(closes,lookback,price){
  if(!price||closes.length<=lookback)return null;
  const base=closes[closes.length-1-lookback];
  return Number.isFinite(base)&&base!==0?(price-base)/base*100:null;
}
function technicalSnapshot(data){
  const c=data.closes||[], h=data.highs||[], l=data.lows||[], v=data.volumes||[], price=data.price;
  const ema20=latestFinite(emaSeries(c,20)), ema50=latestFinite(emaSeries(c,50));
  const e12=emaSeries(c,12),e26=emaSeries(c,26),macdSeries=c.map((_,i)=>Number.isFinite(e12[i])&&Number.isFinite(e26[i])?e12[i]-e26[i]:null);
  const macd=latestFinite(macdSeries), macdSignal=latestFinite(emaSeries(macdSeries.filter(Number.isFinite),9));
  const highs=h.filter(Number.isFinite), lows=l.filter(Number.isFinite);
  let atr=null;
  if(h.length>=15&&l.length>=15){
    const tr=[]; for(let i=1;i<h.length;i++){const hi=h[i],lo=l[i],pc=c[i-1];if(Number.isFinite(hi)&&Number.isFinite(lo)&&Number.isFinite(pc))tr.push(Math.max(hi-lo,Math.abs(hi-pc),Math.abs(lo-pc)));}
    atr=tr.length>=14?tr.slice(-14).reduce((a,b)=>a+b,0)/14:null;
  }
  const n=14;
  const hh=highs.slice(-n),ll=lows.slice(-n),hi=hh.length?Math.max(...hh):null,lo=ll.length?Math.min(...ll):null;
  const stoch=hi!=null&&lo!=null&&hi!==lo?((price-lo)/(hi-lo))*100:null;
  const mid=calcSMA(c,20),sd=c.length>=20?Math.sqrt(c.slice(-20).reduce((s,x)=>s+Math.pow(x-mid,2),0)/20):null;
  const upper=mid!=null&&sd!=null?mid+2*sd:null,lower=mid!=null&&sd!=null?mid-2*sd:null;
  const bbPos=upper!=null&&lower!=null&&upper!==lower?((price-lower)/(upper-lower))*100:null;
  const vol20=v.filter(Number.isFinite).slice(-20),avgVol=vol20.length?vol20.reduce((a,b)=>a+b,0)/vol20.length:null;
  const lastVol=latestFinite(v),volumeRatio=avgVol&&lastVol?lastVol/avgVol:null;
  const recentLows=lows.slice(-20),recentHighs=highs.slice(-20);
  const support=recentLows.length?Math.min(...recentLows):null,resistance=recentHighs.length?Math.max(...recentHighs):null;
  const rsi=calcRSI(c),sma20=calcSMA(c,20),sma50=calcSMA(c,50),sma200=calcSMA(c,200);
  const trendScore=(price>sma20?1:-1)+(sma20>sma50?1:-1)+(sma50>sma200?1:-1)+(ema20>ema50?1:-1)+(macd>macdSignal?1:-1);
  return {price,rsi,sma20,sma50,sma200,ema20,ema50,macd,macdSignal,stoch,atr,bbPos,volumeRatio,support,resistance,
    return1m:pctFromPrice(c,21,price),return3m:pctFromPrice(c,63,price),return6m:pctFromPrice(c,126,price),return1y:pctFromPrice(c,252,price),
    range52Low:data.low52,range52High:data.high52,trendScore};
}
function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
function nearTermTarget(price,tech,score){
  if(!Number.isFinite(price)||price<=0||!Number.isFinite(tech?.atr)||tech.atr<=0)return null;
  const inputs=[
    [Number.isFinite(tech.return1m)?clamp(tech.return1m,-15,15):null,.5],
    [Number.isFinite(tech.return3m)?clamp(tech.return3m/3,-10,10):null,.3],
    [Number.isFinite(score)?clamp((score-50)*.08,-4,4):null,.2]
  ].filter(([value])=>value!=null);
  if(!inputs.length)return null;
  const weight=inputs.reduce((sum,[,w])=>sum+w,0);
  const expectedReturn=clamp(inputs.reduce((sum,[value,w])=>sum+value*w,0)/weight,-12,12);
  const target=price*(1+expectedReturn/100);
  const rangePct=clamp((tech.atr/price)*Math.sqrt(20)*100,2,20);
  return {target,low:Math.max(0,target*(1-rangePct/100)),high:target*(1+rangePct/100),expectedReturn};
}
function loadMarketCap(symbol,requestId,savedValue=null,wait=false){
  if(wait){setText("marketCapValue","New listing");return;}
  if(Number.isFinite(savedValue)){setText("marketCapValue","₹"+formatCompactNumber(savedValue));return;}
  setText("marketCapValue","Loading…");
  getMarketCap(symbol).then(({marketCap})=>{
    if(requestId!==stockRequestId)return;
    setText("marketCapValue",Number.isFinite(marketCap)?"₹"+formatCompactNumber(marketCap):"N/A");
  }).catch(()=>{if(requestId===stockRequestId)setText("marketCapValue","N/A");});
}
function stockToday(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
function savedSnapshotQuote(snapshot,symbol){
  const snapshotTicker=String(snapshot?.ticker||"").toUpperCase();
  if(snapshotTicker&&snapshotTicker!==String(symbol||"").toUpperCase())return null;
  const bars=Array.isArray(snapshot?.bars)?snapshot.bars:[];
  if(bars.length<2)return null;
  const quote=snapshot.quote||{},last=bars[bars.length-1],previous=bars[bars.length-2];
  const closes=bars.map(bar=>bar.close).filter(Number.isFinite);
  return {symbol,price:Number.isFinite(quote.price)?quote.price:last.close,prev:Number.isFinite(quote.previousClose)?quote.previousClose:previous.close,open:quote.open,high:quote.high,low:quote.low,vol:quote.volume,low52:quote.low52,high52:quote.high52,closes,timestamps:bars.map(bar=>Math.floor(Date.parse(bar.date+"T00:00:00Z")/1000)),opens:bars.map(bar=>bar.open),highs:bars.map(bar=>bar.high),lows:bars.map(bar=>bar.low),volumes:bars.map(bar=>bar.volume)};
}
function enoughSignalHistory(tech,closes){
  return closes.length>=200&&[tech.rsi,tech.sma20,tech.sma50,tech.sma200,tech.ema20,tech.ema50,tech.macd,tech.macdSignal,tech.stoch,tech.bbPos,tech.volumeRatio].every(Number.isFinite);
}
function historyValue(value,required,format,historyLength){
  if(historyLength<required)return "Not enough history yet";
  return Number.isFinite(value)?format(value):"N/A";
}
function setNewListingNotice(record,notice){
  const banner=document.getElementById("stockDataNotice");if(!banner)return;
  if(!notice){banner.style.display="none";banner.textContent="";return;}
  banner.textContent=notice;banner.style.display="block";
  if(record?.data_status==="pending")banner.style.borderColor="rgba(255,204,102,.35)";
}
function showNewListingGate(date){
  const message=`New listing — real fundamentals and technical indicators will be available from ${date||"the data availability date"}.`;
  ["w52","rsiValue","smaStatus","smaLongStatus","priceTrend","sma20","sma50","sma200","rsiPosition","ema20Value","ema50Value","macdValue","macdSignalValue","stochValue","atrValue","bbValue","volumeTrend","supportValue","resistanceValue","return1m","return3m","return6m","return1y","trendStrengthValue","marketCapValue","analysisScore","analysisRsiState","analysisMomentum","analysisTrend","priceTarget","targetMove"].forEach(id=>setText(id,"New listing"));
  setText("technicalSource","NEW LISTING · DATA LATER");
  setText("aiSignal","New listing");setText("aiDesc",message);setText("analysisSignal","New listing");setText("analysisSignalDesc",message);setText("targetRange",message);
}
async function loadStock(symbol){
  const requestId=++stockRequestId;
  let quoteLoaded=false;
  currentSymbol=String(symbol||"").toUpperCase();
  const resetIds=["dayOpen","prevClose","dayHigh","dayLow","dayVol","w52","marketCapValue","rsiValue","smaStatus","smaLongStatus","priceTrend","sma20","sma50","sma200","rsiPosition","ema20Value","ema50Value","macdValue","macdSignalValue","stochValue","atrValue","bbValue","volumeTrend","supportValue","resistanceValue","return1m","return3m","return6m","return1y","trendStrengthValue","analysisScore","analysisRsiState","analysisMomentum","analysisTrend","priceTarget","targetMove"];
  setText("stockName",currentSymbol+" • loading");setText("stockPrice","₹--");setText("change","Loading live data...");
  resetIds.forEach(id=>setText(id,"--"));setText("targetRange","Estimated range: --");
  ["aiSignal","analysisSignal"].forEach(id=>setText(id,"Loading…"));setText("aiDesc","Loading market data…");setText("analysisSignalDesc","Loading technical data…");setNewListingNotice(null,"");
  const scoreFill=document.getElementById("analysisScoreFill");if(scoreFill)scoreFill.style.width="0%";
  const marker=document.getElementById("analysisRsiMarker");if(marker)marker.style.left="50%";
  try{
    const stockRecord=await getCatalogStock(currentSymbol);
    if(requestId!==stockRequestId)return;
    if(!stockRecord){
      setText("stockName",currentSymbol+" • not in exchange catalog");
      setText("change","NOT IN CATALOG");setText("aiSignal","UNAVAILABLE");setText("aiDesc","Select an active NSE or BSE stock from catalog search.");
      setText("analysisSignal","UNAVAILABLE");setText("analysisSignalDesc","This ticker is not in the exchange catalog.");
      return;
    }
    const today=stockToday(),expected=stockRecord.data_available_from||null;
    const inNewListingWait=!stockRecord.data_ready&&expected&&expected>today;
    const listingDescription=stockRecord.data_available_from_source==="first_seen_on_bse_feed"
      ?`First detected on ${stockRecord.date_added}; the BSE active scrip feed does not include listing dates. The 14-day wait ends on ${expected}.`
      :`Listed on ${stockRecord.listing_date||"date unavailable"}. Real data is expected from ${expected||"the date is confirmed"}.`;
    if(inNewListingWait)setNewListingNotice(stockRecord,`New listing · ${listingDescription}`);
    else if(!stockRecord.data_ready){
      const missing=(stockRecord.missing_data||[]).map(value=>value==="fundamental"?"fundamental":"technical");
      setNewListingNotice(stockRecord,`Data pending · Missing ${missing.length?missing.join(" and "):"technical and fundamental"} data after the waiting period. The daily job retries automatically.`);
    }else setNewListingNotice(stockRecord,"");

    const savedPromise=inNewListingWait?Promise.resolve(null):getSavedStockData(currentSymbol).catch(()=>null);
    const [liveResult,savedData]=await Promise.all([getFastQuote(currentSymbol).then(data=>({data})).catch(error=>({error})),savedPromise]);
    if(requestId!==stockRequestId)return;
    const savedQuote=savedSnapshotQuote(savedData,currentSymbol);
    let data=liveResult.data?{...liveResult.data}:savedQuote?{...savedQuote}:null;
    if(!data)throw liveResult.error||new Error("No real quote or saved Yahoo data is available");
    quoteLoaded=true;
    const historySource=savedQuote&&savedQuote.closes.length>(liveResult.data?.closes?.length||0)?savedQuote:liveResult.data||savedQuote;
    data={...historySource,...data,closes:historySource?.closes||data.closes||[],timestamps:historySource?.timestamps||data.timestamps||[],opens:historySource?.opens||data.opens||[],highs:historySource?.highs||data.highs||[],lows:historySource?.lows||data.lows||[],volumes:historySource?.volumes||data.volumes||[],symbol:currentSymbol};
    document.getElementById("stockName").textContent=`${stockRecord.company} • ${selectedExchange(stockRecord,currentSymbol)} • ${new Date().toLocaleTimeString("en-IN")}`;
    setText("stockPrice",money(data.price));
    const change=document.getElementById("change");
    const absoluteChange=Number.isFinite(data.change)?(data.change>=0?"+":"−")+money(Math.abs(data.change)):Number.isFinite(data.price)&&Number.isFinite(data.prev)?(data.price>=data.prev?"+":"−")+money(Math.abs(data.price-data.prev)):"N/A";
    const changePct=Number.isFinite(data.changePct)?data.changePct:(Number.isFinite(data.price)&&Number.isFinite(data.prev)&&data.prev!==0?(data.price-data.prev)/data.prev*100:null);
    change.textContent=absoluteChange+" ("+percent(changePct)+")";change.title="Change from previous close";change.style.background=Number.isFinite(changePct)?(changePct>=0?"rgba(0,255,136,.15)":"rgba(255,68,68,.15)"):"rgba(124,141,176,.12)";change.style.color=Number.isFinite(changePct)?(changePct>=0?"#00ff88":"#ff4444"):"#7C8DB0";
    setText("dayOpen",money(data.open));setText("prevClose",money(data.prev));setText("dayHigh",money(data.high));setText("dayLow",money(data.low));setText("dayVol",Number.isFinite(data.vol)?(data.vol/1e6).toFixed(2)+"M":"N/A");setText("w52",Number.isFinite(data.low52)&&Number.isFinite(data.high52)?money(data.low52)+" / "+money(data.high52):"N/A");
    if(inNewListingWait){showNewListingGate(expected);return;}
    const savedMarketCap=savedData?.fundamentals?.marketCap;
    loadMarketCap(currentSymbol,requestId,savedMarketCap,inNewListingWait);
    if(!Array.isArray(data.closes)||data.closes.length<2){
      try{const technical=await getTechnicalData(currentSymbol);data.closes=technical.closes;data.highs=technical.highs;data.lows=technical.lows;data.volumes=technical.volumes;}catch(error){console.warn("[StockSense] technical data",error);data.closes=[];}
    }
    if(requestId!==stockRequestId)return;
    const closes=data.closes||[];
    if(!Number.isFinite(data.low52)&&closes.length>=252)data.low52=Math.min(...closes.slice(-252));
    if(!Number.isFinite(data.high52)&&closes.length>=252)data.high52=Math.max(...closes.slice(-252));
    setText("w52",Number.isFinite(data.low52)&&Number.isFinite(data.high52)?money(data.low52)+" / "+money(data.high52):closes.length<252?"Not enough history yet":"N/A");
    const tech=technicalSnapshot(data);Object.assign(data,tech);
    setText("technicalSource",closes.length?`${closes.length} YAHOO DAILY BARS`:"YAHOO DAILY DATA");
    setText("rsiValue",historyValue(tech.rsi,15,value=>value.toFixed(1),closes.length));
    setText("sma20",historyValue(tech.sma20,20,money,closes.length));setText("sma50",historyValue(tech.sma50,50,money,closes.length));setText("sma200",historyValue(tech.sma200,200,money,closes.length));
    setText("ema20Value",historyValue(tech.ema20,20,money,closes.length));setText("ema50Value",historyValue(tech.ema50,50,money,closes.length));
    setText("macdValue",historyValue(tech.macd,34,value=>value.toFixed(2),closes.length));setText("macdSignalValue",historyValue(tech.macdSignal,42,value=>value.toFixed(2),closes.length));
    setText("stochValue",historyValue(tech.stoch,14,value=>value.toFixed(1),closes.length));setText("atrValue",historyValue(tech.atr,15,money,closes.length));
    setText("bbValue",historyValue(tech.bbPos,20,value=>value.toFixed(0)+"% of band",closes.length));
    setText("volumeTrend",historyValue(tech.volumeRatio,20,value=>value.toFixed(2)+"× avg",closes.length));
    setText("supportValue",historyValue(tech.support,20,money,closes.length));setText("resistanceValue",historyValue(tech.resistance,20,money,closes.length));
    setText("return1m",historyValue(tech.return1m,22,percent,closes.length));setText("return3m",historyValue(tech.return3m,64,percent,closes.length));setText("return6m",historyValue(tech.return6m,127,percent,closes.length));setText("return1y",historyValue(tech.return1y,253,percent,closes.length));
    const trendAvailable=Number.isFinite(tech.sma20)&&Number.isFinite(tech.sma50)&&Number.isFinite(tech.sma200)&&Number.isFinite(tech.ema20)&&Number.isFinite(tech.ema50);
    setText("trendStrengthValue",trendAvailable?(tech.trendScore>=4?"Strong bullish":tech.trendScore>=2?"Bullish":tech.trendScore<=-4?"Strong bearish":tech.trendScore<=-2?"Bearish":"Mixed"):(closes.length<200?"Not enough history yet":"N/A"));
    const rsiState=tech.rsi==null?(closes.length<15?"Not enough history yet":"N/A"):tech.rsi<30?"Oversold":tech.rsi<45?"Weak / recovering":tech.rsi<=70?"Neutral / healthy":tech.rsi<=80?"Overbought":"Highly overbought";
    const momentum=tech.rsi==null?(closes.length<15?"Not enough history yet":"N/A"):tech.rsi<30?"Strong downside reversal zone":tech.rsi<45?"Bearish momentum":tech.rsi>70?"Overheated momentum":"Balanced momentum";
    const trend20_50=Number.isFinite(tech.sma20)&&Number.isFinite(tech.sma50)?(tech.sma20>tech.sma50?"Bullish":"Bearish"):closes.length<50?"Not enough history yet":"N/A";
    const trend50_200=Number.isFinite(tech.sma50)&&Number.isFinite(tech.sma200)?(tech.sma50>tech.sma200?"Bullish":"Bearish"):closes.length<200?"Not enough history yet":"N/A";
    const priceVs20=Number.isFinite(data.price)&&Number.isFinite(tech.sma20)?(data.price>tech.sma20?"Above SMA20":"Below SMA20"):closes.length<20?"Not enough history yet":"N/A";
    setText("smaStatus",trend20_50);setText("smaLongStatus",trend50_200);setText("priceTrend",priceVs20);setText("rsiPosition",rsiState);
    setText("analysisRsiState",rsiState);setText("analysisMomentum",momentum);
    setText("analysisTrend",trendAvailable?(tech.trendScore>=4?"Strong bullish":tech.trendScore>=2?"Bullish":tech.trendScore<=-4?"Strong bearish":tech.trendScore<=-2?"Bearish":"Mixed"):(closes.length<200?"Not enough history yet":"N/A"));
    const rsiMarker=document.getElementById("analysisRsiMarker");if(rsiMarker)rsiMarker.style.left=(tech.rsi==null?"50%":Math.max(0,Math.min(100,tech.rsi))+"%");
    const signalReady=Boolean(stockRecord.data_ready&&enoughSignalHistory(tech,closes));
    let signal=null;
    if(signalReady){
      signal=getAISignal(tech);
      setText("analysisScore",signal.score+"/100");setText("aiSignal",signal.t);setText("aiDesc",signal.desc);setText("analysisSignal",signal.t);setText("analysisSignalDesc",signal.desc);
      if(scoreFill){scoreFill.style.width=signal.score+"%";scoreFill.style.background=signal.c;}
      ["aiSignal","analysisSignal"].forEach(id=>{const el=document.getElementById(id);if(el)el.style.color=signal.c;});
    }else{
      setText("analysisScore","Pending");setText("aiSignal","Signal pending");setText("aiDesc",!stockRecord.data_ready?"Real data is still pending from Yahoo Finance.":"Waiting for all signal indicators to have enough real history.");
      setText("analysisSignal","Signal pending");setText("analysisSignalDesc","The signal activates when Yahoo data is ready and the required indicators have enough history.");
    }
    const target=signal?nearTermTarget(data.price,tech,signal.score):null;
    setText("priceTarget",target?money(target.target):signalReady?"N/A":"Pending");setText("targetMove",target?percent(target.expectedReturn):"--");
    setText("targetRange",target?"Estimated range: "+money(target.low)+" – "+money(target.high)+" over 20 sessions":signalReady?"Estimated range unavailable — historical volatility data is missing":"Target pending until the data and signal are ready");
    const move=document.getElementById("targetMove");if(move&&target)move.style.color=target.expectedReturn>=0?"#22c55e":"#f87171";
    setText("t_rsi",Number.isFinite(data.rsi)?data.rsi.toFixed(1):"N/A");setText("t_sma20",money(data.sma20));setText("t_sma50",money(data.sma50));setText("t_sma200",money(data.sma200));
  }catch(error){
    if(requestId!==stockRequestId)return;
    if(!quoteLoaded){setText("stockPrice","₹--");setText("change","DATA UNAVAILABLE");const change=document.getElementById("change");if(change){change.style.color="#ffcc00";change.style.background="rgba(255,204,0,.12)";}setText("aiSignal","UNAVAILABLE");setText("aiDesc","Live Yahoo Finance data is temporarily unavailable. Please retry shortly.");}
    else{setText("aiSignal","Signal pending");setText("aiDesc","Technical history is temporarily unavailable.");}
    setText("analysisSignal","Signal pending");setText("analysisSignalDesc","Waiting for sufficient real technical data.");setText("analysisScore","--");
    console.warn("[StockSense] stock data",error);
  }
}
function marketState(timeZone,openHour,openMinute,closeHour,closeMinute){
  const now=new Date();
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone,hour:"2-digit",minute:"2-digit",hour12:false,weekday:"short"}).formatToParts(now);
  const get=t=>parts.find(p=>p.type===t)?.value;
  const day=get("weekday"),h=Number(get("hour")),m=Number(get("minute"));
  const mins=h*60+m,open=openHour*60+openMinute,close=closeHour*60+closeMinute;
  const weekday=day!=="Sat"&&day!=="Sun";
  return {open:weekday&&mins>=open&&mins<close,time:get("hour")+":"+get("minute"),weekday:day};
}
async function loadGeneralMarketNews(){
  if(generalNewsPromise)return generalNewsPromise;
  if(generalNewsLoadedAt&&Date.now()-generalNewsLoadedAt<GENERAL_NEWS_CACHE_MS)return;
  generalNewsPromise=(async()=>{
    const box=document.getElementById("newsBox");
    if(box&&!box.textContent.trim())box.textContent="Loading latest news…";
    try{renderNews(await getNews("MARKET"));generalNewsLoadedAt=Date.now();}
    catch{renderNews([]);generalNewsLoadedAt=Date.now();}
  })().finally(()=>{generalNewsPromise=null;});
  return generalNewsPromise;
}
async function loadGlobalMarket(){
  if(globalMarketPromise)return globalMarketPromise;
  if(globalMarketLoadedAt&&Date.now()-globalMarketLoadedAt<GLOBAL_MARKET_CACHE_MS)return;
  globalMarketPromise=(async()=>{
  const markets=[
    ["^NSEI","NIFTY 50","India","Asia/Kolkata","09:15–15:30 IST",9,15,15,30],
    ["^BSESN","SENSEX","India","Asia/Kolkata","09:15–15:30 IST",9,15,15,30],
    ["^GSPC","S&P 500","USA","America/New_York","09:30–16:00 ET",9,30,16,0],
    ["^IXIC","NASDAQ","USA","America/New_York","09:30–16:00 ET",9,30,16,0],
    ["^DJI","Dow Jones","USA","America/New_York","09:30–16:00 ET",9,30,16,0],
    ["^FTSE","FTSE 100","UK","Europe/London","08:00–16:30 GMT/BST",8,0,16,30],
    ["^GDAXI","DAX","Germany","Europe/Berlin","09:00–17:30 CET/CEST",9,0,17,30],
    ["^N225","Nikkei 225","Japan","Asia/Tokyo","09:00–15:30 JST",9,0,15,30],
    ["^HSI","Hang Seng","Hong Kong","Asia/Hong_Kong","09:30–16:00 HKT",9,30,16,0],
    ["000001.SS","Shanghai Composite","China","Asia/Shanghai","09:30–15:00 CST",9,30,15,0]
  ];
  const box=document.getElementById("globalIndices"); if(!box)return;
  box.innerHTML=markets.map(m=>'<div class="ss-global-card"><div class="ss-global-top"><div><div class="ss-global-name">'+escapeHtml(m[1])+'</div><div class="ss-global-region">'+escapeHtml(m[2])+'</div></div><span data-status="'+escapeHtml(m[0])+'" style="font-size:8px;color:#7C8DB0">--</span></div><div data-price="'+escapeHtml(m[0])+'" class="ss-global-price">--</div><div data-change="'+escapeHtml(m[0])+'" class="ss-global-change">--</div><div class="ss-global-time">Trading hours: '+escapeHtml(m[4])+'<br><span data-clock="'+escapeHtml(m[0])+'">Local time --</span></div></div>').join("");
  const quotes=await getQuotesBatch(markets.map(m=>m[0]));
  for(const m of markets){
    const q=quotes.get(m[0].toUpperCase()), state=marketState(m[3],m[5],m[6],m[7],m[8]);
    const price=document.querySelector('[data-price="'+CSS.escape(m[0])+'"]');
    const change=document.querySelector('[data-change="'+CSS.escape(m[0])+'"]');
    const status=document.querySelector('[data-status="'+CSS.escape(m[0])+'"]');
    const clock=document.querySelector('[data-clock="'+CSS.escape(m[0])+'"]');
    if(price)price.textContent=q?formatIndexNumber(q.price):"--";
    if(change){
      const validChange=q&&Number.isFinite(q.change)&&Number.isFinite(q.changePct);
      const up=validChange&&q.change>=0;
      const absolute=validChange?formatIndexNumber(Math.abs(q.change)):null;
      change.textContent=validChange?(up?"▲ ":"▼ ")+(up?"+":"−")+absolute+" pts · "+percent(q.changePct):"Data unavailable";
      change.style.color=validChange?(up?"#00ff88":"#ff6b78"):"#7C8DB0";
      change.style.background=validChange?(up?"rgba(0,255,136,.10)":"rgba(255,68,68,.12)"):"transparent";
      change.title="Change from previous close in index points and percent";
    }
    if(status){status.textContent=state.open?"OPEN":"CLOSED";status.style.color=state.open?"#00ff88":"#7C8DB0";}
    if(clock){const local=new Intl.DateTimeFormat("en-US",{timeZone:m[3],hour:"numeric",minute:"2-digit",second:"2-digit",hour12:true}).format(new Date());clock.textContent=local+" • "+state.weekday;}
  }
  setText("globalMarketUpdated","Updated "+new Date().toLocaleTimeString("en-IN",{timeZone:"Asia/Kolkata"})+" IST");
  globalMarketLoadedAt=Date.now();
  })().finally(()=>{globalMarketPromise=null;});
  return globalMarketPromise;
}
async function loadIndices(){
  const syms=[
    ["^NSEI","NIFTY 50"],["^CNX100","NIFTY 100"],["^CNX500","NIFTY 500"],["NIFTYMIDCAP150.NS","NIFTY Midcap 150"],
    ["^NSEBANK","NIFTY Bank"],["^CNXFIN","NIFTY Financial Services"],["^CNXIT","NIFTY IT"],["^CNXAUTO","NIFTY Auto"],
    ["^CNXPHARMA","NIFTY Pharma"],["^CNXFMCG","NIFTY FMCG"],["^CNXMETAL","NIFTY Metal"],["^CNXREALTY","NIFTY Realty"],
    ["^CNXPSUBANK","NIFTY PSU Bank"],["^CNXENERGY","NIFTY Energy"],["^CNXINFRA","NIFTY Infrastructure"],["^CNXMEDIA","NIFTY Media"],
    ["^CNXCONSUMER","NIFTY India Consumption"],["^CNXDIVOPP","NIFTY Dividend Opportunities 50"],["^BSESN","BSE SENSEX"]
  ];
  try{
    const quotes=await getQuotesBatch(syms.map(x=>x[0]));
    const values=syms.map(([s,n])=>{
      const q=quotes.get(s.toUpperCase());
      return {n,q,pct:q?.changePct??null};
    });
    const box=document.getElementById("indices");
    if(!box)return;
    box.innerHTML='<div class="ss-index-grid">'+values.map(x=>x.q?'<div class="ss-index-card"><div><div class="ss-index-name">'+escapeHtml(x.n)+'</div><div class="ss-index-price">'+x.q.price.toFixed(2)+'</div></div><div class="ss-index-change" style="color:'+(x.pct>=0?"#00ff88":"#ff4444")+'">'+percent(x.pct)+'</div></div>':'<div class="ss-index-card"><div><div class="ss-index-name">'+escapeHtml(x.n)+'</div><div class="ss-index-price">--</div></div><div class="ss-index-change" style="color:#7C8DB0">Unavailable</div></div>').join('')+'</div><div style="margin-top:10px;font-size:9px;color:#7C8DB0;text-align:center">Indian market indices • '+new Date().toLocaleTimeString("en-IN")+' IST</div>';
  }catch(error){
    const box=document.getElementById("indices"); if(box) box.innerHTML="<div style='padding:10px;color:#ffcc00'>Market data is temporarily unavailable. Please retry shortly.</div>";
    console.warn("[StockSense] indices",error);
  }
}
function calcRSIForScreen(c){
  if(!Array.isArray(c)||c.length<15)return null;
  let g=0,l=0;
  for(let i=c.length-14;i<c.length;i++){const d=c[i]-c[i-1];if(d>0)g+=d;else l-=d;}
  return l===0?100:100-(100/(1+g/l));
}
async function runScreener(type){
  const box=document.getElementById("screenerBox"),res=document.getElementById("screenerResults");
  box.style.display="block";res.textContent="Scanning live Yahoo Finance data from the stock catalog…";
  screenerType=type;
  try{
    const page=await getStockCatalogPage(screenerPage*30,30);
    const eligible=page.items.filter(stock=>stock.status==="active"&&stock.data_ready&&stock.yahoo_ticker);
    const quotes=await getQuotesBatch(eligible.map(stock=>stock.yahoo_ticker));
    const threshold=type==="STRONG_BUY"?35:45;
    const filtered=eligible.map(stock=>{
      const quote=quotes.get(stock.yahoo_ticker.toUpperCase());
      const rsi=calcRSIForScreen(quote?.closes);
      return quote&&Number.isFinite(rsi)?{stock,quote,rsi}:null;
    }).filter(item=>item&&item.rsi<threshold).sort((a,b)=>a.rsi-b.rsi);
    const first=screenerPage*30+1,last=screenerPage*30+page.items.length;
    setText("screenerPageLabel",page.total?`${first}–${last} of ${page.total} catalog entries`:"Catalog unavailable");
    document.getElementById("screenerPrev").disabled=screenerPage===0;
    document.getElementById("screenerNext").disabled=!page.hasMore;
    const rows=filtered.map(({stock,quote,rsi})=>'<div style="display:flex;justify-content:space-between;gap:8px;padding:8px;background:#0e1429;margin:4px 0;border-radius:6px;cursor:pointer" data-screen="'+escapeHtml(stock.yahoo_ticker)+'"><span><b>'+escapeHtml(stock.symbol)+'</b> · '+escapeHtml(stock.exchange)+' · RSI '+rsi.toFixed(1)+'</span><span style="color:'+(quote.changePct>=0?"#00ff88":"#ff4444")+'">'+money(quote.price)+' '+percent(quote.changePct)+'</span></div>').join("");
    res.innerHTML='<div style="color:#00ff88;font-size:11px">'+filtered.length+' FOUND · RSI BELOW '+threshold+'</div>'+(rows||'<div style="padding:9px;color:#7C8DB0;font-size:10px">No matching stocks in this catalog page. Move to another page to continue.</div>');
    res.querySelectorAll("[data-screen]").forEach(x=>x.onclick=()=>loadStockGlobal(x.dataset.screen));
  }catch(error){
    res.textContent="Screener data is temporarily unavailable. Please try again shortly.";
    console.warn("[StockSense] screener",error);
  }
}
function loadStockGlobal(symbol){
  loadStock(symbol);
  const results=document.getElementById("searchResults");
  if(results) results.style.display="none";
}
window.loadStockGlobal=loadStockGlobal;
async function init(){
  ensureUI();
  setupSearch();
  setupPortfolio();
  setupNotifications();
  document.getElementById("screenerBuy").onclick=()=>{screenerPage=0;runScreener("BUY");};
  document.getElementById("screenerDeep").onclick=()=>{screenerPage=0;runScreener("STRONG_BUY");};
  document.getElementById("screenerPrev").onclick=()=>{if(screenerPage>0){screenerPage--;runScreener(screenerType);}};
  document.getElementById("screenerNext").onclick=()=>{screenerPage++;runScreener(screenerType);};
  loadPortfolio();
  loadStock(currentSymbol);
  const setTab=(tab)=>{const dash=document.getElementById("ss-dashboard-view"),market=document.getElementById("ss-market-view"),d=document.getElementById("tabDashboard"),m=document.getElementById("tabMarket");const isMarket=tab==="market";dash.style.display=isMarket?"none":"";market.style.display=isMarket?"":"none";d.style.background=isMarket?"#121a33":"#00d4ff";d.style.color=isMarket?"#9fb0cf":"#06101f";m.style.background=isMarket?"#00d4ff":"#121a33";m.style.color=isMarket?"#06101f":"#9fb0cf";if(isMarket){loadGlobalMarket();loadGeneralMarketNews();}};
  document.getElementById("tabDashboard").onclick=()=>setTab("dashboard");
  document.getElementById("tabMarket").onclick=()=>setTab("market");
  const updateMarketStatus=()=>{const h=new Date().getHours(),m=new Date().getMinutes();setText("marketStatus",(h>9&&h<15||(h===9&&m>=15)||(h===15&&m<30)?"🟢 OPEN ":"🔴 CLOSED ")+new Date().toLocaleTimeString("en-IN",{hour:"numeric",minute:"2-digit"}));};
  updateMarketStatus();
  setInterval(updateMarketStatus,60_000);
}
init();

