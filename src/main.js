import { getQuote, getStockData, getNews, getAISignal, formatCompactNumber, classifyMarketCap, searchSymbols, getMarketCap } from "./utils/api.js";
import { defaultWatchlist, nseSearchUniverse } from "./data/topStocks.js";
import { createChart, CandlestickSeries, HistogramSeries } from "lightweight-charts";

const TICKERS=[...new Set(nseSearchUniverse.map(s=>s.display))];
const STOCK_META=new Map(nseSearchUniverse.map(s=>[s.symbol,s]));
const DEFAULT_WATCHLIST=defaultWatchlist.map(s=>({...s}));
const WATCHLIST_KEY="ss_watchlists_v2";
const ACTIVE_KEY="ss_active_watchlist_v2";
const SORT_KEY="ss_watchlist_sort_v2";
let chartResizeObserver=null;
let stockRequestId=0;

function capFromMeta(symbol){
  const base=symbol.replace(/\.(NS|BO)$/,"");
  return STOCK_META.get(base+".NS")?.cap?.[0] || null;
}
function capBadge(cap){
  if(!cap) return '';
  const label=cap==="L"?"L":cap==="M"?"M":"S";
  return '<span title="'+(cap==="L"?"Large Cap":cap==="M"?"Mid Cap":"Small Cap")+'" style="font-size:8px;font-weight:800;color:white;background:'+(cap==="L"?"#14532d":cap==="M"?"#164e63":"#713f12")+';border:1px solid rgba(255,255,255,.12);border-radius:5px;padding:2px 5px">'+label+"</span>";
}
function loadWatchlists(){
  const initial={Default:DEFAULT_WATCHLIST.map(s=>({...s})),List1:[],List2:[]};
  try{
    const saved=JSON.parse(localStorage.getItem(WATCHLIST_KEY)||"null");
    if(saved && typeof saved==="object"){
      const cleaned={Default:initial.Default,List1:Array.isArray(saved.List1)?saved.List1:[],List2:Array.isArray(saved.List2)?saved.List2:[]};
      const valid=Array.isArray(saved.Default)&&saved.Default.length===DEFAULT_WATCHLIST.length&&DEFAULT_WATCHLIST.every(s=>saved.Default.some(x=>x?.symbol===s.symbol));
      if(valid) cleaned.Default=saved.Default;
      localStorage.setItem(WATCHLIST_KEY,JSON.stringify(cleaned));
      localStorage.removeItem("ss_custom_lists_v2");
      localStorage.removeItem("ss_active_list_v2");
      return cleaned;
    }
  }catch{}
  localStorage.removeItem("ss_custom_lists_v2");
  localStorage.removeItem("ss_active_list_v2");
  localStorage.setItem(WATCHLIST_KEY,JSON.stringify(initial));
  return initial;
}
let watchlists=loadWatchlists();
let activeWatchlist=localStorage.getItem(ACTIVE_KEY)||"Default";
if(!watchlists[activeWatchlist]) activeWatchlist="Default";
let sortMode=localStorage.getItem(SORT_KEY)||"default";
let currentSymbol="SBIN.NS";
let currentChart=null;
let chartSourceData=null;
let chartRange="1Y";

