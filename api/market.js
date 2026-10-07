const HOSTS=["query1.finance.yahoo.com","query2.finance.yahoo.com"];
const cache=new Map();
const CACHE_MS=30000;
const inFlight=new Map();

function headers(){
  return {
    "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
    "Accept":"application/json,text/plain,*/*",
    "Accept-Language":"en-US,en;q=0.9"
  };
}

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

async function fetchChart(symbol,range){
  const key=symbol+"|"+range;
  const cached=cache.get(key);
  if(cached && Date.now()-cached.time<CACHE_MS) return cached.data;
  if(inFlight.has(key)) return inFlight.get(key);

  const promise=(async()=>{
    let lastError=null;
    for(const host of HOSTS){
      try{
        const url="https://"+host+"/v8/finance/chart/"+encodeURIComponent(symbol)+"?interval=1d&range="+encodeURIComponent(range)+"&events=history";
        const response=await fetch(url,{headers:headers(),cache:"no-store"});
        const text=await response.text();
        if(!response.ok) throw new Error("Yahoo "+response.status);
        const json=JSON.parse(text);
        const result=json?.chart?.result?.[0];
        const meta=result?.meta||{};
        const quote=result?.indicators?.quote?.[0]||{};
        const closes=(quote.close||[]).filter(Number.isFinite);
        const price=Number.isFinite(meta.regularMarketPrice)?meta.regularMarketPrice:closes[closes.length-1];
        const prev=Number.isFinite(meta.previousClose)?meta.previousClose:(closes.length>=2?closes[closes.length-2]:null);
        if(!Number.isFinite(price)||!Number.isFinite(prev)||prev===0) throw new Error("Incomplete Yahoo data");
        const data={
          symbol:String(symbol).toUpperCase(),
          price,prev,change:price-prev,changePct:(price-prev)/prev*100,
          closes,timestamps:result.timestamp||[],
          opens:quote.open||[],highs:quote.high||[],lows:quote.low||[],volumes:quote.volume||[],
          high:Number.isFinite(meta.regularMarketDayHigh)?meta.regularMarketDayHigh:(quote.high||[]).filter(Number.isFinite).slice(-1)[0]??null,
          low:Number.isFinite(meta.regularMarketDayLow)?meta.regularMarketDayLow:(quote.low||[]).filter(Number.isFinite).slice(-1)[0]??null,
          vol:Number.isFinite(meta.regularMarketVolume)?meta.regularMarketVolume:(quote.volume||[]).filter(Number.isFinite).slice(-1)[0]??null,
          high52:Number.isFinite(meta.fiftyTwoWeekHigh)?meta.fiftyTwoWeekHigh:(closes.length?Math.max(...closes):null),
          low52:Number.isFinite(meta.fiftyTwoWeekLow)?meta.fiftyTwoWeekLow:(closes.length?Math.min(...closes):null)
        };
        cache.set(key,{time:Date.now(),data});
        return data;
      }catch(error){lastError=error;await sleep(120);}
    }
    throw lastError||new Error("Yahoo unavailable");
  })();
  inFlight.set(key,promise);
  try{return await promise;}finally{inFlight.delete(key);}
}

export default async function handler(req,res){
  const raw=String(req.query?.symbols||"");
  const range=String(req.query?.range||"5d");
  const allowedRanges=new Set(["5d","1mo","3mo","6mo","1y"]);
  if(!raw) return res.status(400).json({error:"Missing symbols"});
  if(!allowedRanges.has(range)) return res.status(400).json({error:"Invalid range"});

  const symbols=[...new Set(raw.split(",").map(s=>s.trim().toUpperCase()).filter(s=>/^[A-Z0-9^=_-]+\.(NS|BO)$/.test(s)||/^[A-Z0-9^=_-]+$/.test(s)))].slice(0,40);
  if(!symbols.length) return res.status(400).json({error:"No valid symbols"});

  const quotes=[];
  let cursor=0;
  const worker=async()=>{
    while(cursor<symbols.length){
      const symbol=symbols[cursor++];
      try{
        const q=await fetchChart(symbol,range);
        quotes.push(q);
      }catch{}
      if(cursor<symbols.length) await sleep(180);
    }
  };
  await Promise.all([worker(),worker()]);
  res.setHeader("Content-Type","application/json");
  res.setHeader("Cache-Control","s-maxage=30, stale-while-revalidate=120");
  return res.status(200).json({quotes});
}
