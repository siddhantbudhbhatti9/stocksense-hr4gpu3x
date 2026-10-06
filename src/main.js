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
  if(!cap) return '<span style="font-size:8px;color:#7C8DB0;border:1px solid #2a3d5f;border-radius:5px;padding:2px 4px">—</span>';
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
function ensureUI(){
  document.getElementById("app").innerHTML=`
  <div style="background:#070d2b;color:white;min-height:100vh;font-family:Inter,sans-serif">
    <div style="background:#0e1a4d;border-bottom:1px solid #1e2d5a;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;position:sticky;top:0;z-index:20">
      <div style="display:flex;align-items:center;gap:12px"><div style="width:40px;height:40px;background:linear-gradient(135deg,#00d4ff,#7c3aed);border-radius:10px;display:flex;align-items:center;justify-content:center"><span style="color:white;font-weight:900;font-size:22px">₹</span></div><div><div style="display:flex;align-items:center;gap:8px"><span style="font-weight:900;font-size:19px">STOCKSENSE</span><span style="font-size:9px;background:#1e2d5a;color:#00d4ff;padding:2px 6px;border-radius:10px">BETA</span></div><div style="font-size:11px;color:#7C8DB0">Indian Stock Market Intelligence</div></div></div>
      <div style="flex:1;max-width:440px;position:relative"><input id="searchAll" placeholder="Search stock symbol — e.g. RVNL.BO, BSE.NS, HAL" style="width:100%;padding:10px 16px;background:#070d2b;color:white;border:1px solid #1e2d5a;border-radius:20px;outline:none;font-size:13px"/><div id="searchResults" style="position:absolute;top:44px;left:0;right:0;z-index:9999;background:#0f172f;border:1px solid #1e2d5a;border-radius:12px;max-height:320px;overflow:auto;display:none"></div></div>
      <div style="display:flex;gap:8px;align-items:center"><button id="scanBuy" style="padding:8px 14px;background:#00ff88;color:#070d2b;border:none;border-radius:20px;font-weight:800;font-size:11px">SCAN BUY</button><button id="scanOversold" style="padding:8px 14px;background:#121a33;color:white;border:1px solid #1e2d5a;border-radius:20px;font-size:11px">RSI &lt;35</button><div id="marketStatus" style="font-size:11px;padding:7px 12px;background:#121a33;border:1px solid #1e2d5a;border-radius:20px">--</div></div>
    </div>
    <div style="max-width:1450px;margin:0 auto;display:grid;grid-template-columns:350px 1fr 300px;gap:12px;padding:12px;min-height:calc(100vh - 130px)">
      <div style="background:#121a33;border:1px solid #1e2d5a;border-radius:12px;display:flex;flex-direction:column;overflow:hidden">
        <div style="padding:12px 14px;border-bottom:1px solid #1e2d5a"><div style="display:flex;justify-content:space-between;align-items:center"><div><div style="font-size:12px;font-weight:800">Watchlist</div><div id="watchlistCount" style="font-size:9px;color:#7C8DB0">Default • 10 stocks</div></div><div style="font-size:9px;color:#00ff88;background:rgba(0,255,136,.15);padding:3px 8px;border-radius:10px">● LIVE</div></div>
          <div id="watchlistTabs" style="display:flex;gap:5px;margin-top:10px;flex-wrap:wrap"></div>
          <div style="display:flex;gap:6px;margin-top:8px"><select id="watchlistSort" style="flex:1;padding:7px 9px;background:#070d2b;color:white;border:1px solid #1e2d5a;border-radius:8px;font-size:10px"><option value="default">Sort: Default</option><option value="az">A → Z</option><option value="za">Z → A</option><option value="price">Price: High → Low</option><option value="change">Change: High → Low</option><option value="changePct">Change %: High → Low</option></select><button id="newWatchlist" style="padding:7px 10px;background:#00d4ff;color:#070d2b;border:none;border-radius:8px;font-weight:800;font-size:10px">+ List</button></div>
        </div>
        <div style="padding:10px 12px;background:#0e1429;border-bottom:1px solid #1e2d5a"><div style="display:flex;gap:6px"><input id="watchlistSearch" placeholder="Search symbol to add" style="flex:1;padding:8px 12px;background:#070d2b;border:1px solid #1e2d5a;border-radius:8px;color:white;font-size:11px;outline:none"/><button id="watchlistSearchBtn" style="padding:8px 12px;background:#00d4ff;color:#070d2b;border:none;border-radius:8px;font-weight:700;font-size:11px">+ Add</button></div><div id="watchlistHint" style="font-size:9px;color:#7C8DB0;margin-top:6px"></div></div>
        <div style="display:grid;grid-template-columns:1fr 75px 65px 24px;gap:8px;padding:8px 14px;font-size:9px;color:#7C8DB0;font-weight:700;border-bottom:1px solid #1e2d5a;background:#0e1429"><span>Instrument</span><span style="text-align:right">LTP</span><span style="text-align:right">% Chg</span><span></span></div>
        <div id="mixCaps" style="flex:1;overflow:auto;min-height:320px">Loading watchlist...</div>
        <div style="padding:10px 14px;border-top:1px solid #1e2d5a;display:flex;justify-content:space-between;font-size:10px;background:#0e1429"><div>Top Gainer: <b id="topGainer" style="color:#00ff88">--</b></div><div>Loser: <b id="topLoser" style="color:#ff4444">--</b></div></div>
        <div style="background:#070d2b;border-top:1px solid #1e2d5a;padding:12px"><div style="font-size:11px;font-weight:700;margin-bottom:8px">💼 My Portfolio / Custom</div><div id="portfolio" style="font-size:12px;color:#7C8DB0">No stocks added</div><div style="margin-top:8px;display:flex;gap:6px"><input id="customAdd" placeholder="Add e.g. RVNL.BO" style="flex:1;padding:7px 10px;background:#121a33;border:1px solid #1e2d5a;border-radius:8px;color:white;font-size:11px;outline:none"/><button id="customAddBtn" style="padding:7px 12px;background:white;color:#070d2b;border:none;border-radius:8px;font-weight:700;font-size:11px">+</button></div></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div style="background:#121a33;border:1px solid #1e2d5a;border-radius:12px;padding:16px">
          <div style="display:flex;justify-content:space-between"><div><div id="stockName" style="font-size:11px;color:#00d4ff;font-weight:700">SBIN.NS • NSE</div><div style="display:flex;align-items:baseline;gap:12px;margin-top:4px"><h1 id="stockPrice" style="font-size:32px;margin:0;font-weight:800">₹--</h1><div id="change" style="padding:4px 10px;border-radius:20px;font-weight:700;font-size:12px">--</div></div><div style="display:flex;gap:12px;margin-top:8px;font-size:10px;color:#7C8DB0"><span>H <b id="dayHigh" style="color:white">--</b></span><span>L <b id="dayLow" style="color:white">--</b></span><span>Vol <b id="dayVol" style="color:white">--</b></span><span>52W <b id="w52" style="color:white">--</b></span></div></div><div style="text-align:right"><div style="font-size:9px;color:#7C8DB0">AI SIGNAL</div><div id="aiSignal" style="margin-top:6px;padding:6px 14px;border-radius:20px;font-weight:800;font-size:12px;border:1px solid #1e2d5a;background:#1e2d5a">--</div><div id="aiDesc" style="font-size:9px;color:#7C8DB0;margin-top:4px">--</div><button id="addPortfolio" style="margin-top:10px;padding:6px 14px;background:#00d4ff;color:#070d2b;border:none;border-radius:20px;font-weight:700;font-size:11px">+ Watchlist</button></div></div>
          <div id="chart" style="height:360px;margin-top:14px;border:1px solid #1e2d5a;border-radius:10px;overflow:hidden"></div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px">
            <div style="background:#070d2b;border:1px solid #1e2d5a;border-radius:10px;padding:10px"><div style="font-size:8px;color:#7C8DB0">RSI (14)</div><div id="rsiValue" style="font-size:18px;font-weight:800">--</div><div style="height:3px;background:#1e2d5a;margin-top:6px"><div id="rsiBar" style="height:100%;width:50%;background:#00d4ff"></div></div></div>
            <div style="background:#070d2b;border:1px solid #1e2d5a;border-radius:10px;padding:10px"><div style="font-size:8px;color:#7C8DB0">SMA 20/50/200</div><div style="font-size:11px;margin-top:2px"><div>20: <b id="sma20">--</b></div><div>50: <b id="sma50">--</b></div><div>200: <b id="sma200">--</b></div></div><div id="smaStatus" style="font-size:9px;margin-top:4px"></div></div>
            <div style="background:#070d2b;border:1px solid #1e2d5a;border-radius:10px;padding:10px"><div style="font-size:8px;color:#7C8DB0">P/E • M-CAP • BETA</div><div id="peValue" style="font-size:12px;font-weight:700;margin-top:2px">--</div><div id="mcapValue" style="font-size:10px;color:#7C8DB0"></div><div id="betaValue" style="font-size:10px;color:#7C8DB0"></div></div>
            <div style="background:#070d2b;border:1px solid #1e2d5a;border-radius:10px;padding:10px"><div style="font-size:8px;color:#7C8DB0">DIV • PROFIT • YEAR</div><div id="divValue" style="margin-top:2px">--</div><div id="profitValue" style="font-size:10px">--</div><div id="yearValue" style="font-size:10px">--</div></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px"><div style="background:#070d2b;border:1px solid #1e2d5a;border-radius:10px;padding:10px"><div style="font-size:9px;color:#7C8DB0;font-weight:700">📊 FUNDAMENTALS</div><div style="margin-top:6px;font-size:11px;line-height:22px"><div style="display:flex;justify-content:space-between"><span style="color:#7C8DB0">P/E Ratio</span><b id="f_pe">--</b></div><div style="display:flex;justify-content:space-between"><span style="color:#7C8DB0">Market Cap</span><b id="f_mcap">--</b></div><div style="display:flex;justify-content:space-between"><span style="color:#7C8DB0">Div Yield</span><b id="f_div">--</b></div><div style="display:flex;justify-content:space-between"><span style="color:#7C8DB0">Beta</span><b id="f_beta">--</b></div><div style="display:flex;justify-content:space-between"><span style="color:#7C8DB0">Profit Margin</span><b id="f_pm">--</b></div></div></div><div style="background:#070d2b;border:1px solid #1e2d5a;border-radius:10px;padding:10px"><div style="font-size:9px;color:#7C8DB0;font-weight:700">📈 TECHNICALS</div><div style="margin-top:6px;font-size:11px;line-height:22px"><div style="display:flex;justify-content:space-between"><span style="color:#7C8DB0">RSI</span><b id="t_rsi">--</b></div><div style="display:flex;justify-content:space-between"><span style="color:#7C8DB0">SMA20</span><b id="t_sma20">--</b></div><div style="display:flex;justify-content:space-between"><span style="color:#7C8DB0">SMA50</span><b id="t_sma50">--</b></div><div style="display:flex;justify-content:space-between"><span style="color:#7C8DB0">SMA200</span><b id="t_sma200">--</b></div><div style="display:flex;justify-content:space-between"><span style="color:#7C8DB0">Signal</span><b id="t_signal">--</b></div></div></div></div>
          <div style="margin-top:10px;background:#070d2b;border:1px solid #1e2d5a;border-radius:10px;padding:10px"><div style="font-size:9px;color:#7C8DB0;font-weight:700">📰 NEWS - LIVE</div><div id="newsBox" style="margin-top:6px;font-size:11px"></div></div>
          <div id="screenerBox" style="margin-top:10px;background:#070d2b;border:1px solid #1e2d5a;border-radius:12px;padding:12px;display:none"><div style="font-size:11px;font-weight:700">Screener Results</div><div id="screenerResults" style="max-height:200px;overflow:auto;margin-top:8px"></div></div>
        </div>
      </div>
      <div style="background:#121a33;border:1px solid #1e2d5a;border-radius:12px;padding:12px"><div style="display:flex;justify-content:space-between"><h3 style="margin:0;font-size:11px">📊 Indices + Global</h3><span style="font-size:9px;color:#00ff88">● LIVE</span></div><div id="indices" style="margin-top:10px">Loading...</div></div>
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
    document.getElementById("stockName").innerHTML=symbol+" • "+(symbol.endsWith(".BO")?"BSE":"NSE")+" "+capBadge(cap)+" <span style="color:#7C8DB0">• "+new Date().toLocaleTimeString("en-IN")+"</span>";
    setText("stockPrice",money(data.price));
    const ch=document.getElementById("change");ch.textContent=percent(data.change)+" ("+percent(data.changePct)+")";ch.style.background=data.change>=0?"rgba(0,255,136,.15)":"rgba(255,68,68,.15)";ch.style.color=data.change>=0?"#00ff88":"#ff4444";
    setText("dayHigh",money(data.high));setText("dayLow",money(data.low));setText("dayVol",Number.isFinite(data.vol)?(data.vol/1e6).toFixed(2)+"M":"--");setText("w52",money(data.low52)+" / "+money(data.high52));
    setText("rsiValue",Number.isFinite(data.rsi)?data.rsi.toFixed(1):"--");document.getElementById("rsiBar").style.width=Number.isFinite(data.rsi)?data.rsi+"%":"0%";
    setText("sma20",money(data.sma20));setText("sma50",money(data.sma50));setText("sma200",money(data.sma200));setText("smaStatus",data.sma20!=null&&data.sma50!=null?(data.sma20>data.sma50?"Golden Cross":"Death Cross"):"Not enough history");
    setText("peValue","P/E "+(Number.isFinite(data.fund.pe)?data.fund.pe.toFixed(2):"--"));setText("mcapValue","M-Cap "+formatCompactNumber(data.fund.mcap));setText("betaValue","Beta "+(Number.isFinite(data.fund.beta)?data.fund.beta.toFixed(2):"--"));
    setText("divValue","Div "+(Number.isFinite(data.fund.div)?data.fund.div.toFixed(2)+"%":"--"));setText("profitValue","Profit "+(Number.isFinite(data.fund.pm)?data.fund.pm.toFixed(1)+"%":"--"));setText("yearValue","Year "+(Number.isFinite(data.yearChange)?percent(data.yearChange):"--"));
    setText("f_pe",Number.isFinite(data.fund.pe)?data.fund.pe.toFixed(2):"--");setText("f_mcap",formatCompactNumber(data.fund.mcap));setText("f_div",Number.isFinite(data.fund.div)?data.fund.div.toFixed(2)+"%":"--");setText("f_beta",Number.isFinite(data.fund.beta)?data.fund.beta.toFixed(2):"--");setText("f_pm",Number.isFinite(data.fund.pm)?data.fund.pm.toFixed(1)+"%":"--");
    setText("t_rsi",Number.isFinite(data.rsi)?data.rsi.toFixed(1):"--");setText("t_sma20",money(data.sma20));setText("t_sma50",money(data.sma50));setText("t_sma200",money(data.sma200));
    const ai=getAISignal(data.rsi,data.sma20,data.sma50);setText("aiSignal",ai.t);setText("aiDesc",ai.t);setText("t_signal",ai.t);document.getElementById("aiSignal").style.color=ai.c;document.getElementById("t_signal").style.color=ai.c;
    renderChart(data);
    try{ const news=await getNews(symbol); renderNews(news); }catch{ renderNews([]); }
  }catch(error){
    setText("stockPrice","₹--");setText("change","DATA UNAVAILABLE");document.getElementById("change").style.color="#ffcc00";document.getElementById("change").style.background="rgba(255,204,0,.12)";setText("aiSignal","UNAVAILABLE");setText("aiDesc","No live quote received");document.getElementById("newsBox").innerHTML="<div style='padding:8px;background:#0e1429;border-radius:6px;color:#ffcc00'>Live market data is unavailable right now. No estimated or fabricated value is shown.</div>";renderChart(null);console.warn("[StockSense]",error);
  }
}
function renderChart(data){
  const container=document.getElementById("chart");
  if(chartResizeObserver){try{chartResizeObserver.disconnect();}catch{}chartResizeObserver=null;}
  container.innerHTML="";
  if(currentChart){try{currentChart.remove();}catch{}currentChart=null;}
  if(!data){container.innerHTML="<div style='height:100%;display:flex;align-items:center;justify-content:center;color:#ffcc00;font-size:11px'>Chart unavailable without live market data.</div>";return;}
  currentChart=createChart(container,{width:container.clientWidth,height:360,layout:{background:{color:"#070d2b"},textColor:"#7C8DB0"},grid:{vertLines:{color:"#17254a"},horzLines:{color:"#17254a"}},rightPriceScale:{borderColor:"#1e2d5a"},timeScale:{borderColor:"#1e2d5a",timeVisible:true}});
  const series=currentChart.addSeries(CandlestickSeries,{upColor:"#22c55e",downColor:"#ef4444",borderVisible:false,wickUpColor:"#22c55e",wickDownColor:"#ef4444"});
  const candles=[];data.timestamps.forEach((ts,i)=>{const o=data.opens[i],h=data.highs[i],l=data.lows[i],c=data.closes[i];if([o,h,l,c].every(Number.isFinite))candles.push({time:ts,open:o,high:h,low:l,close:c});});series.setData(candles);
  const vol=currentChart.addSeries(HistogramSeries,{priceFormat:{type:"volume"},priceScaleId:""});vol.priceScale().applyOptions({scaleMargins:{top:.8,bottom:0}});vol.setData(candles.map((c,i)=>({time:c.time,value:Number(data.volumes[i])||0})));
  currentChart.timeScale().fitContent();
  chartResizeObserver=new ResizeObserver(()=>{if(currentChart)currentChart.applyOptions({width:Math.max(320,container.clientWidth)});});chartResizeObserver.observe(container);
}
async function loadIndices(){
  const syms=[["^NSEI","NIFTY 50"],["^NSEBANK","BANK NIFTY"],["^BSESN","SENSEX"],["^CNXIT","NIFTY IT"]];
  const values=await Promise.all(syms.map(async([s,n])=>{try{const q=await getQuote(s);return {n,q,pct:(q.price-q.prev)/q.prev*100};}catch{return {n,q:null,pct:null};}}));
  document.getElementById("indices").innerHTML=values.map(x=>x.q?`<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #1a274a"><div><div style="font-size:11px;font-weight:600">${x.n}</div><div style="font-size:9px;color:#7C8DB0">LIVE</div></div><div style="text-align:right"><div style="font-size:11px;font-weight:700">${x.q.price.toFixed(2)}</div><div style="font-size:9px;color:${x.pct>=0?"#00ff88":"#ff4444"}">${percent(x.pct)}</div></div></div>`:`<div style="padding:10px 0;border-bottom:1px solid #1a274a"><div style="font-size:11px;font-weight:600">${x.n}</div><div style="font-size:9px;color:#ffcc00">Live data unavailable</div></div>`).join("")+`<div style="margin-top:10px;font-size:9px;color:#7C8DB0;text-align:center">IST ${new Date().toLocaleTimeString("en-IN")}</div>`;
}
async function runScreener(type){
  const box=document.getElementById("screenerBox"),res=document.getElementById("screenerResults");box.style.display="block";res.innerHTML="Scanning live data...";
  const values=await Promise.all(TICKERS.slice(0,30).map(async t=>{try{const q=await getQuote(t+".NS");const rsi=calcRSIForScreen(q.closes);return {symbol:t,nse:t+".NS",price:q.price,pct:(q.price-q.prev)/q.prev*100,rsi};}catch{return null;}}));
  const filtered=values.filter(Boolean).filter(r=>type==="BUY"?r.rsi<45:r.rsi<35).sort((a,b)=>a.rsi-b.rsi);
  res.innerHTML=`<div style="color:#00ff88;font-size:11px">${filtered.length} FOUND</div>`+filtered.map(s=>`<div style="display:flex;justify-content:space-between;padding:8px;background:#0e1429;margin:4px 0;border-radius:6px;cursor:pointer" data-screen="${s.nse}"><span><b>${s.symbol}</b> RSI ${s.rsi.toFixed(1)}</span><span style="color:${s.pct>=0?"#00ff88":"#ff4444"}">${money(s.price)} ${percent(s.pct)}</span></div>`).join("");
  res.querySelectorAll("[data-screen]").forEach(x=>x.onclick=()=>loadStockGlobal(x.dataset.screen));
}
function calcRSIForScreen(c){if(c.length<15)return 50;let g=0,l=0;for(let i=c.length-14;i<c.length;i++){const d=c[i]-c[i-1];if(d>0)g+=d;else l-=d;}return l===0?100:100-(100/(1+g/l));}
function setupScreener(){document.getElementById("scanBuy").onclick=()=>runScreener("BUY");document.getElementById("scanOversold").onclick=()=>runScreener("OVERSOLD");}
function loadStockGlobal(symbol){loadStock(symbol);document.getElementById("searchResults").style.display="none";}
window.loadStockGlobal=loadStockGlobal;
async function init(){
  ensureUI();setupSearch();setupWatchlistControls();setupPortfolio();setupScreener();loadPortfolio();
  await Promise.all([loadStock(currentSymbol),renderWatchlist(),loadIndices()]);
  setInterval(()=>{const h=new Date().getHours(),m=new Date().getMinutes();setText("marketStatus",(h>9&&h<15||(h===9&&m>=15)||(h===15&&m<30)?"🟢 OPEN ":"🔴 CLOSED ")+new Date().toLocaleTimeString("en-IN"));},1000);
}
init();