function saveWatchlists(){
  localStorage.setItem(WATCHLIST_KEY,JSON.stringify(watchlists));
  localStorage.setItem(ACTIVE_KEY,activeWatchlist);
  localStorage.setItem(SORT_KEY,sortMode);
}
function currentList(){
  return watchlists[activeWatchlist]||[];
}
function symbolLabel(symbol){
  return symbol.replace(/\.(NS|BO)$/,"");
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
function money(value){
  return Number.isFinite(value)?"₹"+value.toFixed(2):"--";
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
    #watchlistTabs button{border:1px solid rgba(91,121,180,.2)!important}
    #watchlistSort{cursor:pointer}
    #mixCaps [data-row]{transition:background .16s ease,transform .16s ease;border-bottom-color:rgba(91,121,180,.12)!important}
    #mixCaps [data-row]:hover{background:rgba(79,140,255,.07);transform:translateX(2px)}
    #chart{background:linear-gradient(180deg,#07101f,#050914);box-shadow:inset 0 0 40px rgba(0,0,0,.18)}
    #newsBox a{color:#dce8ff!important;text-decoration:none}
    #newsBox a:hover{text-decoration:underline}
    #chartToolbar button{padding:5px 9px;border:1px solid rgba(91,121,180,.18);border-radius:7px;background:#0e1429;color:#7C8DB0;font-size:9px;font-weight:800;cursor:pointer}.ss-kicker{letter-spacing:.12em;text-transform:uppercase;font-size:9px;color:#7890b8;font-weight:800}
    .ss-analysis{margin-top:12px;display:grid;grid-template-columns:1.15fr .85fr;gap:10px}
    .ss-analysis-card{background:linear-gradient(180deg,rgba(9,16,34,.96),rgba(6,11,24,.96));border:1px solid rgba(91,121,180,.18);border-radius:12px;padding:12px}
    .ss-analysis-title{font-size:9px;color:#7890b8;font-weight:800;letter-spacing:.1em;text-transform:uppercase}
    .ss-signal-hero{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:8px}
    .ss-signal-pill{font-size:16px;font-weight:900;letter-spacing:.02em}
    .ss-signal-score{font-size:10px;color:#7C8DB0;text-align:right}
    .ss-score-track{height:7px;background:#17213d;border-radius:999px;overflow:hidden;margin-top:8px}
    .ss-score-fill{height:100%;width:0%;border-radius:999px;transition:width .25s ease}
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
    @media(max-width:820px){.ss-analysis{grid-template-columns:1fr}.ss-breakdown{grid-template-columns:repeat(3,1fr)}}
    @media(max-width:1180px){#ss-shell{grid-template-columns:300px 1fr!important}#ss-right-panel{display:none!important}}
    @media(max-width:820px){#ss-header{position:relative!important;padding:12px!important}#ss-header>div{max-width:none!important}#ss-shell{display:flex!important;flex-direction:column!important;padding:8px!important}.ss-watch{min-height:0!important;max-height:none}.ss-detail{width:100%}#chart{height:300px!important}#stockPrice{font-size:28px!important}.ss-metrics{grid-template-columns:repeat(2,1fr)!important}.ss-fund{grid-template-columns:1fr!important}#searchAll{min-width:0!important}}
    @media(max-width:520px){#ss-header-actions{width:100%;justify-content:flex-start!important}.ss-metrics{grid-template-columns:1fr 1fr!important}#watchlistSort{font-size:9px}}
  `; document.head.appendChild(style);
}

function ensureUI(){
  installDesignSystem();
  document.getElementById("app").innerHTML=`
  <div style="background:radial-gradient(circle at 20% 0%,rgba(35,72,145,.18),transparent 28%),radial-gradient(circle at 85% 10%,rgba(0,212,255,.08),transparent 24%),#050914;color:white;min-height:100vh;font-family:Inter,sans-serif">
    <div id="ss-header" style="background:#0e1a4d;border-bottom:1px solid #1e2d5a;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;position:sticky;top:0;z-index:20">
      <div style="display:flex;align-items:center;gap:12px"><div style="width:40px;height:40px;background:linear-gradient(135deg,#00d4ff,#7c3aed);border-radius:10px;display:flex;align-items:center;justify-content:center"><span style="color:white;font-weight:900;font-size:22px">₹</span></div><div><div style="display:flex;align-items:center;gap:8px"><span style="font-weight:900;font-size:19px">STOCKSENSE</span><span style="font-size:9px;background:#1e2d5a;color:#00d4ff;padding:2px 6px;border-radius:10px">BETA</span></div><div style="font-size:11px;color:#7C8DB0">Indian Stock Market Intelligence</div></div></div>
      <div style="flex:1;max-width:440px;position:relative"><input id="searchAll" placeholder="Search stocks, symbols or company names…" style="width:100%;padding:10px 16px;background:#070d2b;color:white;border:1px solid #1e2d5a;border-radius:20px;outline:none;font-size:13px"/><div id="searchResults" style="position:absolute;top:44px;left:0;right:0;z-index:9999;background:#0f172f;border:1px solid #1e2d5a;border-radius:12px;max-height:320px;overflow:auto;display:none"></div></div>
      <div id="ss-header-actions" style="display:flex;gap:8px;align-items:center"><button id="scanBuy" style="padding:8px 14px;background:#00ff88;color:#070d2b;border:none;border-radius:20px;font-weight:800;font-size:11px">SCAN BUY</button><button id="scanOversold" style="padding:8px 14px;background:#121a33;color:white;border:1px solid #1e2d5a;border-radius:20px;font-size:11px">RSI &lt;35</button><div id="marketStatus" style="font-size:11px;padding:7px 12px;background:#121a33;border:1px solid #1e2d5a;border-radius:20px">--</div></div>
    </div>
    <div id="ss-shell" style="max-width:1450px;margin:0 auto;display:grid;grid-template-columns:350px 1fr 300px;gap:16px;padding:16px;min-height:calc(100vh - 130px)">
      <div class="ss-card ss-watch" style="background:#121a33;border:1px solid #1e2d5a;border-radius:12px;display:flex;flex-direction:column;overflow:hidden">
        <div style="padding:12px 14px;border-bottom:1px solid #1e2d5a"><div style="display:flex;justify-content:space-between;align-items:center"><div><div style="font-size:13px;font-weight:850;letter-spacing:.01em">Watchlist</div><div id="watchlistCount" style="font-size:9px;color:#7C8DB0">Default • 10 stocks</div></div><div style="font-size:9px;color:#8fb8ff;background:rgba(79,140,255,.12);padding:4px 9px;border-radius:10px;border:1px solid rgba(79,140,255,.2)">LAST CLOSE</div></div>
          <div id="watchlistTabs" style="display:flex;gap:5px;margin-top:10px;flex-wrap:wrap"></div>
          <div style="display:flex;gap:6px;margin-top:8px"><select id="watchlistSort" style="flex:1;padding:7px 9px;background:#070d2b;color:white;border:1px solid #1e2d5a;border-radius:8px;font-size:10px"><option value="default">Sort: Default</option><option value="az">A → Z</option><option value="za">Z → A</option><option value="price">Price: High → Low</option><option value="change">Change: High → Low</option><option value="changePct">Change %: High → Low</option></select><button id="newWatchlist" style="padding:7px 10px;background:#00d4ff;color:#070d2b;border:none;border-radius:8px;font-weight:800;font-size:10px">+ List</button></div>
        </div>
        <div style="padding:10px 12px;background:#0e1429;border-bottom:1px solid #1e2d5a"><div style="display:flex;gap:6px"><input id="watchlistSearch" placeholder="Search symbol to add" style="flex:1;padding:8px 12px;background:#070d2b;border:1px solid #1e2d5a;border-radius:8px;color:white;font-size:11px;outline:none"/><button id="watchlistSearchBtn" style="padding:8px 12px;background:#00d4ff;color:#070d2b;border:none;border-radius:8px;font-weight:700;font-size:11px">+ Add</button></div><div id="watchlistHint" style="font-size:9px;color:#7C8DB0;margin-top:6px"></div></div>
        <div style="display:grid;grid-template-columns:1fr 75px 65px 24px;gap:8px;padding:8px 14px;font-size:9px;color:#7C8DB0;font-weight:700;border-bottom:1px solid #1e2d5a;background:#0e1429"><span>Instrument</span><span style="text-align:right">LTP</span><span style="text-align:right">% Chg</span><span></span></div>
        <div id="mixCaps" style="flex:1;overflow:auto;min-height:320px">Loading your watchlist…</div>
        <div style="padding:10px 14px;border-top:1px solid #1e2d5a;display:flex;justify-content:space-between;font-size:10px;background:#0e1429"><div>Top Gainer: <b id="topGainer" style="color:#00ff88">--</b></div><div>Loser: <b id="topLoser" style="color:#ff4444">--</b></div></div>
        <div style="background:#070d2b;border-top:1px solid #1e2d5a;padding:12px"><div style="font-size:11px;font-weight:700;margin-bottom:8px">💼 My Portfolio / Custom</div><div id="portfolio" style="font-size:12px;color:#7C8DB0">No stocks added</div><div style="margin-top:8px;display:flex;gap:6px"><input id="customAdd" placeholder="Add e.g. RVNL.BO" style="flex:1;padding:7px 10px;background:#121a33;border:1px solid #1e2d5a;border-radius:8px;color:white;font-size:11px;outline:none"/><button id="customAddBtn" style="padding:7px 12px;background:white;color:#070d2b;border:none;border-radius:8px;font-weight:700;font-size:11px">+</button></div></div>
      </div>
      <div class="ss-detail" style="display:flex;flex-direction:column;gap:12px">
        <div class="ss-card" style="background:#121a33;border:1px solid #1e2d5a;border-radius:12px;padding:16px">
          <div style="display:flex;justify-content:space-between"><div><div id="stockName" style="font-size:11px;color:#7fb2ff;font-weight:800;letter-spacing:.04em">SBIN.NS • NSE</div><div style="display:flex;align-items:baseline;gap:12px;margin-top:4px"><h1 id="stockPrice" style="font-size:36px;margin:0;font-weight:850;letter-spacing:-.03em">₹--</h1><div id="change" style="padding:4px 10px;border-radius:20px;font-weight:700;font-size:12px">--</div></div><div style="display:flex;gap:12px;margin-top:8px;font-size:10px;color:#7C8DB0"><span>H <b id="dayHigh" style="color:white">--</b></span><span>L <b id="dayLow" style="color:white">--</b></span><span>Vol <b id="dayVol" style="color:white">--</b></span><span>52W <b id="w52" style="color:white">--</b></span></div></div><div style="text-align:right"><div style="font-size:9px;color:#7C8DB0">AI SIGNAL</div><div id="aiSignal" style="margin-top:6px;padding:6px 14px;border-radius:20px;font-weight:800;font-size:12px;border:1px solid #1e2d5a;background:#1e2d5a">--</div><div id="aiDesc" style="font-size:9px;color:#7C8DB0;margin-top:4px">--</div><button id="addPortfolio" style="margin-top:10px;padding:6px 14px;background:#00d4ff;color:#070d2b;border:none;border-radius:20px;font-weight:700;font-size:11px">+ Watchlist</button></div></div>
          <div id="chartToolbar" style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding:6px 8px;background:#070d2b;border:1px solid #1e2d5a;border-bottom:none;border-radius:10px 10px 0 0"><div style="display:flex;gap:4px"><button data-range="1M">1M</button><button data-range="3M">3M</button><button data-range="6M">6M</button><button data-range="1Y">1Y</button></div><span style="font-size:9px;color:#7C8DB0">Closing-price history</span></div><div id="chart" style="height:360px;margin-top:0;border:1px solid #1e2d5a;border-radius:0 0 10px 10px;overflow:hidden"></div>
          <div class="ss-analysis">
            <div class="ss-analysis-card">
              <div class="ss-analysis-title">Signal Analysis</div>
              <div class="ss-signal-hero"><div><div id="analysisSignal" class="ss-signal-pill">--</div><div id="analysisSignalDesc" style="font-size:9px;color:#7C8DB0;margin-top:3px">Awaiting technical data</div></div><div class="ss-signal-score"><div>TECHNICAL SCORE</div><b id="analysisScore">--</b></div></div>
              <div class="ss-score-track"><div id="analysisScoreFill" class="ss-score-fill"></div></div>
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
          <div class="ss-metrics" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px">
            <div style="background:#070d2b;border:1px solid #1e2d5a;border-radius:10px;padding:10px"><div style="font-size:8px;color:#7C8DB0">P/E • M-CAP • BETA</div><div id="peValue" style="font-size:12px;font-weight:700;margin-top:2px">--</div><div id="mcapValue" style="font-size:10px;color:#7C8DB0"></div><div id="betaValue" style="font-size:10px;color:#7C8DB0"></div></div>
            <div style="background:#070d2b;border:1px solid #1e2d5a;border-radius:10px;padding:10px"><div style="font-size:8px;color:#7C8DB0">DIV • PROFIT • YEAR</div><div id="divValue" style="margin-top:2px">--</div><div id="profitValue" style="font-size:10px">--</div><div id="yearValue" style="font-size:10px">--</div></div>
            <div style="background:#070d2b;border:1px solid #1e2d5a;border-radius:10px;padding:10px"><div style="font-size:8px;color:#7C8DB0">MOVING AVERAGES</div><div style="font-size:10px;margin-top:3px">20: <b id="sma20">--</b> · 50: <b id="sma50">--</b></div><div style="font-size:10px">200: <b id="sma200">--</b></div></div>
            <div style="background:#070d2b;border:1px solid #1e2d5a;border-radius:10px;padding:10px"><div style="font-size:8px;color:#7C8DB0">RSI POSITION</div><div id="rsiPosition" style="font-size:12px;font-weight:800;margin-top:4px">--</div><div style="font-size:9px;color:#7C8DB0;margin-top:3px">14-period momentum</div></div>
          </div>
          <div class="ss-fund" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
            <div style="background:#070d2b;border:1px solid #1e2d5a;border-radius:10px;padding:12px">
              <div style="display:flex;justify-content:space-between;align-items:center"><div style="font-size:9px;color:#7C8DB0;font-weight:700">📊 FUNDAMENTALS</div><span id="fundSource" style="font-size:8px;color:#6f86b6">--</span></div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;margin-top:8px;font-size:10px;line-height:19px">
                <div><span style="color:#7C8DB0">P/E</span><b id="f_pe" style="display:block;font-size:12px">--</b></div>
                <div><span style="color:#7C8DB0">EPS</span><b id="f_eps" style="display:block;font-size:12px">--</b></div>
                <div><span style="color:#7C8DB0">Market Cap</span><b id="f_mcap" style="display:block;font-size:12px">--</b></div>
                <div><span style="color:#7C8DB0">Book Value</span><b id="f_book" style="display:block;font-size:12px">--</b></div>
                <div><span style="color:#7C8DB0">Dividend Yield</span><b id="f_div" style="display:block;font-size:12px">--</b></div>
                <div><span style="color:#7C8DB0">ROE</span><b id="f_roe" style="display:block;font-size:12px">--</b></div>
                <div><span style="color:#7C8DB0">ROA</span><b id="f_roa" style="display:block;font-size:12px">--</b></div>
                <div><span style="color:#7C8DB0">Debt / Equity</span><b id="f_de" style="display:block;font-size:12px">--</b></div>
                <div><span style="color:#7C8DB0">Revenue Growth</span><b id="f_rg" style="display:block;font-size:12px">--</b></div>
                <div><span style="color:#7C8DB0">Profit Growth</span><b id="f_eg" style="display:block;font-size:12px">--</b></div>
                <div><span style="color:#7C8DB0">Operating Margin</span><b id="f_om" style="display:block;font-size:12px">--</b></div>
                <div><span style="color:#7C8DB0">Profit Margin</span><b id="f_pm" style="display:block;font-size:12px">--</b></div>
                <div><span style="color:#7C8DB0">Revenue</span><b id="f_rev" style="display:block;font-size:12px">--</b></div>
                <div><span style="color:#7C8DB0">Net Income</span><b id="f_ni" style="display:block;font-size:12px">--</b></div>
                <div><span style="color:#7C8DB0">Free Cash Flow</span><b id="f_fcf" style="display:block;font-size:12px">--</b></div>
                <div><span style="color:#7C8DB0">Beta</span><b id="f_beta" style="display:block;font-size:12px">--</b></div>
              </div>
            </div>
            <div style="background:#070d2b;border:1px solid #1e2d5a;border-radius:10px;padding:10px"><div style="font-size:9px;color:#7C8DB0;font-weight:700">📈 TECHNICALS</div><div style="margin-top:6px;font-size:11px;line-height:22px"><div style="display:flex;justify-content:space-between"><span style="color:#7C8DB0">RSI</span><b id="t_rsi">--</b></div><div style="display:flex;justify-content:space-between"><span style="color:#7C8DB0">SMA20</span><b id="t_sma20">--</b></div><div style="display:flex;justify-content:space-between"><span style="color:#7C8DB0">SMA50</span><b id="t_sma50">--</b></div><div style="display:flex;justify-content:space-between"><span style="color:#7C8DB0">SMA200</span><b id="t_sma200">--</b></div><div style="display:flex;justify-content:space-between"><span style="color:#7C8DB0">Signal</span><b id="t_signal">--</b></div></div></div></div>
          <div style="margin-top:10px;background:#070d2b;border:1px solid #1e2d5a;border-radius:10px;padding:10px"><div style="font-size:9px;color:#7C8DB0;font-weight:700">📰 NEWS - LAST CLOSE</div><div id="newsBox" style="margin-top:6px;font-size:11px"></div></div>
          <div id="screenerBox" style="margin-top:10px;background:#070d2b;border:1px solid #1e2d5a;border-radius:12px;padding:12px;display:none"><div style="font-size:11px;font-weight:700">Screener Results</div><div id="screenerResults" style="max-height:200px;overflow:auto;margin-top:8px"></div></div>
        </div>
      </div>
      <div id="ss-right-panel" class="ss-card" style="background:#121a33;border:1px solid #1e2d5a;border-radius:12px;padding:12px"><div style="display:flex;justify-content:space-between"><h3 style="margin:0;font-size:11px">📊 Market Overview</h3><span style="font-size:9px;color:#8fb8ff">LAST CLOSE</span></div><div id="indices" style="margin-top:10px">Loading market data…</div></div>
    </div>
    <div style="background:#1a1400;border-top:1px solid #3d3000;padding:12px 16px;text-align:center"><div style="font-size:11px;color:#ffcc66;line-height:16px;max-width:900px;margin:0 auto"><b>⚠️ Disclaimer:</b> This app is a hobby project, made for educational purpose only. Do your own market research before investing or trading. We are not SEBI registered. Market data may be delayed.</div></div>
  </div>`;
  document.getElementById("watchlistSort").value=sortMode;
}

async function renderWatchlist(){
  const list=currentList();
  setText("watchlistCount",activeWatchlist+" • "+list.length+"/20 stocks");
  const tabs=document.getElementById("watchlistTabs");
  tabs.innerHTML=["Default","List1","List2"].map(name=>`<button data-list="${name}" style="padding:5px 9px;background:${name===activeWatchlist?"#00d4ff":"#1a294e"};color:${name===activeWatchlist?"#070d2b":"white"};border:none;border-radius:14px;font-size:9px;font-weight:800;cursor:pointer">${name==="Default"?"Default":name.replace("List","List ")}</button>`).join("");
  tabs.querySelectorAll("[data-list]").forEach(btn=>btn.onclick=()=>{activeWatchlist=btn.dataset.list;saveWatchlists();renderWatchlist();});
  document.getElementById("watchlistHint").textContent=activeWatchlist==="Default"?"Default is the curated 10-stock mix of Large, Mid and Small caps.":"Up to 20 stocks in this list.";
  const el=document.getElementById("mixCaps");
  el.innerHTML=list.length?list.map((s,i)=>`<div data-row="${i}" style="display:grid;grid-template-columns:1fr 75px 65px 24px;gap:8px;padding:10px 14px;border-bottom:1px solid #1a274a;cursor:pointer"><div><div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600"><span>${symbolLabel(s.symbol)}</span><span class="cap-${i}">${capBadge(s.cap||capFromMeta(s.symbol))}</span></div><div style="font-size:9px;color:#7C8DB0">${s.symbol}</div></div><div class="wl-price" style="text-align:right;font-size:12px;font-weight:600">--</div><div class="wl-change" style="text-align:right;font-size:10px;font-weight:700">--</div><button class="wl-remove" title="Remove" style="background:none;border:none;color:#7C8DB0;cursor:pointer">✕</button></div>`).join(""):"<div style='padding:20px;color:#7C8DB0;text-align:center;font-size:11px'>No stocks in this list.</div>";
  const rows=[...el.querySelectorAll("[data-row]")];
  const live=[];
  await Promise.all(list.map(async(s,i)=>{
    try{
      const [q,mc]=await Promise.all([getQuote(s.symbol),getMarketCap(s.symbol)]);
      live[i]={...s,cap:s.cap||mc.cap,price:q.price,change:q.price-q.prev,changePct:(q.price-q.prev)/q.prev*100};
    }catch{
      live[i]={...s,price:null,change:null,changePct:null};
    }
  }));
  const sorted=live.filter(Boolean).sort((a,b)=>{
    if(sortMode==="az") return symbolLabel(a.symbol).localeCompare(symbolLabel(b.symbol));
    if(sortMode==="za") return symbolLabel(b.symbol).localeCompare(symbolLabel(a.symbol));
    if(sortMode==="price") return (b.price??-Infinity)-(a.price??-Infinity);
    if(sortMode==="change") return (b.change??-Infinity)-(a.change??-Infinity);
    if(sortMode==="changePct") return (b.changePct??-Infinity)-(a.changePct??-Infinity);
    return 0;
  });
  if(sortMode!=="default"){
    el.innerHTML=sorted.map((s,i)=>`<div data-row="${i}" style="display:grid;grid-template-columns:1fr 75px 65px 24px;gap:8px;padding:10px 14px;border-bottom:1px solid #1a274a;cursor:pointer"><div><div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600"><span>${symbolLabel(s.symbol)}</span>${capBadge(s.cap||capFromMeta(s.symbol))}</div><div style="font-size:9px;color:#7C8DB0">${s.symbol}</div></div><div style="text-align:right;font-size:12px;font-weight:600">${money(s.price)}</div><div style="text-align:right;color:${s.changePct>=0?"#00ff88":"#ff4444"};font-size:10px;font-weight:700">${percent(s.changePct)}</div><button class="wl-remove" style="background:none;border:none;color:#7C8DB0;cursor:pointer">✕</button></div>`).join("");
  }else{
    rows.forEach((row,i)=>{const s=live[i]; if(!s)return; row.querySelector(".wl-price").textContent=money(s.price); const c=row.querySelector(".wl-change"); c.textContent=percent(s.changePct); c.style.color=s.changePct>=0?"#00ff88":"#ff4444";});
  }
  [...el.querySelectorAll("[data-row]")].forEach((row,i)=>{const s=sortMode==="default"?live[i]:sorted[i]; row.onclick=()=>loadStockGlobal(s.symbol); const rm=row.querySelector(".wl-remove"); rm.onclick=e=>{e.stopPropagation();removeFromWatchlist(s.symbol);};});
  const valid=live.filter(x=>Number.isFinite(x.changePct));
  if(valid.length){const gain=[...valid].sort((a,b)=>b.changePct-a.changePct)[0], lose=[...valid].sort((a,b)=>a.changePct-b.changePct)[0];setText("topGainer",symbolLabel(gain.symbol)+" "+percent(gain.changePct));setText("topLoser",symbolLabel(lose.symbol)+" "+percent(lose.changePct));}else{setText("topGainer","--");setText("topLoser","--");}
}
function addToWatchlist(symbol){
  if(!symbol)return;
  const list=currentList();
  if(list.some(s=>s.symbol===symbol)){loadStockGlobal(symbol);return;}
  if(list.length>=20){alert("This watchlist already has 20 stocks.");return;}
  const base=symbolLabel(symbol);
  const meta=STOCK_META.get(base+".NS");
  list.push({symbol,display:base,name:meta?.name||base,cap:meta?.cap?.[0]||null,sector:meta?.sector||""});
  saveWatchlists(); renderWatchlist(); loadStockGlobal(symbol);
}
function removeFromWatchlist(symbol){
  if(activeWatchlist==="Default" && DEFAULT_WATCHLIST.some(s=>s.symbol===symbol)){watchlists.Default=watchlists.Default.filter(s=>s.symbol!==symbol);}else{watchlists[activeWatchlist]=currentList().filter(s=>s.symbol!==symbol);}
  saveWatchlists();renderWatchlist();
}
function setupSearch(){
  const input=document.getElementById("searchAll"), results=document.getElementById("searchResults");
  let timer=0,seq=0;
  input.addEventListener("input",()=>{
    const q=input.value.trim().toUpperCase(); clearTimeout(timer); const my=++seq;
    if(!q){results.style.display="none";return;}
    const local=nseSearchUniverse.filter(s=>s.symbol.includes(q)||s.display.includes(q)||s.name.toUpperCase().includes(q)).slice(0,12);
    const draw=matches=>{
      results.innerHTML=matches.length?matches.map(s=>`<div data-s="${s.symbol}" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #1a274a;display:flex;justify-content:space-between"><span><b>${s.display}</b> ${capBadge(s.cap?.[0]||"")}</span><span style="color:#00d4ff;font-size:10px">${s.symbol}</span></div>`).join(""):"<div style='padding:12px;color:#7C8DB0;font-size:11px'>No matching NSE/BSE symbol found.</div>";
      results.style.display="block";
      results.querySelectorAll("[data-s]").forEach(x=>x.onclick=()=>{loadStockGlobal(x.dataset.s);results.style.display="none";input.value="";});
    };
    draw(local);
    if(q.length>=2) timer=setTimeout(async()=>{try{const remote=await searchSymbols(q);if(my!==seq)return;draw([...local,...remote].filter((s,i,a)=>a.findIndex(x=>x.symbol===s.symbol)===i).slice(0,12));}catch{}},250);
  });
  document.getElementById("watchlistSearchBtn").onclick=()=>{const v=normalizeSymbol(document.getElementById("watchlistSearch").value);if(v)addToWatchlist(v);document.getElementById("watchlistSearch").value="";};
  document.getElementById("watchlistSearch").addEventListener("keydown",e=>{if(e.key==="Enter")document.getElementById("watchlistSearchBtn").click();});
}
function setupWatchlistControls(){
  document.getElementById("watchlistSort").onchange=e=>{sortMode=e.target.value;saveWatchlists();renderWatchlist();};
  document.getElementById("newWatchlist").onclick=()=>{
    const name=!watchlists.List1?"List1":!watchlists.List2?"List2":null;
    if(!name){alert("You can have up to 3 watchlists.");return;}
    watchlists[name]=[];activeWatchlist=name;saveWatchlists();renderWatchlist();
  };
}
function loadPortfolio(){
  const p=JSON.parse(localStorage.getItem("ss_portfolio")||"[]"),el=document.getElementById("portfolio");
  el.innerHTML=p.length?p.map(s=>`<div style="display:flex;justify-content:space-between;padding:6px 8px;background:#0e1429;margin:3px 0;border-radius:6px;font-size:12px"><span>${s}</span><span data-p="${s}" style="color:#ff4444;cursor:pointer">✕</span></div>`).join(""):"No stocks added";
  el.querySelectorAll("[data-p]").forEach(x=>x.onclick=()=>{const next=p.filter(s=>s!==x.dataset.p);localStorage.setItem("ss_portfolio",JSON.stringify(next));loadPortfolio();});
}
function setupPortfolio(){
  document.getElementById("addPortfolio").onclick=()=>{const p=JSON.parse(localStorage.getItem("ss_portfolio")||"[]");if(!p.includes(currentSymbol)){p.push(currentSymbol);localStorage.setItem("ss_portfolio",JSON.stringify(p));loadPortfolio();}};
  document.getElementById("customAddBtn").onclick=()=>{const v=normalizeSymbol(document.getElementById("customAdd").value);if(v)addToWatchlist(v);document.getElementById("customAdd").value="";};
}
function renderNews(items){
  const box=document.getElementById("newsBox");
  if(!items?.length){box.innerHTML="<div style='padding:8px;background:#0e1429;border-radius:6px;color:#7C8DB0'>No live news is available right now.</div>";return;}
  box.innerHTML=items.map(n=>`<div style="padding:7px;background:#0e1429;border-radius:6px;margin:4px 0"><a href="${n.link||"#"}" target="_blank" rel="noopener noreferrer" style="color:white;text-decoration:none">${n.title}</a><div style="font-size:9px;color:#7C8DB0;margin-top:3px">${n.publisher}</div></div>`).join("");
}
async function loadStock(symbol){
  const requestId=++stockRequestId;
  currentSymbol=symbol;
  setText("stockName",symbol+" • "+(symbol.endsWith(".BO")?"BSE":"NSE")+" • loading");
  setText("stockPrice","₹--");setText("change","Loading live data...");
  try{
    const data=await getStockData(symbol);
    if(requestId!==stockRequestId)return;
    const cap=data.cap||capFromMeta(symbol);
    document.getElementById("stockName").innerHTML=symbol+" • "+(symbol.endsWith(".BO")?"BSE":"NSE")+" "+capBadge(cap)+" • "+new Date().toLocaleTimeString("en-IN");
    setText("stockPrice",money(data.price));
    const ch=document.getElementById("change");ch.textContent=percent(data.change)+" ("+percent(data.changePct)+")";ch.style.background=data.change>=0?"rgba(0,255,136,.15)":"rgba(255,68,68,.15)";ch.style.color=data.change>=0?"#00ff88":"#ff4444";
    setText("dayHigh",money(data.high));setText("dayLow",money(data.low));setText("dayVol",Number.isFinite(data.vol)?(data.vol/1e6).toFixed(2)+"M":"--");setText("w52",money(data.low52)+" / "+money(data.high52));
    setText("rsiValue",Number.isFinite(data.rsi)?data.rsi.toFixed(1):"--");
    setText("sma20",money(data.sma20));setText("sma50",money(data.sma50));setText("sma200",money(data.sma200));
    const rsi=Number.isFinite(data.rsi)?data.rsi:null;
    const rsiState=rsi==null?"Unavailable":rsi<30?"Oversold":rsi<45?"Weak / recovering":rsi<=70?"Neutral / healthy":rsi<=80?"Overbought":"Highly overbought";
    const momentum=rsi==null?"Unavailable":rsi<30?"Strong downside pressure":rsi<45?"Bearish momentum":rsi>70?"Overheated momentum":"Balanced momentum";
    const trend20_50=data.sma20!=null&&data.sma50!=null?(data.sma20>data.sma50?"Bullish":"Bearish"):"Unavailable";
    const trend50_200=data.sma50!=null&&data.sma200!=null?(data.sma50>data.sma200?"Bullish":"Bearish"):"Unavailable";
    const priceVs20=data.price!=null&&data.sma20!=null?(data.price>data.sma20?"Above SMA20":"Below SMA20"):"Unavailable";
    setText("smaStatus",trend20_50);setText("smaLongStatus",trend50_200);setText("priceTrend",priceVs20);setText("rsiPosition",rsiState);
    setText("analysisRsiState",rsiState);setText("analysisMomentum",momentum);setText("analysisTrend",trend20_50==="Bullish"&&trend50_200==="Bullish"?"Bullish trend":trend20_50==="Bearish"&&trend50_200==="Bearish"?"Bearish trend":"Mixed trend");
    const marker=document.getElementById("analysisRsiMarker"); if(marker) marker.style.left=(rsi==null?"50%":Math.max(0,Math.min(100,rsi))+"%");
    const rsiScore=rsi==null?50:rsi<30?88:rsi<45?68:rsi<=70?55:rsi<=80?35:18;
    const trendScore=(trend20_50==="Bullish"?25:trend20_50==="Bearish"?0:12)+(trend50_200==="Bullish"?25:trend50_200==="Bearish"?0:12);
    const score=Math.round(Math.max(0,Math.min(100,(rsiScore+trendScore)/1.5)));
    setText("analysisScore",(rsi==null?"--":score+"/100"));
    const scoreFill=document.getElementById("analysisScoreFill"); if(scoreFill){scoreFill.style.width=rsi==null?"0%":score+"%";scoreFill.style.background=score>=70?"#22c55e":score>=45?"#f59e0b":"#ef4444";}
    setText("smaLongStatus",trend50_200);
    setText("peValue","P/E "+(Number.isFinite(data.fund.pe)?data.fund.pe.toFixed(2):"--"));setText("mcapValue","M-Cap "+formatCompactNumber(data.fund.mcap));setText("betaValue","Beta "+(Number.isFinite(data.fund.beta)?data.fund.beta.toFixed(2):"--"));
    setText("divValue","Div "+(Number.isFinite(data.fund.div)?data.fund.div.toFixed(2)+"%":"--"));setText("profitValue","Profit "+(Number.isFinite(data.fund.pm)?data.fund.pm.toFixed(1)+"%":"--"));setText("yearValue","Year "+(Number.isFinite(data.yearChange)?percent(data.yearChange):"--"));
    
    const rows=data.fund.quarterlyRows||[]; const annualRows=data.fund.annualRows||[]; const displayRows=rows.length?rows:annualRows; const periodLabel=rows.length?"Quarterly":"Annual"; setText("financialPeriodLabel",periodLabel+" • latest "+(data.fund.latestPeriod?new Date(data.fund.latestPeriod*1000).toLocaleDateString("en-IN",{month:"short",year:"numeric"}):"--")); const table=document.getElementById("financialTable"); if(table){table.innerHTML=displayRows.length?`<table style="width:100%;border-collapse:collapse;font-size:9px"><thead><tr><th style="text-align:left;color:#7C8DB0;padding:5px">Period</th><th style="text-align:right;color:#7C8DB0;padding:5px">Revenue</th><th style="text-align:right;color:#7C8DB0;padding:5px">EBITDA</th><th style="text-align:right;color:#7C8DB0;padding:5px">PAT</th><th style="text-align:right;color:#7C8DB0;padding:5px">EPS</th></tr></thead><tbody>${displayRows.slice(0,5).map(r=>`<tr><td style="padding:5px;border-top:1px solid #1e2d5a">${r.date?new Date(r.date*1000).toLocaleDateString("en-IN",{month:"short",year:"numeric"}):"--"}</td><td style="padding:5px;text-align:right;border-top:1px solid #1e2d5a">${formatCompactNumber(r.revenue)}</td><td style="padding:5px;text-align:right;border-top:1px solid #1e2d5a">${formatCompactNumber(r.ebitda)}</td><td style="padding:5px;text-align:right;border-top:1px solid #1e2d5a">${formatCompactNumber(r.netIncome)}</td><td style="padding:5px;text-align:right;border-top:1px solid #1e2d5a">${Number.isFinite(r.eps)?r.eps.toFixed(2):"--"}</td></tr>`).join("")}</tbody></table>`: "<div style='color:#7C8DB0;font-size:10px;padding:8px 0'>Financial history unavailable for this symbol.</div>";}
setText("fundSource",data.fund.source||"Company financial data");setText("f_pe",Number.isFinite(data.fund.pe)?data.fund.pe.toFixed(2):"--");setText("f_eps",Number.isFinite(data.fund.eps)?money(data.fund.eps):"--");setText("f_mcap",formatCompactNumber(data.fund.mcap));setText("f_book",Number.isFinite(data.fund.bookValue)?money(data.fund.bookValue):"--");setText("f_div",Number.isFinite(data.fund.div)?data.fund.div.toFixed(2)+"%":"--");setText("f_roe",Number.isFinite(data.fund.roe)?data.fund.roe.toFixed(1)+"%":"--");setText("f_roa",Number.isFinite(data.fund.roa)?data.fund.roa.toFixed(1)+"%":"--");setText("f_de",Number.isFinite(data.fund.debtEquity)?data.fund.debtEquity.toFixed(1):"--");setText("f_rg",Number.isFinite(data.fund.revenueGrowth)?data.fund.revenueGrowth.toFixed(1)+"%":"--");setText("f_eg",Number.isFinite(data.fund.earningsGrowth)?data.fund.earningsGrowth.toFixed(1)+"%":"--");setText("f_om",Number.isFinite(data.fund.operatingMargin)?data.fund.operatingMargin.toFixed(1)+"%":"--");setText("f_pm",Number.isFinite(data.fund.pm)?data.fund.pm.toFixed(1)+"%":"--");setText("f_rev",formatCompactNumber(data.fund.totalRevenue));setText("f_ni",formatCompactNumber(data.fund.netIncome));setText("f_fcf",formatCompactNumber(data.fund.freeCashFlow));setText("f_beta",Number.isFinite(data.fund.beta)?data.fund.beta.toFixed(2):"--");
    setText("t_rsi",Number.isFinite(data.rsi)?data.rsi.toFixed(1):"--");setText("t_sma20",money(data.sma20));setText("t_sma50",money(data.sma50));setText("t_sma200",money(data.sma200));
    const ai=getAISignal(data.rsi,data.sma20,data.sma50);
    setText("aiSignal",ai.t);setText("aiDesc",ai.t==="STRONG BUY"?"Oversold conditions with positive momentum":ai.t==="BUY"?"Momentum and short-term trend align":"Technical conditions do not show a strong buy setup");setText("t_signal",ai.t);
    setText("analysisSignal",ai.t);setText("analysisSignalDesc",ai.t==="STRONG BUY"?"Oversold conditions detected":ai.t==="BUY"?"Short-term trend supports the signal":ai.t==="STRONG SELL"?"Overbought conditions detected":"Wait for stronger confirmation");
    document.getElementById("aiSignal").style.color=ai.c;document.getElementById("t_signal").style.color=ai.c;document.getElementById("analysisSignal").style.color=ai.c;
    renderChart(data);
    try{ const news=await getNews(symbol); renderNews(news); }catch{ renderNews([]); }
  }catch(error){
    setText("stockPrice","₹--");setText("change","DATA UNAVAILABLE");document.getElementById("change").style.color="#ffcc00";document.getElementById("change").style.background="rgba(255,204,0,.12)";setText("aiSignal","UNAVAILABLE");setText("aiDesc","No live quote received");document.getElementById("newsBox").innerHTML="<div style='padding:8px;background:#0e1429;border-radius:6px;color:#ffcc00'>Live market data is unavailable right now. No estimated or fabricated value is shown.</div>";renderChart(null);console.warn("[StockSense]",error);
  }
}
function renderChart(data){
  const container=document.getElementById("chart");
  chartSourceData=data;
  if(chartResizeObserver){try{chartResizeObserver.disconnect();}catch{}chartResizeObserver=null;}
  container.innerHTML="";
  if(currentChart){try{currentChart.remove();}catch{}currentChart=null;}
  const toolbar=document.getElementById("chartToolbar");
  if(toolbar){
    toolbar.querySelectorAll("[data-range]").forEach(btn=>{btn.style.background=btn.dataset.range===chartRange?"#00d4ff":"#0e1429";btn.style.color=btn.dataset.range===chartRange?"#070d2b":"#7C8DB0";btn.onclick=()=>{chartRange=btn.dataset.range;renderChart(chartSourceData);};});
  }
  if(!data){container.innerHTML="<div style='height:100%;display:flex;align-items:center;justify-content:center;color:#ffcc00;font-size:11px'>Chart unavailable — closing-price history could not be loaded.</div>";return;}
  const cutoffDays={ "1M":31, "3M":93, "6M":186, "1Y":370 }[chartRange]||370;
  const cutoff=Math.floor(Date.now()/1000)-cutoffDays*86400;
  currentChart=createChart(container,{width:container.clientWidth,height:360,layout:{background:{color:"#070d2b"},textColor:"#7C8DB0"},grid:{vertLines:{color:"#17254a"},horzLines:{color:"#17254a"}},rightPriceScale:{borderColor:"#1e2d5a"},timeScale:{borderColor:"#1e2d5a",timeVisible:true}});
  const candles=[];data.timestamps.forEach((ts,i)=>{const o=data.opens[i],h=data.highs[i],l=data.lows[i],cl=data.closes[i];if(ts>=cutoff&&[o,h,l,cl].every(Number.isFinite))candles.push({time:ts,open:o,high:h,low:l,close:cl});});
  if(!candles.length){container.innerHTML="<div style='height:100%;display:flex;align-items:center;justify-content:center;color:#7C8DB0;font-size:11px'>No closing-price history for this range.</div>";return;}
  const series=currentChart.addSeries(CandlestickSeries,{upColor:"#22c55e",downColor:"#ef4444",borderVisible:false,wickUpColor:"#22c55e",wickDownColor:"#ef4444"});series.setData(candles);
  const vol=currentChart.addSeries(HistogramSeries,{priceFormat:{type:"volume"},priceScaleId:""});vol.priceScale().applyOptions({scaleMargins:{top:.8,bottom:0}});
  const volumes=data.timestamps.map((ts,i)=>({ts,value:Number(data.volumes[i])||0})).filter(x=>x.ts>=cutoff);
  vol.setData(volumes.map(x=>({time:x.ts,value:x.value})));
  currentChart.timeScale().fitContent();
  chartResizeObserver=new ResizeObserver(()=>{if(currentChart)currentChart.applyOptions({width:Math.max(320,container.clientWidth)});});chartResizeObserver.observe(container);
}
async function loadIndices(){
  const syms=[["^NSEI","NIFTY 50"],["^NSEBANK","BANK NIFTY"],["^BSESN","SENSEX"],["^CNXIT","NIFTY IT"]];
  const values=await Promise.all(syms.map(async([s,n])=>{try{const q=await getQuote(s);return {n,q,pct:(q.price-q.prev)/q.prev*100};}catch{return {n,q:null,pct:null};}}));
  document.getElementById("indices").innerHTML=values.map(x=>x.q?'<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #1a274a"><div><div style="font-size:11px;font-weight:600">'+x.n+'</div><div style="font-size:9px;color:#7C8DB0">LAST CLOSE</div></div><div style="text-align:right"><div style="font-size:11px;font-weight:700">'+x.q.price.toFixed(2)+'</div><div style="font-size:9px;color:'+(x.pct>=0?"#00ff88":"#ff4444")+'">'+percent(x.pct)+'</div></div></div>':'<div style="padding:10px 0;border-bottom:1px solid #1a274a"><div style="font-size:11px;font-weight:600">'+x.n+'</div><div style="font-size:9px;color:#ffcc00">Market data unavailable</div></div>').join("")+'<div style="margin-top:10px;font-size:9px;color:#7C8DB0;text-align:center">IST '+new Date().toLocaleTimeString("en-IN")+'</div>';
}
function calcRSIForScreen(c){
  if(!Array.isArray(c)||c.length<15)return 50;
  let g=0,l=0;
  for(let i=c.length-14;i<c.length;i++){const d=c[i]-c[i-1];if(d>0)g+=d;else l-=d;}
  return l===0?100:100-(100/(1+g/l));
}
async function runScreener(type){
  const box=document.getElementById("screenerBox"),res=document.getElementById("screenerResults");
  box.style.display="block";res.innerHTML="Scanning live data…";
  const values=await Promise.all(TICKERS.slice(0,30).map(async t=>{try{const q=await getQuote(t+".NS");const rsi=calcRSIForScreen(q.closes);return {symbol:t,nse:t+".NS",price:q.price,pct:(q.price-q.prev)/q.prev*100,rsi};}catch{return null;}}));
  const filtered=values.filter(Boolean).filter(r=>type==="BUY"?r.rsi<45:r.rsi<35).sort((a,b)=>a.rsi-b.rsi);
  res.innerHTML='<div style="color:#00ff88;font-size:11px">'+filtered.length+' FOUND</div>'+filtered.map(s=>'<div style="display:flex;justify-content:space-between;padding:8px;background:#0e1429;margin:4px 0;border-radius:6px;cursor:pointer" data-screen="'+s.nse+'"><span><b>'+s.symbol+'</b> RSI '+s.rsi.toFixed(1)+'</span><span style="color:'+(s.pct>=0?"#00ff88":"#ff4444")+'">'+money(s.price)+' '+percent(s.pct)+'</span></div>').join("");
  res.querySelectorAll("[data-screen]").forEach(x=>x.onclick=()=>loadStockGlobal(x.dataset.screen));
}
function setupScreener(){
  document.getElementById("scanBuy").onclick=()=>runScreener("BUY");
  document.getElementById("scanOversold").onclick=()=>runScreener("OVERSOLD");
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
  setupWatchlistControls();
  setupPortfolio();
  setupScreener();
  loadPortfolio();
  await Promise.all([loadStock(currentSymbol),renderWatchlist(),loadIndices()]);
  const updateMarketStatus=()=>{const h=new Date().getHours(),m=new Date().getMinutes();setText("marketStatus",(h>9&&h<15||(h===9&&m>=15)||(h===15&&m<30)?"🟢 OPEN ":"🔴 CLOSED ")+new Date().toLocaleTimeString("en-IN"));};
  updateMarketStatus();
  setInterval(updateMarketStatus,1000);
}
init();
