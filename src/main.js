import { getQuote, getQuotesBatch, getFastQuote, getTechnicalData, getNews, getAISignal, searchSymbols, calcRSI, calcSMA } from "./utils/api.js";
import { nseSearchUniverse } from "./data/topStocks.js";

const TICKERS=[...new Set(nseSearchUniverse.map(s=>s.display))];
const STOCK_META=new Map(nseSearchUniverse.map(s=>[s.symbol,s]));
const PORTFOLIO_KEY="ss_portfolio";
const PORTFOLIO_MAX=30;
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
function money(value){
  return Number.isFinite(value)?"₹"+value.toFixed(2):"--";
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
    .ss-news-item{padding:9px 10px;background:#0e1429;border:1px solid rgba(91,121,180,.14);border-radius:8px;margin:6px 0}
    .ss-news-title{font-size:11px;line-height:1.45;font-weight:700}
    .ss-news-meta{font-size:9px;color:#7C8DB0;margin-top:5px}
    @media(max-width:820px){.ss-analysis{grid-template-columns:1fr}.ss-breakdown{grid-template-columns:repeat(3,1fr)}.ss-tech-grid{grid-template-columns:repeat(2,1fr)!important}} @media(max-width:520px){.ss-tech-grid{grid-template-columns:1fr!important}}
    @media(max-width:1080px){#ss-shell{grid-template-columns:270px 1fr!important}#ss-right-panel{display:none!important}}
    @media(max-width:820px){#ss-header{position:relative!important;padding:12px!important}#ss-header>div{max-width:none!important}#ss-shell{display:flex!important;flex-direction:column!important;padding:8px!important}.ss-watch{min-height:0!important;max-height:none}.ss-detail{width:100%}#stockPrice{font-size:28px!important}.ss-metrics{grid-template-columns:repeat(2,1fr)!important}.ss-fund{grid-template-columns:1fr!important}#searchAll{min-width:0!important}}
    @media(max-width:520px){#ss-header-actions{width:100%;justify-content:flex-start!important}.ss-metrics{grid-template-columns:1fr 1fr!important}}
  `; document.head.appendChild(style);
}

function ensureUI(){
  installDesignSystem();
  document.getElementById("app").innerHTML=`
  <div style="background:radial-gradient(circle at 20% 0%,rgba(35,72,145,.18),transparent 28%),radial-gradient(circle at 85% 10%,rgba(0,212,255,.08),transparent 24%),#050914;color:white;min-height:100vh;font-family:Inter,sans-serif">
    <div id="ss-header" style="background:#0e1a4d;border-bottom:1px solid #1e2d5a;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;position:sticky;top:0;z-index:20">
      <div style="display:flex;align-items:center;gap:12px"><div style="width:40px;height:40px;background:linear-gradient(135deg,#00d4ff,#7c3aed);border-radius:10px;display:flex;align-items:center;justify-content:center"><span style="color:white;font-weight:900;font-size:22px">₹</span></div><div><div style="display:flex;align-items:center;gap:8px"><span style="font-weight:900;font-size:19px">STOCKSENSE</span><span style="font-size:9px;background:#1e2d5a;color:#00d4ff;padding:2px 6px;border-radius:10px">BETA</span></div><div style="font-size:11px;color:#7C8DB0">Indian Stock Market Intelligence</div></div></div>
      <div style="flex:1;max-width:440px;position:relative"><input id="searchAll" placeholder="Search stocks, symbols or company names…" style="width:100%;padding:10px 16px;background:#070d2b;color:white;border:1px solid #1e2d5a;border-radius:20px;outline:none;font-size:13px"/><div id="searchResults" style="position:absolute;top:44px;left:0;right:0;z-index:9999;background:#0f172f;border:1px solid #1e2d5a;border-radius:12px;max-height:320px;overflow:auto;display:none"></div></div>
      <div id="ss-header-actions" style="display:flex;gap:8px;align-items:center"><div id="marketStatus" style="font-size:11px;padding:7px 12px;background:#121a33;border:1px solid #1e2d5a;border-radius:20px">--</div></div>
    </div>
    <div id="ss-tabs" style="max-width:1450px;margin:0 auto;padding:12px 16px 0;display:flex;gap:8px">
      <button id="tabDashboard" type="button" style="padding:9px 18px;border-radius:10px;border:1px solid #00d4ff;background:#00d4ff;color:#06101f;font-size:11px;font-weight:850;cursor:pointer">Dashboard</button>
      <button id="tabMarket" type="button" style="padding:9px 18px;border-radius:10px;border:1px solid #1e2d5a;background:#121a33;color:#9fb0cf;font-size:11px;font-weight:850;cursor:pointer">Market Overview</button>
    </div>
    <div id="ss-dashboard-view">
    <div id="ss-shell" style="max-width:1450px;margin:0 auto;display:grid;grid-template-columns:270px 1fr;gap:16px;padding:16px;min-height:calc(100vh - 130px)">
      <div class="ss-card" style="background:#121a33;border:1px solid #1e2d5a;border-radius:12px;display:flex;flex-direction:column;overflow:hidden">
        <div style="padding:14px;border-bottom:1px solid #1e2d5a"><div style="display:flex;justify-content:space-between;align-items:center"><div><div style="font-size:14px;font-weight:850">My Portfolio</div><div id="portfolioCount" style="font-size:9px;color:#7C8DB0">0 / 30 stocks tracked</div></div></div></div>
        <div style="padding:10px 12px;background:#0e1429;border-bottom:1px solid #1e2d5a"><div style="display:flex;gap:6px"><input id="portfolioSearch" placeholder="Search symbol to add" style="flex:1;padding:8px 12px;background:#070d2b;border:1px solid #1e2d5a;border-radius:8px;color:white;font-size:11px;outline:none"/><button id="portfolioSearchBtn" style="padding:8px 12px;background:#00d4ff;color:#070d2b;border:none;border-radius:8px;font-weight:700;font-size:11px">+ Add</button></div><div style="font-size:9px;color:#7C8DB0;margin-top:6px">Add up to 30 NSE/BSE stocks.</div></div>
        <div style="display:grid;grid-template-columns:1fr 68px 70px 58px 24px;gap:8px;padding:8px 14px;font-size:9px;color:#7C8DB0;font-weight:700;border-bottom:1px solid #1e2d5a;background:#0e1429"><span>Stocks</span><span style="text-align:right">LTP</span><span style="text-align:right">Price Chg</span><span style="text-align:right">% Chg</span><span></span></div>
        <div id="portfolioList" style="flex:1;overflow:auto;min-height:220px;max-height:420px;padding:4px 0"></div>
        <div style="padding:10px 14px;border-top:1px solid #1e2d5a;display:flex;justify-content:space-between;font-size:10px;background:#0e1429"><div>Top Gainer: <b id="portfolioTopGainer" style="color:#00ff88">--</b></div><div>Loser: <b id="portfolioTopLoser" style="color:#ff4444">--</b></div></div>
      </div>
      <div class="ss-detail" style="display:flex;flex-direction:column;gap:12px">
        <div class="ss-card" style="background:#121a33;border:1px solid #1e2d5a;border-radius:12px;padding:16px">
          <div style="display:flex;justify-content:space-between"><div><div id="stockName" style="font-size:11px;color:#7fb2ff;font-weight:800;letter-spacing:.04em">SBIN.NS • NSE</div><div style="display:flex;align-items:baseline;gap:12px;margin-top:4px"><h1 id="stockPrice" style="font-size:36px;margin:0;font-weight:850;letter-spacing:-.03em">₹--</h1><div id="change" style="padding:4px 10px;border-radius:20px;font-weight:700;font-size:12px">--</div></div><div style="display:flex;gap:12px;margin-top:8px;font-size:10px;color:#7C8DB0"><span>H <b id="dayHigh" style="color:white">--</b></span><span>L <b id="dayLow" style="color:white">--</b></span><span>Vol <b id="dayVol" style="color:white">--</b></span><span>52W <b id="w52" style="color:white">--</b></span></div></div><div style="text-align:right"><div style="font-size:9px;color:#7C8DB0">AI SIGNAL</div><div id="aiSignal" style="margin-top:6px;padding:6px 14px;border-radius:20px;font-weight:800;font-size:12px;border:1px solid #1e2d5a;background:#1e2d5a">--</div><div id="aiDesc" style="font-size:9px;color:#7C8DB0;margin-top:4px">--</div><button id="addPortfolio" style="margin-top:10px;padding:6px 14px;background:#00d4ff;color:#070d2b;border:none;border-radius:20px;font-weight:700;font-size:11px">+ My Portfolio</button></div></div>
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
              <div class="ss-trend-row"><span class="ss-trend-name">52W Range</span><b id="range52Value" class="ss-trend-value">--</b></div>
              <div class="ss-trend-row"><span class="ss-trend-name">Trend Strength</span><b id="trendStrengthValue" class="ss-trend-value">--</b></div>
            </div>
          </div>
          <div id="screenerBox" style="margin-top:10px;background:#070d2b;border:1px solid #1e2d5a;border-radius:12px;padding:12px;display:none"><div style="font-size:11px;font-weight:700">Screener Results</div><div id="screenerResults" style="max-height:200px;overflow:auto;margin-top:8px"></div></div>
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
    <div style="background:#1a1400;border-top:1px solid #3d3000;padding:12px 16px;text-align:center"><div style="font-size:11px;color:#ffcc66;line-height:16px;max-width:900px;margin:0 auto"><b>⚠️ Disclaimer:</b> This app is a hobby project, made for educational purpose only. Do your own market research before investing or trading. We are not SEBI registered. Market data may be delayed.</div></div>
  </div>`;
}

async function renderPortfolio(){
  const list=portfolio.map(symbol=>({symbol,display:symbolLabel(symbol),name:STOCK_META.get(symbol)?.name||symbolLabel(symbol)}));
  setText("portfolioCount",list.length+" / "+PORTFOLIO_MAX+" stocks tracked");
  const box=document.getElementById("portfolioList"); if(!box)return;
  if(!list.length){box.innerHTML="<div style='padding:22px 14px;text-align:center;color:#7C8DB0;font-size:11px'></div>";setText("portfolioTopGainer","--");setText("portfolioTopLoser","--");return;}
  const quotes=await getQuotesBatch(list.map(s=>s.symbol));
  const live=list.map(s=>{const q=quotes.get(String(s.symbol).toUpperCase());return q?{...s,...q}:{...s,price:null,change:null,changePct:null};});
  box.innerHTML=live.map(s=>`<div data-row style="display:grid;grid-template-columns:1fr 68px 70px 58px 24px;gap:8px;align-items:center;padding:9px 14px;border-bottom:1px solid rgba(91,121,180,.12);cursor:pointer"><div><div style="font-size:11px;font-weight:800">${escapeHtml(s.display)}</div><div style="font-size:8px;color:#7C8DB0">${escapeHtml(s.name||"")}</div></div><div style="text-align:right;font-size:10px;font-weight:800">${money(s.price)}</div><div style="text-align:right;font-size:10px;font-weight:800;color:${s.change>=0?"#00ff88":"#ff4444"}">${money(s.change)}</div><div style="text-align:right;font-size:10px;font-weight:800;color:${s.changePct>=0?"#00ff88":"#ff4444"}">${percent(s.changePct)}</div><button type="button" data-remove="${escapeHtml(s.symbol)}" aria-label="Remove ${escapeHtml(s.display)}" style="background:none;border:0;color:#ff4444;cursor:pointer;font-size:16px">×</button></div>`).join("");
  box.querySelectorAll("[data-row]").forEach(row=>row.onclick=()=>loadStockGlobal(row.querySelector("[data-remove]")?.dataset.remove||""));
  box.querySelectorAll("[data-remove]").forEach(btn=>btn.onclick=e=>{e.stopPropagation();removeFromPortfolio(btn.dataset.remove);});
  const valid=live.filter(x=>Number.isFinite(x.changePct));
  if(valid.length){const gain=[...valid].sort((x,y)=>y.changePct-x.changePct)[0],lose=[...valid].sort((x,y)=>x.changePct-y.changePct)[0];setText("portfolioTopGainer",symbolLabel(gain.symbol)+" "+percent(gain.changePct));setText("portfolioTopLoser",symbolLabel(lose.symbol)+" "+percent(lose.changePct));}
}
function addToPortfolio(symbol){
  const normalized=normalizeSymbol(symbol); if(!normalized)return;
  if(portfolio.includes(normalized)){loadStockGlobal(normalized);return;}
  if(portfolio.length>=PORTFOLIO_MAX){alert("Your portfolio can track a maximum of 30 stocks.");return;}
  portfolio.push(normalized);savePortfolio();renderPortfolio();loadStockGlobal(normalized);
}
function removeFromPortfolio(symbol){portfolio=portfolio.filter(s=>s!==symbol);savePortfolio();renderPortfolio();}
function setupSearch(){
  const input=document.getElementById("searchAll"),results=document.getElementById("searchResults");
  let timer=0,seq=0;
  input.addEventListener("input",()=>{
    const q=input.value.trim().toUpperCase();clearTimeout(timer);const my=++seq;
    if(!q){results.style.display="none";return;}
    const local=nseSearchUniverse.filter(s=>s.symbol.includes(q)||s.display.includes(q)||s.name.toUpperCase().includes(q)).slice(0,12);
    const draw=matches=>{results.innerHTML=matches.length?matches.map(s=>`<div data-s="${escapeHtml(s.symbol)}" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #1a274a;display:flex;justify-content:space-between"><span><b>${escapeHtml(s.display)}</b></span><span style="color:#00d4ff;font-size:10px">${escapeHtml(s.symbol)}</span></div>`).join(""):"<div style='padding:12px;color:#7C8DB0;font-size:11px'>No matching NSE/BSE symbol found.</div>";results.style.display="block";results.querySelectorAll("[data-s]").forEach(x=>x.onclick=()=>{loadStockGlobal(x.dataset.s);results.style.display="none";input.value="";});};
    draw(local);
    if(q.length>=2)timer=setTimeout(async()=>{try{const remote=await searchSymbols(q);if(my!==seq)return;draw([...local,...remote].filter((s,i,a)=>a.findIndex(x=>x.symbol===s.symbol)===i).slice(0,12));}catch{}},250);
  });
  const pInput=document.getElementById("portfolioSearch"),pBtn=document.getElementById("portfolioSearchBtn");
  const add=()=>{const v=normalizeSymbol(pInput.value);if(v)addToPortfolio(v);pInput.value="";};
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
  return {rsi,sma20,sma50,sma200,ema20,ema50,macd,macdSignal,stoch,atr,bbPos,volumeRatio,support,resistance,
    return1m:pctFromPrice(c,21,price),return3m:pctFromPrice(c,63,price),return6m:pctFromPrice(c,126,price),return1y:pctFromPrice(c,252,price),
    range52Low:data.low52,range52High:data.high52,trendScore};
}
async function loadStock(symbol){
  const requestId=++stockRequestId;
  let quoteLoaded=false;
  currentSymbol=symbol;
  setText("stockName",symbol+" • "+(symbol.endsWith(".BO")?"BSE":"NSE")+" • loading");
  setText("stockPrice","₹--");setText("change","Loading live data...");
  ["dayHigh","dayLow","dayVol","w52","rsiValue","smaStatus","smaLongStatus","priceTrend","sma20","sma50","sma200","rsiPosition","ema20Value","ema50Value","macdValue","macdSignalValue","stochValue","atrValue","bbValue","volumeTrend","supportValue","resistanceValue","return1m","return3m","return6m","return1y","range52Value","trendStrengthValue","analysisScore","analysisRsiState","analysisMomentum","analysisTrend"].forEach(id=>setText(id,"--"));
  ["aiSignal","analysisSignal"].forEach(id=>setText(id,"Loading…"));
  setText("aiDesc","Loading market data…");setText("analysisSignalDesc","Loading technical data…");
  const scoreFill=document.getElementById("analysisScoreFill");if(scoreFill)scoreFill.style.width="0%";
  const marker=document.getElementById("analysisRsiMarker");if(marker)marker.style.left="50%";
  try{
    const data=await getFastQuote(symbol);
    if(requestId!==stockRequestId)return;
    quoteLoaded=true;
    document.getElementById("stockName").textContent=symbol+" • "+(symbol.endsWith(".BO")?"BSE":"NSE")+" • "+new Date().toLocaleTimeString("en-IN");
    setText("stockPrice",money(data.price));
    const ch=document.getElementById("change");ch.textContent=percent(data.change)+" ("+percent(data.changePct)+")";ch.style.background=data.change>=0?"rgba(0,255,136,.15)":"rgba(255,68,68,.15)";ch.style.color=data.change>=0?"#00ff88":"#ff4444";
    setText("dayHigh",money(data.high));setText("dayLow",money(data.low));setText("dayVol",Number.isFinite(data.vol)?(data.vol/1e6).toFixed(2)+"M":"--");setText("w52",money(data.low52)+" / "+money(data.high52));
    setText("rsiValue","Loading…");setText("sma20","Loading…");setText("sma50","Loading…");setText("sma200","Loading…");
    let technical=null;
    if(Array.isArray(data.closes)&&data.closes.length>=20){
      technical=data;
    }else{
      try{ technical=await getTechnicalData(symbol); }catch(error){ console.warn("[StockSense] technical data",error); }
    }
    if(requestId!==stockRequestId)return;
    const closes=technical?.closes||[];
    data.closes=closes; data.highs=technical?.highs||[]; data.lows=technical?.lows||[]; data.volumes=technical?.volumes||[];
    if(!Number.isFinite(data.low52)&&data.closes.length) data.low52=Math.min(...data.closes);
    if(!Number.isFinite(data.high52)&&data.closes.length) data.high52=Math.max(...data.closes);
    const tech=technicalSnapshot(data);
    Object.assign(data,tech);
    setText("rsiValue",Number.isFinite(tech.rsi)?tech.rsi.toFixed(1):"--");
    setText("sma20",money(tech.sma20));setText("sma50",money(tech.sma50));setText("sma200",money(tech.sma200));
    setText("ema20Value",money(tech.ema20));setText("ema50Value",money(tech.ema50));
    setText("macdValue",Number.isFinite(tech.macd)?tech.macd.toFixed(2):"--");setText("macdSignalValue",Number.isFinite(tech.macdSignal)?tech.macdSignal.toFixed(2):"--");
    setText("stochValue",Number.isFinite(tech.stoch)?tech.stoch.toFixed(1):"--");setText("atrValue",money(tech.atr));
    setText("bbValue",Number.isFinite(tech.bbPos)?tech.bbPos.toFixed(0)+"% of band":"--");
    setText("volumeTrend",Number.isFinite(tech.volumeRatio)?tech.volumeRatio.toFixed(2)+"× avg":"--");
    setText("supportValue",money(tech.support));setText("resistanceValue",money(tech.resistance));
    setText("return1m",percent(tech.return1m));setText("return3m",percent(tech.return3m));setText("return6m",percent(tech.return6m));setText("return1y",percent(tech.return1y));
    setText("range52Value",money(tech.range52Low)+" / "+money(tech.range52High));
    setText("trendStrengthValue",tech.trendScore>=4?"Strong bullish":tech.trendScore>=2?"Bullish":tech.trendScore<=-4?"Strong bearish":tech.trendScore<=-2?"Bearish":"Mixed");
    const rsiState=tech.rsi==null?"Unavailable":tech.rsi<30?"Oversold":tech.rsi<45?"Weak / recovering":tech.rsi<=70?"Neutral / healthy":tech.rsi<=80?"Overbought":"Highly overbought";
    const momentum=tech.rsi==null?"Unavailable":tech.rsi<30?"Strong downside reversal zone":tech.rsi<45?"Bearish momentum":tech.rsi>70?"Overheated momentum":"Balanced momentum";
    const trend20_50=tech.sma20!=null&&tech.sma50!=null?(tech.sma20>tech.sma50?"Bullish":"Bearish"):"Unavailable";
    const trend50_200=tech.sma50!=null&&tech.sma200!=null?(tech.sma50>tech.sma200?"Bullish":"Bearish"):"Unavailable";
    const priceVs20=data.price!=null&&tech.sma20!=null?(data.price>tech.sma20?"Above SMA20":"Below SMA20"):"Unavailable";
    setText("smaStatus",trend20_50);setText("smaLongStatus",trend50_200);setText("priceTrend",priceVs20);setText("rsiPosition",rsiState);
    setText("analysisRsiState",rsiState);setText("analysisMomentum",momentum);
    setText("analysisTrend",tech.trendScore>=4?"Strong bullish":tech.trendScore>=2?"Bullish":tech.trendScore<=-4?"Strong bearish":tech.trendScore<=-2?"Bearish":"Mixed");
    const marker=document.getElementById("analysisRsiMarker"); if(marker) marker.style.left=(tech.rsi==null?"50%":Math.max(0,Math.min(100,tech.rsi))+"%");
    const ai=getAISignal(tech);
    setText("analysisScore",ai.score+"/100");setText("aiSignal",ai.t);setText("aiDesc",ai.desc);setText("analysisSignal",ai.t);setText("analysisSignalDesc",ai.desc);
    const scoreFill=document.getElementById("analysisScoreFill"); if(scoreFill){scoreFill.style.width=ai.score+"%";scoreFill.style.background=ai.c;}
    ["aiSignal","analysisSignal"].forEach(id=>{const el=document.getElementById(id);if(el)el.style.color=ai.c;});
    
    setText("t_rsi",Number.isFinite(data.rsi)?data.rsi.toFixed(1):"--");setText("t_sma20",money(data.sma20));setText("t_sma50",money(data.sma50));setText("t_sma200",money(data.sma200));
  }catch(error){
    if(requestId!==stockRequestId)return;
    if(!quoteLoaded){
      setText("stockPrice","₹--");setText("change","DATA UNAVAILABLE");
      const change=document.getElementById("change");if(change){change.style.color="#ffcc00";change.style.background="rgba(255,204,0,.12)";}
      setText("aiSignal","UNAVAILABLE");setText("aiDesc","Live quote unavailable. Please retry shortly.");
    }else{
      setText("aiSignal","UNAVAILABLE");setText("aiDesc","Technical analysis is temporarily unavailable.");
    }
    setText("analysisSignal","UNAVAILABLE");setText("analysisSignalDesc","Technical data is unavailable");
    setText("analysisScore","--");
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
  if(!Array.isArray(c)||c.length<15)return 50;
  let g=0,l=0;
  for(let i=c.length-14;i<c.length;i++){const d=c[i]-c[i-1];if(d>0)g+=d;else l-=d;}
  return l===0?100:100-(100/(1+g/l));
}
async function runScreener(type){
  const box=document.getElementById("screenerBox"),res=document.getElementById("screenerResults");
  box.style.display="block";res.textContent="Scanning live data…";
  try{
    const values=await Promise.all(TICKERS.slice(0,30).map(async t=>{try{const q=await getQuote(t+".NS");const rsi=calcRSIForScreen(q.closes);return {symbol:t,nse:t+".NS",price:q.price,pct:(q.price-q.prev)/q.prev*100,rsi};}catch{return null;}}));
  const filtered=values.filter(Boolean).filter(r=>type==="BUY"?r.rsi<45:r.rsi<35).sort((a,b)=>a.rsi-b.rsi);
    res.innerHTML='<div style="color:#00ff88;font-size:11px">'+filtered.length+' FOUND</div>'+filtered.map(s=>'<div style="display:flex;justify-content:space-between;padding:8px;background:#0e1429;margin:4px 0;border-radius:6px;cursor:pointer" data-screen="'+escapeHtml(s.nse)+'"><span><b>'+escapeHtml(s.symbol)+'</b> RSI '+s.rsi.toFixed(1)+'</span><span style="color:'+(s.pct>=0?"#00ff88":"#ff4444")+'">'+money(s.price)+' '+percent(s.pct)+'</span></div>').join("");
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

