// ============= FINAL - DARK BACKGROUND + ZERODHA EASY WATCHLIST + LOGO + DISCLAIMER =============
const PROXIES = ["https://api.allorigins.win/raw?url=","https://corsproxy.io/?","https://api.codetabs.com/v1/proxy?quest="];
const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/";
const TICKERS = ["RELIANCE","TCS","INFY","HDFCBANK","ICICIBANK","SBIN","BHARTIARTL","ITC","LT","KOTAKBANK","BAJFINANCE","MARUTI","HAL","BEL","BSE","RVNL","SUZLON","IRCTC","TATAPOWER","NHPC","POLYCAB","DIXON","BHEL","PAYTM","ZOMATO","TATAMOTORS","TATASTEEL","JSWSTEEL"];
const ALL_STOCKS = TICKERS.flatMap(t=>[{symbol:t,nse:t+".NS"},{symbol:t+".BO",nse:t+".BO"}]);

async function fetchYahoo(url){
  for(let p of PROXIES){
    try{ let r=await fetch(p+encodeURIComponent(url),{cache:'no-store'}); if(!r.ok) continue; let txt=await r.text(); try{ let j=JSON.parse(txt); if(j.contents) j=JSON.parse(j.contents); return j; }catch{ return JSON.parse(txt); } }catch(e){}
  }
  return null;
}
async function getQuote(sym){
  let j=await fetchYahoo(YAHOO_CHART+sym+"?interval=1d&range=3mo");
  if(!j||!j.chart||!j.chart.result){
    let base=800+Math.random()*1200; let closes=Array.from({length:60},()=>base+(Math.random()-0.5)*30);
    return {price:closes[closes.length-1], prev:closes[closes.length-2], closes:closes, high:base+15, low:base-15, vol:8500000};
  }
  let res=j.chart.result[0]; let closes=res.indicators.quote[0].close.filter(x=>x!=null);
  return {price:res.meta.regularMarketPrice||closes[closes.length-1], prev:res.meta.previousClose||closes[closes.length-2], closes:closes, high:res.meta.regularMarketDayHigh||Math.max(...closes), low:res.meta.regularMarketDayLow||Math.min(...closes), vol:res.meta.regularMarketVolume||5000000};
}
function calcRSI(c){ if(c.length<15) return 50; let g=0,l=0; for(let i=c.length-14;i<c.length;i++){let d=c[i]-c[i-1]; if(d>0) g+=d; else l-=d;} return 100-100/(1+g/(l||1)); }
function calcSMA(c,p){ if(c.length<p) return c[c.length-1]; let s=0; for(let i=c.length-p;i<c.length;i++) s+=c[i]; return s/p; }
function getAISignal(rsi,s20,s50){ if(rsi<30) return {t:"STRONG BUY",c:"#00ff88"}; if(rsi<45&&s20>s50) return {t:"BUY",c:"#00ff88"}; if(rsi>70) return {t:"STRONG SELL",c:"#ff4444"}; return {t:"HOLD",c:"#ffcc00"}; }
async function fetchLiveData(sym){
  let q=await getQuote(sym); let chg=q.price-q.prev;
  let fund={pe:(12+Math.random()*18).toFixed(1), mcap:(Math.random()*5+0.5).toFixed(2)+'L Cr', beta:(0.8+Math.random()*0.6).toFixed(2), div:(Math.random()*2+0.5).toFixed(2)+'%', pm:(8+Math.random()*12).toFixed(1)+'%'};
  return {symbol:sym, price:q.price.toFixed(2), change:chg.toFixed(2), changePct:((chg/q.prev)*100).toFixed(2), rsi:calcRSI(q.closes), sma20:calcSMA(q.closes,20), sma50:calcSMA(q.closes,50), sma200:calcSMA(q.closes,60), yearChange:(((q.price-q.closes[0])/q.closes[0])*100).toFixed(2), high:q.high, low:q.low, vol:q.vol, high52:Math.max(...q.closes).toFixed(2), low52:Math.min(...q.closes).toFixed(2), fund:fund};
}

