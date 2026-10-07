import { getQuote, getQuotesBatch, getFastQuote, getTechnicalData, getFastFundamentals, getFundamentals, getNews, getAISignal, formatCompactNumber, searchSymbols, calcRSI, calcSMA } from "./utils/api.js";
import { nseSearchUniverse } from "./data/topStocks.js";

const TICKERS=[...new Set(nseSearchUniverse.map(s=>s.display))];
const STOCK_META=new Map(nseSearchUniverse.map(s=>[s.symbol,s]));
const PORTFOLIO_KEY="ss_portfolio";
const PORTFOLIO_MAX=30;
let portfolio=[];
let currentSymbol="SBIN.NS";
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
    @media(max-width:820px){.ss-analysis{grid-template-columns:1fr}.ss-breakdown{grid-template-columns:repeat(3,1fr)}}
    @media(max-width:1080px){#ss-shell{grid-template-columns:300px 1fr!important}#ss-right-panel{display:none!important}}
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
    <div id="ss-shell" style="max-width:1450px;margin:0 auto;display:grid;grid-template-columns:350px 1fr 420px;gap:16px;padding:16px;min-height:calc(100vh - 130px)">
      <div class="ss-card" style="background:#121a33;border:1px solid #1e2d5a;border-radius:12px;display:flex;flex-direction:column;overflow:hidden">
        <div style="padding:14px;border-bottom:1px solid #1e2d5a"><div style="display:flex;justify-content:space-between;align-items:center"><div><div style="font-size:14px;font-weight:850">My Portfolio</div><div id="portfolioCount" style="font-size:9px;color:#7C8DB0">0 / 30 stocks tracked</div></div></div></div>
        <div style="padding:10px 12px;background:#0e1429;border-bottom:1px solid #1e2d5a"><div style="display:flex;gap:6px"><input id="portfolioSearch" placeholder="Search symbol to add" style="flex:1;padding:8px 12px;background:#070d2b;border:1px solid #1e2d5a;border-radius:8px;color:white;font-size:11px;outline:none"/><button id="portfolioSearchBtn" style="padding:8px 12px;background:#00d4ff;color:#070d2b;border:none;border-radius:8px;font-weight:700;font-size:11px">+ Add</button></div><div style="font-size:9px;color:#7C8DB0;margin-top:6px">Add up to 30 NSE/BSE stocks.</div></div>
        <div style="display:grid;grid-template-columns:1fr 68px 70px 58px 24px;gap:8px;padding:8px 14px;font-size:9px;color:#7C8DB0;font-weight:700;border-bottom:1px solid #1e2d5a;background:#0e1429"><span>Stocks</span><span style="text-align:right">LTP</span><span style="text-align:right">Price Chg</span><span style="text-align:right">% Chg</span><span></span></div>
        <div id="portfolioList" style="flex:1;overflow:auto;min-height:320px;padding:4px 0"><div style="padding:22px 14px;text-align:center;color:#7C8DB0;font-size:11px">Your portfolio is empty.<br><span style="font-size:9px">Search for a stock above or add the selected stock.</span></div></div>
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
          <div style="margin-top:10px;background:#070d2b;border:1px solid #1e2d5a;border-radius:10px;padding:12px">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
              <div><div style="font-size:9px;color:#7C8DB0;font-weight:800">📑 COMPANY FINANCIALS</div><div id="financialPeriodLabel" style="font-size:10px;color:#dce8ff;margin-top:3px">Loading exchange filings…</div></div>
              <span id="financialSourceBadge" style="font-size:8px;color:#8fb8ff;background:rgba(79,140,255,.10);padding:4px 7px;border-radius:8px">--</span>
            </div>
            <div id="financialTable" style="margin-top:8px;overflow:auto"></div>
            <div style="margin-top:12px;font-size:9px;color:#7C8DB0;font-weight:800">ANNUAL PERFORMANCE</div>
            <div id="annualFinancialTable" style="margin-top:6px;overflow:auto"></div>
            <div id="financialMeta" style="margin-top:8px;font-size:8px;color:#60759d"></div>
          </div>
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
  if(!items?.length){box.innerHTML="<div style='padding:8px;background:#0e1429;border-radius:6px;color:#7C8DB0'>No live news is available right now.</div>";return;}
  box.innerHTML=items.map(n=>`<div style="padding:7px;background:#0e1429;border-radius:6px;margin:4px 0"><a href="${escapeHtml(safeExternalUrl(n.link))}" target="_blank" rel="noopener noreferrer" style="color:white;text-decoration:none">${escapeHtml(n.title || "Untitled news item")}</a><div style="font-size:9px;color:#7C8DB0;margin-top:3px">${escapeHtml(n.publisher || "Unknown publisher")}</div></div>`).join("");
}
async function loadStock(symbol){
  const requestId=++stockRequestId;
  currentSymbol=symbol;
  setText("stockName",symbol+" • "+(symbol.endsWith(".BO")?"BSE":"NSE")+" • loading");
  setText("stockPrice","₹--");setText("change","Loading live data...");
  try{
    const data=await getFastQuote(symbol);
    if(requestId!==stockRequestId)return;
    document.getElementById("stockName").textContent=symbol+" • "+(symbol.endsWith(".BO")?"BSE":"NSE")+" • "+new Date().toLocaleTimeString("en-IN");
    setText("stockPrice",money(data.price));
    const ch=document.getElementById("change");ch.textContent=percent(data.change)+" ("+percent(data.changePct)+")";ch.style.background=data.change>=0?"rgba(0,255,136,.15)":"rgba(255,68,68,.15)";ch.style.color=data.change>=0?"#00ff88":"#ff4444";
    setText("dayHigh",money(data.high));setText("dayLow",money(data.low));setText("dayVol",Number.isFinite(data.vol)?(data.vol/1e6).toFixed(2)+"M":"--");setText("w52",money(data.low52)+" / "+money(data.high52));
    setText("rsiValue","Loading…");setText("sma20","Loading…");setText("sma50","Loading…");setText("sma200","Loading…");
    let technical=null;
    try{ technical=await getTechnicalData(symbol); }catch(error){ console.warn("[StockSense] technical data",error); }
    if(requestId!==stockRequestId)return;
    const closes=technical?.closes||[];
    data.rsi=calcRSI(closes);
    data.sma20=calcSMA(closes,20);
    data.sma50=calcSMA(closes,50);
    data.sma200=calcSMA(closes,200);
    const first=closes[0];
    data.yearChange=first ? ((data.price-first)/first)*100 : null;
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
    setText("yearValue","Year "+(Number.isFinite(data.yearChange)?percent(data.yearChange):"--"));
    
function renderFinancials(fund){
  const quarters=(fund?.quarterlyRows||[]).filter(r=>r?.date).slice(0,8);
  const years=(fund?.annualRows||[]).filter(r=>r?.date).slice(0,5);
  const renderRows=(rows)=>rows.length?'<table style="width:100%;border-collapse:collapse;font-size:9px;min-width:520px"><thead><tr><th style="text-align:left;color:#7C8DB0;padding:5px">Period</th><th style="text-align:right;color:#7C8DB0;padding:5px">Revenue</th><th style="text-align:right;color:#7C8DB0;padding:5px">EBITDA</th><th style="text-align:right;color:#7C8DB0;padding:5px">PAT</th><th style="text-align:right;color:#7C8DB0;padding:5px">EPS</th></tr></thead><tbody>'+rows.map(r=>'<tr><td style="padding:6px;border-top:1px solid #1e2d5a">'+new Date(r.date*1000).toLocaleDateString("en-IN",{month:"short",year:"numeric"})+'</td><td style="padding:6px;text-align:right;border-top:1px solid #1e2d5a">'+formatCompactNumber(r.revenue)+'</td><td style="padding:6px;text-align:right;border-top:1px solid #1e2d5a">'+formatCompactNumber(r.ebitda)+'</td><td style="padding:6px;text-align:right;border-top:1px solid #1e2d5a">'+formatCompactNumber(r.pat??r.netIncome)+'</td><td style="padding:6px;text-align:right;border-top:1px solid #1e2d5a">'+(Number.isFinite(r.eps)?r.eps.toFixed(2):"--")+'</td></tr>').join("")+'</tbody></table>':'<div style="color:#7C8DB0;font-size:10px;padding:8px 0">No exchange filing data available for this period.</div>';
  setText("financialPeriodLabel",(quarters.length?"Quarterly":"Financial")+" performance • latest "+(quarters[0]?.date?new Date(quarters[0].date*1000).toLocaleDateString("en-IN",{month:"short",year:"numeric"}):"--"));
  const qt=document.getElementById("financialTable"); if(qt) qt.innerHTML=renderRows(quarters);
  const at=document.getElementById("annualFinancialTable"); if(at) at.innerHTML=renderRows(years);
  const source=fund?.source||"Financial data";
  setText("financialSourceBadge",source.startsWith("NSE")?"NSE FILING":source.startsWith("Yahoo")?"YAHOO FALLBACK":"--");
  setText("financialMeta",(fund?.mode||"")+(fund?.updatedAt?" • updated "+new Date(fund.updatedAt).toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short"}):"")+(fund?.sourceUrl?" • Official filing linked":""));
}

    const applyFundamentals=(fund)=>{
      renderFinancials(fund);
      setText("fundSource",fund?.source||"Company financial data");
      setText("f_pe",Number.isFinite(fund?.pe)?fund.pe.toFixed(2):"--");setText("f_eps",Number.isFinite(fund?.eps)?money(fund.eps):"--");setText("f_mcap",formatCompactNumber(fund?.mcap));setText("f_book",Number.isFinite(fund?.bookValue)?money(fund.bookValue):"--");setText("f_div",Number.isFinite(fund?.div)?fund.div.toFixed(2)+"%":"--");setText("f_roe",Number.isFinite(fund?.roe)?fund.roe.toFixed(1)+"%":"--");setText("f_roa",Number.isFinite(fund?.roa)?fund.roa.toFixed(1)+"%":"--");setText("f_de",Number.isFinite(fund?.debtEquity)?fund.debtEquity.toFixed(1):"--");setText("f_rg",Number.isFinite(fund?.revenueGrowth)?fund.revenueGrowth.toFixed(1)+"%":"--");setText("f_eg",Number.isFinite(fund?.earningsGrowth)?fund.earningsGrowth.toFixed(1)+"%":"--");setText("f_om",Number.isFinite(fund?.operatingMargin)?fund.operatingMargin.toFixed(1)+"%":"--");setText("f_pm",Number.isFinite(fund?.pm)?fund.pm.toFixed(1)+"%":"--");setText("f_rev",formatCompactNumber(fund?.totalRevenue));setText("f_ni",formatCompactNumber(fund?.netIncome));setText("f_fcf",formatCompactNumber(fund?.freeCashFlow));setText("f_beta",Number.isFinite(fund?.beta)?fund.beta.toFixed(2):"--");
      setText("peValue","P/E "+(Number.isFinite(fund?.pe)?fund.pe.toFixed(2):"--"));setText("mcapValue","M-Cap "+formatCompactNumber(fund?.mcap));setText("betaValue","Beta "+(Number.isFinite(fund?.beta)?fund.beta.toFixed(2):"--"));
      setText("divValue","Div "+(Number.isFinite(fund?.div)?fund.div.toFixed(2)+"%":"--"));setText("profitValue","Profit "+(Number.isFinite(fund?.pm)?fund.pm.toFixed(1)+"%":"--"));
    };
    // Paint the valuation snapshot immediately, then replace it with the complete NSE filing data.
    getFastFundamentals(symbol).then(fast=>{if(requestId===stockRequestId)applyFundamentals(fast);}).catch(()=>{});
    getFundamentals(symbol).then(fund=>{if(requestId===stockRequestId)applyFundamentals(fund);}).catch(()=>{});
    setText("t_rsi",Number.isFinite(data.rsi)?data.rsi.toFixed(1):"--");setText("t_sma20",money(data.sma20));setText("t_sma50",money(data.sma50));setText("t_sma200",money(data.sma200));
    const ai=getAISignal(data.rsi,data.sma20,data.sma50);
    setText("aiSignal",ai.t);setText("aiDesc",ai.t==="STRONG BUY"?"Oversold conditions with positive momentum":ai.t==="BUY"?"Momentum and short-term trend align":"Technical conditions do not show a strong buy setup");setText("t_signal",ai.t);
    setText("analysisSignal",ai.t);setText("analysisSignalDesc",ai.t==="STRONG BUY"?"Oversold conditions detected":ai.t==="BUY"?"Short-term trend supports the signal":ai.t==="STRONG SELL"?"Overbought conditions detected":"Wait for stronger confirmation");
    document.getElementById("aiSignal").style.color=ai.c;document.getElementById("t_signal").style.color=ai.c;document.getElementById("analysisSignal").style.color=ai.c;
    getNews(symbol).then(news=>{if(requestId===stockRequestId)renderNews(news);}).catch(()=>renderNews([]));
  }catch(error){
    setText("stockPrice","₹--");setText("change","DATA UNAVAILABLE");document.getElementById("change").style.color="#ffcc00";document.getElementById("change").style.background="rgba(255,204,0,.12)";setText("aiSignal","UNAVAILABLE");setText("aiDesc","No live quote received");document.getElementById("newsBox").innerHTML="<div style='padding:8px;background:#0e1429;border-radius:6px;color:#ffcc00'>Live market data is unavailable right now. No estimated or fabricated value is shown.</div>";console.warn("[StockSense]",error);
  }
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
  loadIndices();
  const updateMarketStatus=()=>{const h=new Date().getHours(),m=new Date().getMinutes();setText("marketStatus",(h>9&&h<15||(h===9&&m>=15)||(h===15&&m<30)?"🟢 OPEN ":"🔴 CLOSED ")+new Date().toLocaleTimeString("en-IN"));};
  updateMarketStatus();
  setInterval(updateMarketStatus,1000);
}
init();
