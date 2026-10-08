const PRIMARY="https://yfin-h.tigzig.com/v1/get-all-prices/";
const YAHOO_HOSTS=["query1.finance.yahoo.com","query2.finance.yahoo.com"];
const cache=new Map();
const inFlight=new Map();
const CACHE_MS=30000;

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function isoDate(d){return d.toISOString().slice(0,10);}
function daysForRange(range){return ({5d:10,1mo:45,3mo:120,6mo:220,1y:400}[range]||10);}
async function getJson(url,options={}){
  const response=await fetch(url,{...options,cache:"no-store"});
  const body=await response.text();
  if(!response.ok) throw new Error("Provider "+response.status);
  return JSON.parse(body);
}
function normalizeBars(raw,symbol){
  const rows=[];
  for(const [date,day] of Object.entries(raw||{})){
    const item=day?.[symbol];
    if(!item) continue;
    const close=Number(item.Close),open=Number(item.Open),high=Number(item.High),low=Number(item.Low),volume=Number(item.Volume);
    if(!Number.isFinite(close)) continue;
    rows.push({date,open:Number.isFinite(open)?open:null,high:Number.isFinite(high)?high:null,low:Number.isFinite(low)?low:null,close,volume:Number.isFinite(volume)?volume:null});
  }
  rows.sort((a,b)=>a.date.localeCompare(b.date));
  return rows;
}
async function primary(symbol,range){
  const end=new Date(),start=new Date(end.getTime()-daysForRange(range)*86400000);
  const url=PRIMARY+"?tickers="+encodeURIComponent(symbol)+"&start_date="+isoDate(start)+"&end_date="+isoDate(end)+"&format=json";
  const json=await getJson(url);
  const bars=normalizeBars(json?.[symbol],symbol);
  if(bars.length<2) throw new Error("Primary provider returned insufficient history");
  const last=bars[bars.length-1],prev=bars[bars.length-2];
  const closes=bars.map(x=>x.close);
  return {
    symbol,price:last.close,prev:prev.close,change:last.close-prev.close,
    changePct:(last.close-prev.close)/prev.close*100,
    closes,timestamps:bars.map(x=>Math.floor(Date.parse(x.date+"T00:00:00Z")/1000)),
    opens:bars.map(x=>x.open),highs:bars.map(x=>x.high),lows:bars.map(x=>x.low),volumes:bars.map(x=>x.volume),
    high:last.high,low:last.low,vol:last.volume,
    high52:Math.max(...closes),low52:Math.min(...closes),provider:"yfin-h"
  };
}
async function yahoo(symbol,range){
  let lastError=null;
  for(const host of YAHOO_HOSTS){
    try{
      const url="https://"+host+"/v8/finance/chart/"+encodeURIComponent(symbol)+"?interval=1d&range="+encodeURIComponent(range)+"&events=history";
      const json=await getJson(url);
      const result=json?.chart?.result?.[0],meta=result?.meta||{},quote=result?.indicators?.quote?.[0]||{};
      const closes=(quote.close||[]).filter(Number.isFinite);
      if(closes.length<2) throw new Error("Yahoo insufficient history");
      const price=Number.isFinite(meta.regularMarketPrice)?meta.regularMarketPrice:closes[closes.length-1];
      const prev=Number.isFinite(meta.previousClose)?meta.previousClose:closes[closes.length-2];
      return {
        symbol,price,prev,change:price-prev,changePct:(price-prev)/prev*100,
        closes,timestamps:result.timestamp||[],opens:quote.open||[],highs:quote.high||[],lows:quote.low||[],volumes:quote.volume||[],
        high:Number.isFinite(meta.regularMarketDayHigh)?meta.regularMarketDayHigh:(quote.high||[]).filter(Number.isFinite).slice(-1)[0]??null,
        low:Number.isFinite(meta.regularMarketDayLow)?meta.regularMarketDayLow:(quote.low||[]).filter(Number.isFinite).slice(-1)[0]??null,
        vol:Number.isFinite(meta.regularMarketVolume)?meta.regularMarketVolume:(quote.volume||[]).filter(Number.isFinite).slice(-1)[0]??null,
        high52:Number.isFinite(meta.fiftyTwoWeekHigh)?meta.fiftyTwoWeekHigh:Math.max(...closes),
        low52:Number.isFinite(meta.fiftyTwoWeekLow)?meta.fiftyTwoWeekLow:Math.min(...closes),provider:"yahoo"
      };
    }catch(e){lastError=e;await sleep(150);}
  }
  throw lastError||new Error("No market provider available");
}
async function load(symbol,range){
  const key=symbol+"|"+range;
  const cached=cache.get(key);
  if(cached&&Date.now()-cached.time<CACHE_MS)return cached.data;
  if(inFlight.has(key))return inFlight.get(key);
  const promise=(async()=>{
    try{return await primary(symbol,range);}
    catch(primaryError){
      try{return await yahoo(symbol,range);}
      catch(yahooError){throw new Error("Market providers unavailable");}
    }
  })();
  inFlight.set(key,promise);
  try{
    const data=await promise;cache.set(key,{time:Date.now(),data});return data;
  }finally{inFlight.delete(key);}
}
export default async function handler(req,res){
  const raw=String(req.query?.symbols||"");
  const range=String(req.query?.range||"5d");
  if(!raw)return res.status(400).json({error:"Missing symbols"});
  if(!["5d","1mo","3mo","6mo","1y"].includes(range))return res.status(400).json({error:"Invalid range"});
  const symbols=[...new Set(raw.split(",").map(s=>s.trim().toUpperCase()).filter(s=>/^[A-Z0-9^=_-]+\.(NS|BO)$/.test(s)||/^[A-Z0-9^=_-]+$/.test(s)))].slice(0,25);
  if(!symbols.length)return res.status(400).json({error:"No valid symbols"});
  const quotes=[];
  let cursor=0;
  const worker=async()=>{while(cursor<symbols.length){const symbol=symbols[cursor++];try{quotes.push(await load(symbol,range));}catch{}await sleep(50);}};
  await Promise.all([worker(),worker()]);
  res.setHeader("Content-Type","application/json");
  res.setHeader("Cache-Control","s-maxage=30, stale-while-revalidate=120");
  return res.status(200).json({quotes});
}