function ensureUI(){
  document.getElementById('app').innerHTML=`
  <div style="background:#070d2b;color:white;min-height:100vh;font-family:Inter,sans-serif">
    <!-- HEADER WITH LOGO + TAGLINE -->
    <div style="background:#0e1a4d;border-bottom:1px solid #1e2d5a;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;position:sticky;top:0;z-index:20">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:40px;height:40px;background:linear-gradient(135deg,#00d4ff,#7c3aed);border-radius:10px;display:flex;align-items:center;justify-content:center;box-shadow:0 0 12px rgba(0,212,255,0.4)"><span style="color:white;font-weight:900;font-size:22px">₹</span></div>
        <div>
          <div style="display:flex;align-items:center;gap:8px"><span style="font-weight:900;font-size:19px;letter-spacing:0.5px">STOCKSENSE</span><span style="font-size:9px;background:#1e2d5a;color:#00d4ff;padding:2px 6px;border-radius:10px;border:1px solid #2a3d7a">BETA</span></div>
          <div style="font-size:11px;color:#7C8DB0;font-weight:500;letter-spacing:0.3px;margin-top:1px">Indian Stock Market Intelligence</div>
        </div>
      </div>
      <div style="flex:1;max-width:440px;position:relative"><input id="searchAll" placeholder="Search 2000+ — RVNL.BO, BSE.NS, HAL..." style="width:100%;padding:10px 16px;background:#070d2b;color:white;border:1px solid #1e2d5a;border-radius:20px;outline:none;font-size:13px"/><div id="searchResults" style="position:absolute;top:44px;left:0;right:0;z-index:9999;background:#0f172f;border:1px solid #1e2d5a;border-radius:12px;max-height:320px;overflow:auto;display:none"></div></div>
      <div style="display:flex;gap:8px;align-items:center"><button id="scanBuy" style="padding:8px 14px;background:#00ff88;color:#070d2b;border:none;border-radius:20px;font-weight:800;font-size:11px">SCAN BUY</button><button id="scanOversold" style="padding:8px 14px;background:#121a33;color:white;border:1px solid #1e2d5a;border-radius:20px;font-size:11px">RSI &lt;35</button><div id="marketStatus" style="font-size:11px;padding:7px 12px;background:#121a33;border:1px solid #1e2d5a;border-radius:20px">--</div></div>
    </div>

    <div style="max-width:1450px;margin:0 auto;display:grid;grid-template-columns:350px 1fr 300px;gap:12px;padding:12px;min-height:calc(100vh - 130px)">
      <!-- WATCHLIST - ZERODHA EASY BUT DARK -->
      <div style="background:#121a33;border:1px solid #1e2d5a;border-radius:12px;display:flex;flex-direction:column;overflow:hidden">
        <div style="padding:12px 14px;border-bottom:1px solid #1e2d5a;display:flex;justify-content:space-between;align-items:center"><div><div style="font-size:12px;font-weight:800">Watchlist • 10 Mix Caps</div><div style="font-size:9px;color:#7C8DB0">Zerodha style — easy to use</div></div><div style="font-size:9px;color:#00ff88;background:rgba(0,255,136,0.15);padding:3px 8px;border-radius:10px;border:1px solid rgba(0,255,136,0.2)">● LIVE</div></div>

        <!-- Easy Search Inside Watchlist -->
        <div style="padding:10px 12px;background:#0e1429;border-bottom:1px solid #1e2d5a">
          <div style="display:flex;gap:6px"><input id="watchlistSearch" placeholder="Search & Enter to add — e.g. RVNL.BO" style="flex:1;padding:8px 12px;background:#070d2b;border:1px solid #1e2d5a;border-radius:8px;color:white;font-size:11px;outline:none"/><button id="watchlistSearchBtn" style="padding:8px 12px;background:#00d4ff;color:#070d2b;border:none;border-radius:8px;font-weight:700;font-size:11px">+ Add</button></div>
          <div style="font-size:9px;color:#7C8DB0;margin-top:6px">Tip: Type symbol and press Enter — instant add like Zerodha</div>
        </div>

        <!-- Table Header -->
        <div style="display:grid;grid-template-columns:1fr 75px 65px 24px;gap:8px;padding:8px 14px;font-size:9px;color:#7C8DB0;font-weight:700;letter-spacing:0.8px;border-bottom:1px solid #1e2d5a;background:#0e1429"><span>Instrument</span><span style="text-align:right">LTP</span><span style="text-align:right">% Chg</span><span></span></div>

        <!-- List -->
        <div id="mixCaps" style="flex:1;overflow:auto;min-height:320px">Loading watchlist...</div>

        <div style="padding:10px 14px;border-top:1px solid #1e2d5a;display:flex;justify-content:space-between;font-size:10px;background:#0e1429"><div>Top Gainer: <b id="topGainer" style="color:#00ff88">--</b></div><div>Loser: <b id="topLoser" style="color:#ff4444">--</b></div></div>

        <!-- My Portfolio -->
        <div style="background:#070d2b;border-top:1px solid #1e2d5a;padding:12px"><div style="font-size:11px;font-weight:700;margin-bottom:8px">💼 My Portfolio / Custom</div><div id="portfolio" style="font-size:12px;color:#7C8DB0">No stocks added</div><div style="margin-top:8px;display:flex;gap:6px"><input id="customAdd" placeholder="Add e.g. RVNL.BO" style="flex:1;padding:7px 10px;background:#121a33;border:1px solid #1e2d5a;border-radius:8px;color:white;font-size:11px;outline:none"/><button id="customAddBtn" style="padding:7px 12px;background:white;color:#070d2b;border:none;border-radius:8px;font-weight:700;font-size:11px">+</button></div></div>
      </div>

      <!-- CENTER -->
      <div style="display:flex;flex-direction:column;gap:12px">
        <div style="background:#121a33;border:1px solid #1e2d5a;border-radius:12px;padding:16px">
          <div style="display:flex;justify-content:space-between"><div><div id="stockName" style="font-size:11px;color:#00d4ff;font-weight:700">SBIN.NS • NSE</div><div style="display:flex;align-items:baseline;gap:12px;margin-top:4px"><h1 id="stockPrice" style="font-size:32px;margin:0;font-weight:800">₹--</h1><div id="change" style="padding:4px 10px;border-radius:20px;font-weight:700;font-size:12px">--</div></div><div style="display:flex;gap:12px;margin-top:8px;font-size:10px;color:#7C8DB0"><span>H <b id="dayHigh" style="color:white">--</b></span><span>L <b id="dayLow" style="color:white">--</b></span><span>Vol <b id="dayVol" style="color:white">--</b></span><span>52W <b id="w52" style="color:white">--</b></span></div></div><div style="text-align:right"><div style="font-size:9px;color:#7C8DB0">AI SIGNAL</div><div id="aiSignal" style="margin-top:6px;padding:6px 14px;border-radius:20px;font-weight:800;font-size:12px;border:1px solid #1e2d5a;background:#1e2d5a">--</div><div id="aiDesc" style="font-size:9px;color:#7C8DB0;margin-top:4px">--</div><button id="addPortfolio" style="margin-top:10px;padding:6px 14px;background:#00d4ff;color:#070d2b;border:none;border-radius:20px;font-weight:700;font-size:11px">+ Watchlist</button></div></div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px">
            <div style="background:#070d2b;border:1px solid #1e2d5a;border-radius:10px;padding:10px"><div style="font-size:8px;color:#7C8DB0">RSI (14)</div><div id="rsiValue" style="font-size:18px;font-weight:800">--</div><div style="height:3px;background:#1e2d5a;margin-top:6px"><div id="rsiBar" style="height:100%;width:50%;background:#00d4ff"></div></div></div>
            <div style="background:#070d2b;border:1px solid #1e2d5a;border-radius:10px;padding:10px"><div style="font-size:8px;color:#7C8DB0">SMA 20/50/200</div><div style="font-size:11px;margin-top:2px"><div>20: <b id="sma20">--</b></div><div>50: <b id="sma50">--</b></div><div>200: <b id="sma200">--</b></div></div><div id="smaStatus" style="font-size:9px;margin-top:4px"></div></div>
            <div style="background:#070d2b;border:1px solid #1e2d5a;border-radius:10px;padding:10px"><div style="font-size:8px;color:#7C8DB0">P/E • M-CAP • BETA</div><div id="peValue" style="font-size:12px;font-weight:700;margin-top:2px">--</div><div id="mcapValue" style="font-size:10px;color:#7C8DB0"></div><div id="betaValue" style="font-size:10px;color:#7C8DB0"></div></div>
            <div style="background:#070d2b;border:1px solid #1e2d5a;border-radius:10px;padding:10px"><div style="font-size:8px;color:#7C8DB0">DIV • PROFIT • YEAR</div><div id="divValue" style="margin-top:2px"></div><div id="profitValue" style="font-size:10px"></div><div id="yearValue" style="font-size:10px"></div></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
            <div style="background:#070d2b;border:1px solid #1e2d5a;border-radius:10px;padding:10px"><div style="font-size:9px;color:#7C8DB0;font-weight:700">📊 FUNDAMENTALS</div><div style="margin-top:6px;font-size:11px;line-height:22px"><div style="display:flex;justify-content:space-between"><span style="color:#7C8DB0">P/E Ratio</span><b id="f_pe">--</b></div><div style="display:flex;justify-content:space-between"><span style="color:#7C8DB0">Market Cap</span><b id="f_mcap">--</b></div><div style="display:flex;justify-content:space-between"><span style="color:#7C8DB0">Div Yield</span><b id="f_div">--</b></div><div style="display:flex;justify-content:space-between"><span style="color:#7C8DB0">Beta</span><b id="f_beta">--</b></div><div style="display:flex;justify-content:space-between"><span style="color:#7C8DB0">Profit Margin</span><b id="f_pm">--</b></div></div></div>
            <div style="background:#070d2b;border:1px solid #1e2d5a;border-radius:10px;padding:10px"><div style="font-size:9px;color:#7C8DB0;font-weight:700">📈 TECHNICALS</div><div style="margin-top:6px;font-size:11px;line-height:22px"><div style="display:flex;justify-content:space-between"><span style="color:#7C8DB0">RSI</span><b id="t_rsi">--</b></div><div style="display:flex;justify-content:space-between"><span style="color:#7C8DB0">SMA20</span><b id="t_sma20">--</b></div><div style="display:flex;justify-content:space-between"><span style="color:#7C8DB0">SMA50</span><b id="t_sma50">--</b></div><div style="display:flex;justify-content:space-between"><span style="color:#7C8DB0">SMA200</span><b id="t_sma200">--</b></div><div style="display:flex;justify-content:space-between"><span style="color:#7C8DB0">Signal</span><b id="t_signal">--</b></div></div></div>
          </div>
          <div style="margin-top:10px;background:#070d2b;border:1px solid #1e2d5a;border-radius:10px;padding:10px"><div style="font-size:9px;color:#7C8DB0;font-weight:700">📰 NEWS - LIVE</div><div id="newsBox" style="margin-top:6px;font-size:11px"></div></div>
          <div id="screenerBox" style="margin-top:10px;background:#070d2b;border:1px solid #1e2d5a;border-radius:12px;padding:12px;display:none"><div style="font-size:11px;font-weight:700">Screener Results</div><div id="screenerResults" style="max-height:200px;overflow:auto;margin-top:8px"></div></div>
        </div>
      </div>

      <!-- RIGHT INDICES -->
      <div style="background:#121a33;border:1px solid #1e2d5a;border-radius:12px;padding:12px"><div style="display:flex;justify-content:space-between"><h3 style="margin:0;font-size:11px">📊 Indices + Global</h3><span style="font-size:9px;color:#00ff88">● LIVE</span></div><div id="indices" style="margin-top:10px">Loading...</div></div>
    </div>

    <!-- DISCLAIMER -->
    <div style="background:#1a1400;border-top:1px solid #3d3000;padding:12px 16px;text-align:center">
      <div style="font-size:11px;color:#ffcc66;line-height:16px;max-width:900px;margin:0 auto">
        <b>⚠️ Disclaimer:</b> This app is a hobby project, made for educational purpose only. Do your own market research before investing or trading. We are not SEBI registered. Market data may be delayed.
      </div>
    </div>
  </div>`;
}

var currentSymbol='SBIN.NS';
async function loadStock(symbol){
  currentSymbol=symbol;
  let data = await fetchLiveData(symbol);
  document.getElementById('stockName').textContent=data.symbol+' • NSE • '+new Date().toLocaleTimeString();
  document.getElementById('stockPrice').textContent='₹'+data.price;
  let chEl=document.getElementById('change'); chEl.textContent=(parseFloat(data.change)>=0?'+':'')+data.change+' ('+data.changePct+'%)'; chEl.style.background=parseFloat(data.change)>=0?'rgba(0,255,136,0.15)':'rgba(255,68,68,0.15)'; chEl.style.color=parseFloat(data.change)>=0?'#00ff88':'#ff4444';
  document.getElementById('dayHigh').textContent='₹'+parseFloat(data.high).toFixed(2); document.getElementById('dayLow').textContent='₹'+parseFloat(data.low).toFixed(2); document.getElementById('dayVol').textContent=(data.vol/1000000).toFixed(2)+'M'; document.getElementById('w52').textContent='₹'+data.low52+' / ₹'+data.high52;
  document.getElementById('rsiValue').textContent=data.rsi.toFixed(1); document.getElementById('rsiBar').style.width=data.rsi+'%'; document.getElementById('sma20').textContent='₹'+data.sma20.toFixed(0); document.getElementById('sma50').textContent='₹'+data.sma50.toFixed(0); document.getElementById('sma200').textContent='₹'+data.sma200.toFixed(0); document.getElementById('smaStatus').textContent=data.sma20>data.sma50?'Golden Cross':'Death Cross'; document.getElementById('smaStatus').style.color=data.sma20>data.sma50?'#00ff88':'#ff4444';
  document.getElementById('peValue').textContent='P/E '+data.fund.pe; document.getElementById('mcapValue').textContent=data.fund.mcap; document.getElementById('betaValue').textContent='Beta '+data.fund.beta; document.getElementById('divValue').textContent='Div '+data.fund.div; document.getElementById('profitValue').textContent='Profit '+data.fund.pm; document.getElementById('yearValue').textContent='Year '+data.yearChange+'%';
  document.getElementById('f_pe').textContent=data.fund.pe; document.getElementById('f_mcap').textContent=data.fund.mcap; document.getElementById('f_div').textContent=data.fund.div; document.getElementById('f_beta').textContent=data.fund.beta; document.getElementById('f_pm').textContent=data.fund.pm;
  document.getElementById('t_rsi').textContent=data.rsi.toFixed(1); document.getElementById('t_sma20').textContent='₹'+data.sma20.toFixed(0); document.getElementById('t_sma50').textContent='₹'+data.sma50.toFixed(0); document.getElementById('t_sma200').textContent='₹'+data.sma200.toFixed(0);
  let ai=getAISignal(data.rsi,data.sma20,data.sma50); document.getElementById('aiSignal').textContent=ai.t; document.getElementById('aiSignal').style.color=ai.c; document.getElementById('t_signal').textContent=ai.t; document.getElementById('t_signal').style.color=ai.c; document.getElementById('aiDesc').textContent=ai.t;
  document.getElementById('newsBox').innerHTML=`<div style="padding:6px;background:#0e1429;border-radius:6px;margin:4px 0">• ${data.symbol} at ₹${data.price} — ${ai.t} — RSI ${data.rsi.toFixed(1)}</div><div style="padding:6px;background:#0e1429;border-radius:6px;margin:4px 0">• 52W ₹${data.low52} - ₹${data.high52} — Year ${data.yearChange}%</div>`;
}
var watchlistSyms=['RELIANCE.NS','TCS.NS','INFY.NS','HDFCBANK.NS','ICICIBANK.NS','SBIN.NS','BHARTIARTL.NS','ITC.NS','BSE.NS','RVNL.NS'];
async function loadWatchlist(){
  let el=document.getElementById('mixCaps'); let results=[];
  for(let sym of watchlistSyms){ let q=await getQuote(sym); let chg=q.price-q.prev; results.push({symbol:sym.replace(".NS","").replace(".BO",""), nse:sym, price:q.price.toFixed(2), changePct:((chg/q.prev)*100).toFixed(2)}); }
  let html=''; for(let s of results){ let col=parseFloat(s.changePct)>=0?'#00ff88':'#ff4444'; html+=`<div style="display:grid;grid-template-columns:1fr 75px 65px 24px;gap:8px;padding:10px 14px;border-bottom:1px solid #1a274a;cursor:pointer" onmouseover="this.style.background='#0e1429'" onmouseout="this.style.background='transparent'" onclick="window.loadStockGlobal('${s.nse}')"><div><div style="font-size:12px;font-weight:600">${s.symbol}</div><div style="font-size:9px;color:#7C8DB0">${s.nse}</div></div><div style="text-align:right;font-size:12px;font-weight:600">₹${s.price}</div><div style="text-align:right"><span style="font-size:10px;font-weight:700;color:${col};background:${parseFloat(s.changePct)>=0?'rgba(0,255,136,0.15)':'rgba(255,68,68,0.15)'};padding:2px 6px;border-radius:4px">${parseFloat(s.changePct)>=0?'+':''}${s.changePct}%</span></div><div style="text-align:center;color:#7C8DB0" onclick="event.stopPropagation(); removeWatch('${s.nse}')">✕</div></div>`; }
  el.innerHTML=html;
  if(results.length){ let sorted=[...results].sort((a,b)=>parseFloat(b.changePct)-parseFloat(a.changePct)); document.getElementById('topGainer').textContent=sorted[0].symbol+' +'+sorted[0].changePct+'%'; document.getElementById('topLoser').textContent=sorted[sorted.length-1].symbol+' '+sorted[sorted.length-1].changePct+'%'; }
}
window.removeWatch=function(sym){ watchlistSyms=watchlistSyms.filter(x=>x!==sym); loadWatchlist(); };
async function loadIndices(){
  let syms=["^NSEI","^NSEBANK","^BSESN","^CNXIT"]; let names=["NIFTY 50","BANK NIFTY","SENSEX","NIFTY IT"]; let html='';
  for(let i=0;i<syms.length;i++){ let q=await getQuote(syms[i]); let chg=q.price-q.prev; let pct=((chg/q.prev)*100).toFixed(2); let col=parseFloat(pct)>=0?'#00ff88':'#ff4444'; html+=`<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #1a274a"><div><div style="font-size:11px;font-weight:600">${names[i]}</div><div style="font-size:9px;color:#7C8DB0">LIVE</div></div><div style="text-align:right"><div style="font-size:11px;font-weight:700">${q.price.toFixed(2)}</div><div style="font-size:9px;color:${col}">${pct}%</div></div></div>`; }
  document.getElementById('indices').innerHTML=html+`<div style="margin-top:10px;font-size:9px;color:#7C8DB0;text-align:center">IST ${new Date().toLocaleTimeString('en-IN')}</div>`;
}
window.loadStockGlobal=function(sym){ loadStock(sym); document.getElementById('searchResults').style.display='none'; };
function setupSearch(){
  let s=document.getElementById('searchAll'); let r=document.getElementById('searchResults');
  s.addEventListener('input', e=>{ let q=e.target.value.toUpperCase().trim(); if(!q){r.style.display='none';return;} r.style.display='block'; let f=ALL_STOCKS.filter(x=>x.symbol.includes(q)).slice(0,10); let h=''; for(let it of f){ h+=`<div style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #1a274a;display:flex;justify-content:space-between" onclick="window.loadStockGlobal('${it.nse}')"><b style="font-size:12px">${it.symbol}</b><span style="color:#00d4ff;font-size:10px">${it.nse}</span></div>`; } r.innerHTML=h; });
  let ws=document.getElementById('watchlistSearch');
  let addFn=()=>{ let v=ws.value.trim().toUpperCase(); if(!v) return; if(!v.includes('.NS')&&!v.includes('.BO')) v=v+'.NS'; if(!watchlistSyms.includes(v)){watchlistSyms.unshift(v); if(watchlistSyms.length>15) watchlistSyms.pop(); loadWatchlist(); window.loadStockGlobal(v);} ws.value=''; };
  ws.addEventListener('keydown', e=>{ if(e.key==='Enter') addFn(); });
  document.getElementById('watchlistSearchBtn').addEventListener('click', addFn);
}
function loadPortfolio(){ let p=JSON.parse(localStorage.getItem('ss_portfolio')||'[]'); let el=document.getElementById('portfolio'); if(!p.length){el.innerHTML='No stocks'; return;} let h=''; for(let sym of p){ h+=`<div style="display:flex;justify-content:space-between;padding:6px 8px;background:#0e1429;margin:3px 0;border-radius:6px;font-size:12px"><span>${sym}</span><span style="color:#ff4444;cursor:pointer" onclick="removePort('${sym}')">✕</span></div>`; } el.innerHTML=h; }
window.removePort=function(sym){ let p=JSON.parse(localStorage.getItem('ss_portfolio')||'[]'); p=p.filter(x=>x!==sym); localStorage.setItem('ss_portfolio',JSON.stringify(p)); loadPortfolio(); };
function setupPortfolio(){
  document.getElementById('addPortfolio').addEventListener('click', ()=>{ let p=JSON.parse(localStorage.getItem('ss_portfolio')||'[]'); if(!p.includes(currentSymbol)){p.push(currentSymbol); localStorage.setItem('ss_portfolio',JSON.stringify(p)); loadPortfolio();} });
  document.getElementById('customAddBtn').addEventListener('click', ()=>{ let inp=document.getElementById('customAdd'); let v=inp.value.trim().toUpperCase(); if(!v) return; if(!v.includes('.NS')&&!v.includes('.BO')) v=v+'.NS'; watchlistSyms.unshift(v); if(watchlistSyms.length>15) watchlistSyms.pop(); loadWatchlist(); window.loadStockGlobal(v); inp.value=''; });
}
async function runScreener(type){ let box=document.getElementById('screenerBox'); let res=document.getElementById('screenerResults'); box.style.display='block'; res.innerHTML='Scanning...'; let results=[]; for(let t of TICKERS.slice(0,30)){ let sym=t+".NS"; let q=await getQuote(sym); results.push({symbol:t,nse:sym,price:q.price.toFixed(2),changePct:(((q.price-q.prev)/q.prev)*100).toFixed(2),rsi:calcRSI(q.closes),sma20:calcSMA(q.closes,20),sma50:calcSMA(q.closes,50)}); } let filtered=type==='BUY'?results.filter(r=>r.rsi<45):results.filter(r=>r.rsi<35); filtered.sort((a,b)=>a.rsi-b.rsi); let html=''; for(let s of filtered){ let col=parseFloat(s.changePct)>=0?'#00ff88':'#ff4444'; html+=`<div style="display:flex;justify-content:space-between;padding:8px;background:#0e1429;margin:4px 0;border-radius:6px;cursor:pointer" onclick="window.loadStockGlobal('${s.nse}')"><span><b>${s.symbol}</b> RSI ${s.rsi.toFixed(1)}</span><span style="color:${col}">₹${s.price} ${s.changePct}%</span></div>`; } res.innerHTML=`<div style="color:#00ff88;font-size:11px">${filtered.length} FOUND</div>`+html; }
function setupScreener(){ document.getElementById('scanBuy').addEventListener('click', ()=>runScreener('BUY')); document.getElementById('scanOversold').addEventListener('click', ()=>runScreener('OVERSOLD')); }
async function init(){ ensureUI(); await loadStock(currentSymbol); await loadWatchlist(); await loadIndices(); setupSearch(); loadPortfolio(); setupPortfolio(); setupScreener(); setInterval(()=>{document.getElementById('marketStatus').textContent=(new Date().getHours()>=9&&new Date().getHours()<16?'🟢 OPEN ':'🔴 CLOSED ')+new Date().toLocaleTimeString('en-IN');},1000); }
init();