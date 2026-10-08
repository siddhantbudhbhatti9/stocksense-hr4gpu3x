const YAHOO_PROXY = "/api/yahoo?url=";
const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/";
const YAHOO_QUOTE = "https://query1.finance.yahoo.com/v7/finance/quote?symbols=";
const YAHOO_SEARCH = "https://query1.finance.yahoo.com/v1/finance/search?q=";

const quoteCache=new Map();
const quoteInFlight=new Map();
const fastQuoteInFlight=new Map();
const batchQuoteCache=new Map();
const batchQuoteInFlight=new Map();
const fundCache=new Map();
const fundFastCache=new Map();
const newsCache=new Map();

export async function getFastQuote(symbol){
  const key=String(symbol).toUpperCase();
  const cached=batchQuoteCache.get("fast:"+key);
  if(cached && Date.now()-cached.time<CACHE_MS) return cached.data;
  if(fastQuoteInFlight.has(key)) return fastQuoteInFlight.get(key);
  const promise=(async()=>{
    const response=await fetch("/api/market?symbols="+encodeURIComponent(key)+"&range=1y");
    if(!response.ok) throw new Error("Market data endpoint returned "+response.status);
    const json=await response.json();
    const q=json?.quotes?.find(item=>String(item?.symbol||"").toUpperCase()===key);
    if(!q) throw new Error("Live quote unavailable for "+symbol);
    const data={
      symbol:key,price:q.price,prev:q.prev,
      change:q.change,changePct:q.changePct,
      closes:q.closes||[],timestamps:q.timestamps||[],
      opens:q.opens||[],highs:q.highs||[],lows:q.lows||[],volumes:q.volumes||[],
      high:q.high,low:q.low,vol:q.vol,high52:q.high52,low52:q.low52
    };
    batchQuoteCache.set("fast:"+key,{time:Date.now(),data});
    return data;
  })();
  fastQuoteInFlight.set(key,promise);
  try{return await promise;}finally{fastQuoteInFlight.delete(key);}
}

export async function getTechnicalData(symbol){
  const key=String(symbol).toUpperCase();
  const cached=quoteCache.get("technical:"+key);
  if(cached && Date.now()-cached.time<CACHE_MS) return cached.data;
  const response=await fetch("/api/market?symbols="+encodeURIComponent(key)+"&range=1y");
  if(!response.ok) throw new Error("Market history endpoint returned "+response.status);
  const json=await response.json();
  const q=json?.quotes?.[0];
  if(!q || !Array.isArray(q.closes) || q.closes.length<20) throw new Error("Technical history unavailable for "+symbol);
  const data={closes:q.closes,timestamps:q.timestamps||[],opens:q.opens||[],highs:q.highs||[],lows:q.lows||[],volumes:q.volumes||[]};
  quoteCache.set("technical:"+key,{time:Date.now(),data});
  return data;
}
const CACHE_MS=30000;
const BATCH_CACHE_MS=30000;

async function fetchYahoo(url){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),6500);
  try{
    const response=await fetch(YAHOO_PROXY+encodeURIComponent(url),{signal:controller.signal});
    if(!response.ok)return null;
    const text=await response.text();
    const parsed=JSON.parse(text);
    return parsed?.contents ? JSON.parse(parsed.contents) : parsed;
  }catch{return null;}
  finally{clearTimeout(timer);}
}

export async function getQuote(symbol){
  const key=String(symbol).toUpperCase();
  const cached=quoteCache.get(key);
  if(cached && Date.now()-cached.time<CACHE_MS) return cached.data;
  if(quoteInFlight.has(key)) return quoteInFlight.get(key);
  const promise=(async()=>{
    const url=YAHOO_CHART+encodeURIComponent(symbol)+"?interval=1d&range=1y&events=history";
    const json=await fetchYahoo(url);
  const result=json?.chart?.result?.[0];
  const meta=result?.meta;
  const quote=result?.indicators?.quote?.[0];
  const closes=(quote?.close||[]).filter(Number.isFinite);
  if(!result || closes.length<2) throw new Error("Last closing price unavailable for "+symbol);
  // Use the latest completed daily close as the primary display price.
  // This keeps the app useful outside market hours and when Yahoo's live quote is unavailable.
  const price=closes[closes.length-1];
  const prev=closes[closes.length-2];
  if(!Number.isFinite(price)||!Number.isFinite(prev)||prev===0) throw new Error("Incomplete live market data for "+symbol);
  const data={
    symbol, price, prev, closes,
    timestamps:result.timestamp||[],
    opens:quote?.open||[], highs:quote?.high||[], lows:quote?.low||[], volumes:quote?.volume||[],
    high:(quote?.high||[]).filter(Number.isFinite).slice(-1)[0] ?? null,
    low:(quote?.low||[]).filter(Number.isFinite).slice(-1)[0] ?? null,
    vol:Number.isFinite(meta?.regularMarketVolume)?meta.regularMarketVolume:null,
    high52:Number.isFinite(meta?.fiftyTwoWeekHigh)?meta.fiftyTwoWeekHigh:Math.max(...closes),
    low52:Number.isFinite(meta?.fiftyTwoWeekLow)?meta.fiftyTwoWeekLow:Math.min(...closes)
  };
    quoteCache.set(key,{time:Date.now(),data});
    return data;
  })();
  quoteInFlight.set(key,promise);
  try{return await promise;}finally{quoteInFlight.delete(key);}
}

function normalizeBatchQuote(q){
  const price=Number.isFinite(q?.regularMarketPrice)?q.regularMarketPrice:null;
  const prev=Number.isFinite(q?.regularMarketPreviousClose)?q.regularMarketPreviousClose:null;
  if(!Number.isFinite(price)||!Number.isFinite(prev)||prev===0) return null;
  return {
    symbol:String(q.symbol||"").toUpperCase(),
    price,prev,
    change:price-prev,
    changePct:(price-prev)/prev*100,
    high:Number.isFinite(q.regularMarketDayHigh)?q.regularMarketDayHigh:null,
    low:Number.isFinite(q.regularMarketDayLow)?q.regularMarketDayLow:null,
    vol:Number.isFinite(q.regularMarketVolume)?q.regularMarketVolume:null,
    high52:Number.isFinite(q.fiftyTwoWeekHigh)?q.fiftyTwoWeekHigh:null,
    low52:Number.isFinite(q.fiftyTwoWeekLow)?q.fiftyTwoWeekLow:null
  };
}

export async function getQuotesBatch(symbols){
  const unique=[...new Set((symbols||[]).map(s=>String(s).toUpperCase()).filter(Boolean))];
  if(!unique.length) return new Map();
  const key=unique.slice().sort().join(",");
  const cached=batchQuoteCache.get(key);
  if(cached && Date.now()-cached.time<BATCH_CACHE_MS) return cached.data;
  if(batchQuoteInFlight.has(key)) return batchQuoteInFlight.get(key);

  const promise=(async()=>{
    const result=new Map();
    try{
      const response=await fetch("/api/market?symbols="+encodeURIComponent(unique.join(","))+"&range=5d");
      if(response.ok){
        const json=await response.json();
        for(const q of (json?.quotes||[])){
          if(q?.symbol && Number.isFinite(q.price) && Number.isFinite(q.prev) && q.prev!==0) result.set(String(q.symbol).toUpperCase(),q);
        }
      }
    }catch{}

    // The API handles provider fallbacks in one bounded batch. Retrying each
    // missing symbol here multiplied load when the batch endpoint was down.
    if(result.size) batchQuoteCache.set(key,{time:Date.now(),data:result});
    return result;
  })();

  batchQuoteInFlight.set(key,promise);
  try{return await promise;}finally{batchQuoteInFlight.delete(key);}
}

function rawValue(node){
  const v=node?.raw;
  return Number.isFinite(v)?v:null;
}

function pctValue(node){
  const v=rawValue(node);
  return Number.isFinite(v)?v*100:null;
}

async function getFundamentalsTimeseries(symbol, periodType="annual"){
  const baseTypes=[
    "TotalRevenue","EBITDA","OperatingIncome","NetIncome","DilutedEPS","BasicEPS","GrossProfit","OperatingExpense",
    "FreeCashFlow","CapitalExpenditure","TotalAssets","TotalDebt","StockholdersEquity","CashCashEquivalentsAndShortTermInvestments"
  ];
  const prefix=periodType==="quarterly"?"quarterly":"annual";
  const now=Math.floor(Date.now()/1000);
  const start=now-60*60*24*365*6;
  // Yahoo's fundamentals endpoint becomes unreliable when too many fields are packed
  // into one URL. Fetch small chunks and merge the result instead of losing the
  // whole statement because one oversized request failed.
  const chunks=[];
  for(let i=0;i<baseTypes.length;i+=4) chunks.push(baseTypes.slice(i,i+4));
  const merged=[];
  await Promise.all(chunks.map(async chunk=>{
    const types=chunk.map(k=>prefix+k);
    const url="https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/"+encodeURIComponent(symbol)+"?symbol="+encodeURIComponent(symbol)+"&type="+types.join(",")+"&period1="+start+"&period2="+now;
    try{
      const json=await fetchYahoo(url);
      const rows=json?.timeseries?.result||[];
      merged.push(...rows);
    }catch{}
  }));
  return merged;
}

async function getValuationTimeseries(symbol){
  const types=[
    "trailingMarketCap","trailingPeRatio","trailingPegRatio","trailingPsRatio","trailingPbRatio",
    "trailingEnterprisesValueEBITDARatio","trailingEnterprisesValueRevenueRatio"
  ];
  const now=Math.floor(Date.now()/1000);
  const start=now-60*60*24*365*2;
  const url="https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/"+encodeURIComponent(symbol)+"?symbol="+encodeURIComponent(symbol)+"&type="+types.join(",")+"&period1="+start+"&period2="+now;
  try{
    const json=await fetchYahoo(url);
    return json?.timeseries?.result||[];
  }catch{return [];}
}

function latestTimeseriesNumber(results, keys){
  for(const key of keys){
    const row=results.find(x=>Array.isArray(x?.[key])&&x[key].length);
    const item=row?.[key]?.[row[key].length-1];
    const value=rawValue(item?.reportedValue);
    if(Number.isFinite(value)) return {value,date:item?.asOfDate||null};
  }
  return {value:null,date:null};
}

function latestSeriesValue(results,key){
  for(const row of results||[]){
    const arr=row?.[key];
    if(Array.isArray(arr)&&arr.length){
      const item=arr[arr.length-1], value=rawValue(item?.reportedValue);
      if(Number.isFinite(value)) return {value,date:item?.asOfDate||null};
    }
  }
  return {value:null,date:null};
}
function buildFinancialRows(results,periodType){
  const prefix=periodType==="quarterly"?"quarterly":"annual", map=new Map();
  for(const row of results||[]){
    for(const [key,arr] of Object.entries(row||{})){
      if(!key.startsWith(prefix)||!Array.isArray(arr)) continue;
      const base=key.slice(prefix.length);
      const field={TotalRevenue:"revenue",EBITDA:"ebitda",NetIncome:"netIncome",DilutedEPS:"eps",BasicEPS:"eps",OperatingIncome:"operatingIncome",TotalAssets:"assets",TotalDebt:"debt",StockholdersEquity:"equity",CashCashEquivalentsAndShortTermInvestments:"cash"}[base];
      if(!field) continue;
      for(const item of arr){
        const value=rawValue(item?.reportedValue), date=item?.asOfDate;
        if(!Number.isFinite(value)||!date) continue;
        const entry=map.get(date)||{date};
        if(field==="eps"&&Number.isFinite(entry.eps)) continue;
        entry[field]=value; map.set(date,entry);
      }
    }
  }
  return [...map.values()].sort((a,b)=>String(b.date).localeCompare(String(a.date)));
}
async function getNseFundamentals(symbol){
  const base=symbol.replace(/\.(NS|BO)$/i,"").toUpperCase();
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20000);
  const response=await fetch("/api/fundamentals?symbol="+encodeURIComponent(base),{cache:"no-store",signal:controller.signal});
  clearTimeout(timer);
  if(!response.ok) throw new Error("NSE fundamentals endpoint returned "+response.status);
  return response.json();
}
function mapNseFundamentals(data,quote){
  const quarterly=data?.quarterly||[], annual=data?.annual||[], latest=quarterly[0]||{}, latestAnnual=annual[0]||{}, prevAnnual=annual[1]||{};
  const revenueGrowth=Number.isFinite(latestAnnual.revenue)&&Number.isFinite(prevAnnual.revenue)&&prevAnnual.revenue!==0?(latestAnnual.revenue-prevAnnual.revenue)/Math.abs(prevAnnual.revenue)*100:null;
  const earningsGrowth=Number.isFinite(latestAnnual.pat)&&Number.isFinite(prevAnnual.pat)&&prevAnnual.pat!==0?(latestAnnual.pat-prevAnnual.pat)/Math.abs(prevAnnual.pat)*100:null;
  const equity=latest.equity??latestAnnual.equity, debt=latest.debt??latestAnnual.debt, cash=latest.cash??latestAnnual.cash, pat=latest.pat??latestAnnual.pat;
  const roe=Number.isFinite(pat)&&Number.isFinite(equity)&&equity!==0?pat/equity*100:null;
  const invested=Number.isFinite(equity)&&Number.isFinite(debt)&&Number.isFinite(cash)?equity+debt-cash:null;
  const roce=Number.isFinite(latest.ebitda)&&Number.isFinite(invested)&&invested!==0?latest.ebitda/invested*100:null;
  return {pe:Number.isFinite(quote?.trailingPE)?quote.trailingPE:null,mcap:Number.isFinite(quote?.marketCap)?quote.marketCap:null,pb:Number.isFinite(quote?.priceToBook)?quote.priceToBook:null,eps:latest.eps??latestAnnual.eps??quote?.epsTrailingTwelveMonths??null,bookValue:Number.isFinite(equity)&&Number.isFinite(quote?.sharesOutstanding)&&quote.sharesOutstanding>0?equity/quote.sharesOutstanding:null,div:Number.isFinite(quote?.dividendYield)?quote.dividendYield*100:null,roe,roa:null,roce,debtEquity:latest.debtEquity??latestAnnual.debtEquity??(Number.isFinite(debt)&&Number.isFinite(equity)&&equity!==0?debt/equity:null),revenueGrowth,earningsGrowth,operatingMargin:latest.operatingMargin??latestAnnual.operatingMargin??null,pm:latest.netMargin??latestAnnual.netMargin??null,totalRevenue:latest.revenue??latestAnnual.revenue??null,netIncome:pat??null,ebitda:latest.ebitda??latestAnnual.ebitda??null,freeCashFlow:null,totalDebt:debt??null,cashTotal:cash??null,annualRows:annual,quarterlyRows:quarterly,latestPeriod:latest.date??latestAnnual.date??null,source:"NSE Integrated Filing - Financials",exchange:"NSE",mode:data.mode||"Standalone",sourceUrl:data?.filings?.[0]?.filing?.sourceUrl||null,updatedAt:data.updatedAt||null};
}

export async function getFastFundamentals(symbol){
  const key=String(symbol).toUpperCase();
  const cached=fundFastCache.get(key);
  if(cached && Date.now()-cached.time<5*60*1000) return cached.data;
  // v7 quote is crumb-protected. Use the public chart metadata for the
  // immediately available fields; slower filing data can fill the rest later.
  const url=YAHOO_CHART+encodeURIComponent(String(symbol).toUpperCase())+"?interval=1d&range=5d&events=history";
  const json=await fetchYahoo(url);
  const q=json?.chart?.result?.[0]?.meta||{};
  if(!Object.keys(q).length) throw new Error("Fast fundamentals unavailable for "+symbol);
  const data={
    pe:null,
    mcap:Number.isFinite(q.marketCap)?q.marketCap:null,
    pb:null,
    eps:null,
    bookValue:null,
    div:null,
    beta:null,
    roe:null,roa:null,roce:null,debtEquity:null,
    revenueGrowth:null,earningsGrowth:null,operatingMargin:null,pm:null,
    totalRevenue:null,netIncome:null,ebitda:null,freeCashFlow:null,totalDebt:null,cashTotal:null,
    annualRows:[],quarterlyRows:[],latestPeriod:null,
    source:"Yahoo Finance quote (fast)",
    exchange:"Yahoo"
  };
  fundFastCache.set(key,{time:Date.now(),data});
  return data;
}

export async function getFundamentals(symbol){
  const key=String(symbol).toUpperCase();
  const cached=fundCache.get(key);
  if(cached && Date.now()-cached.time<6*60*60*1000) return cached.data;
  let quote=null;
  try{
    const q=await fetchYahoo(YAHOO_QUOTE+encodeURIComponent(symbol));
    quote=q?.quoteResponse?.result?.[0]||null;
  }catch{}
  try{
    const nse=await getNseFundamentals(symbol);
    const data=mapNseFundamentals(nse,quote);
    fundCache.set(key,{time:Date.now(),data});
    return data;
  }catch{
    const data=await getYahooFundamentals(symbol);
    fundCache.set(key,{time:Date.now(),data});
    return data;
  }
}

async function getYahooFundamentals(symbol){
  const [quoteJson, annual, quarterly, valuation] = await Promise.all([
    fetchYahoo(YAHOO_QUOTE+encodeURIComponent(symbol)),
    getFundamentalsTimeseries(symbol,"annual"),
    getFundamentalsTimeseries(symbol,"quarterly"),
    getValuationTimeseries(symbol)
  ]);
  const q=quoteJson?.quoteResponse?.result?.[0]||{};

  // quoteSummary is retained only as a best-effort supplement. Core statement
  // data never depends on it.
  let summary=null;
  try{
    const url="https://query1.finance.yahoo.com/v10/finance/quoteSummary/"+encodeURIComponent(symbol)+"?modules=summaryDetail,defaultKeyStatistics,financialData";
    const json=await fetchYahoo(url);
    summary=json?.quoteSummary?.result?.[0]||null;
  }catch{}

  const sd=summary?.summaryDetail||{}, ks=summary?.defaultKeyStatistics||{}, fd=summary?.financialData||{};
  const latestRevenue=latestSeriesValue(annual,"annualTotalRevenue");
  const latestEps=latestSeriesValue(annual,"annualDilutedEPS");
  const latestNetIncome=latestSeriesValue(annual,"annualNetIncome");
  const latestEbitda=latestSeriesValue(annual,"annualEBITDA");
  const latestFcf=latestSeriesValue(annual,"annualFreeCashFlow");

  const trailingMcap=latestTimeseriesNumber(valuation,["trailingMarketCap"]);
  const trailingPE=latestTimeseriesNumber(valuation,["trailingPeRatio"]);
  const trailingPS=latestTimeseriesNumber(valuation,["trailingPsRatio"]);
  const trailingPB=latestTimeseriesNumber(valuation,["trailingPbRatio"]);

  const mcap=Number.isFinite(q.marketCap)?q.marketCap:(Number.isFinite(trailingMcap.value)?trailingMcap.value:rawValue(sd.marketCap));
  const pe=Number.isFinite(q.trailingPE)?q.trailingPE:(Number.isFinite(trailingPE.value)?trailingPE.value:rawValue(sd.trailingPE));

  const revenue=rawValue(fd.totalRevenue)||latestRevenue.value;
  const netIncome=rawValue(fd.netIncomeToCommon)||latestNetIncome.value;
  const ebitda=rawValue(fd.ebitda)||latestEbitda.value;
  const eps=Number.isFinite(q.epsTrailingTwelveMonths)?q.epsTrailingTwelveMonths:latestEps.value||rawValue(ks.trailingEps);
  const fcf=rawValue(fd.freeCashflow)||latestFcf.value;

  // Derive ratios from statements when Yahoo's quoteSummary ratios are missing.
  const equity=latestSeriesValue(annual,"annualStockholdersEquity").value;
  const assets=latestSeriesValue(annual,"annualTotalAssets").value;
  const debt=latestSeriesValue(annual,"annualTotalDebt").value;
  const cash=latestSeriesValue(annual,"annualCashCashEquivalentsAndShortTermInvestments").value;
  const roeDerived=Number.isFinite(netIncome)&&Number.isFinite(equity)&&equity!==0?(netIncome/equity)*100:null;
  const roaDerived=Number.isFinite(netIncome)&&Number.isFinite(assets)&&assets!==0?(netIncome/assets)*100:null;
  const deDerived=Number.isFinite(debt)&&Number.isFinite(equity)&&equity!==0?(debt/equity)*100:null;
  const revenueGrowthDerived=(()=>{const r=annualRowsSafe(annual); if(r.length<2||!Number.isFinite(r[0].revenue)||!Number.isFinite(r[1].revenue)||r[1].revenue===0)return null; return (r[0].revenue-r[1].revenue)/Math.abs(r[1].revenue)*100;})();
  const profitGrowthDerived=(()=>{const r=annualRowsSafe(annual); if(r.length<2||!Number.isFinite(r[0].netIncome)||!Number.isFinite(r[1].netIncome)||r[1].netIncome===0)return null; return (r[0].netIncome-r[1].netIncome)/Math.abs(r[1].netIncome)*100;})();

  return {
    pe, mcap, beta:Number.isFinite(q.beta)?q.beta:rawValue(sd.beta),
    div:Number.isFinite(q.dividendYield)?q.dividendYield*100:pctValue(sd.dividendYield),
    pm:pctValue(fd.profitMargins), roe:Number.isFinite(pctValue(fd.returnOnEquity))?pctValue(fd.returnOnEquity):roeDerived,
    roa:Number.isFinite(pctValue(fd.returnOnAssets))?pctValue(fd.returnOnAssets):roaDerived,
    roce:null,
    debtEquity:Number.isFinite(rawValue(fd.debtToEquity))?rawValue(fd.debtToEquity):deDerived,
    currentRatio:rawValue(fd.currentRatio),
    revenueGrowth:Number.isFinite(pctValue(fd.revenueGrowth))?pctValue(fd.revenueGrowth):revenueGrowthDerived,
    earningsGrowth:Number.isFinite(pctValue(fd.earningsGrowth))?pctValue(fd.earningsGrowth):profitGrowthDerived,
    grossMargin:pctValue(fd.grossMargins),
    operatingMargin:pctValue(fd.operatingMargins),
    ebitda,totalRevenue:revenue,netIncome,eps,
    bookValue:rawValue(ks.bookValue) || (Number.isFinite(equity)&&Number.isFinite(q.sharesOutstanding)&&q.sharesOutstanding>0?equity/q.sharesOutstanding:null),
    enterpriseValue:rawValue(ks.enterpriseValue),
    freeCashFlow:fcf,totalDebt:debt,cashTotal:cash,
    annualRows:buildFinancialRows(annual,"annual"),
    quarterlyRows:buildFinancialRows(quarterly,"quarterly"),
    latestPeriod:latestRevenue.date||latestEps.date||null,
    source:"Yahoo Finance fundamentals time series"
  };
}

function annualRowsSafe(results){
  return buildFinancialRows(results,"annual");
}

export function calcRSI(closes){
  if(closes.length<15) return null;
  let gains=0, losses=0;
  for(let i=closes.length-14;i<closes.length;i++){
    const delta=closes[i]-closes[i-1];
    if(delta>0) gains+=delta; else losses-=delta;
  }
  if(losses===0) return 100;
  return 100-(100/(1+(gains/losses)));
}

export function calcSMA(closes,period){
  if(closes.length<period) return null;
  return closes.slice(-period).reduce((a,b)=>a+b,0)/period;
}

export function getAISignal(tech){
  if(!tech || !Number.isFinite(tech.rsi)) return {t:"UNAVAILABLE",c:"#ffcc00",score:50,desc:"Technical data is unavailable"};
  let score=50;
  if(Number.isFinite(tech.sma20)) score += tech.price>tech.sma20?8:-8;
  if(Number.isFinite(tech.sma50)&&Number.isFinite(tech.sma20)) score += tech.sma20>tech.sma50?10:-10;
  if(Number.isFinite(tech.sma200)&&Number.isFinite(tech.sma50)) score += tech.sma50>tech.sma200?10:-10;
  if(Number.isFinite(tech.ema50)&&Number.isFinite(tech.ema20)) score += tech.ema20>tech.ema50?7:-7;
  if(tech.rsi<30) score+=12; else if(tech.rsi<45) score+=4; else if(tech.rsi>75) score-=12; else if(tech.rsi>70) score-=6;
  if(Number.isFinite(tech.macd)&&Number.isFinite(tech.macdSignal)) score += tech.macd>tech.macdSignal?8:-8;
  if(Number.isFinite(tech.stoch)){if(tech.stoch<20)score+=6;else if(tech.stoch>80)score-=6;}
  if(Number.isFinite(tech.bbPos)){if(tech.bbPos<15)score+=5;else if(tech.bbPos>85)score-=5;}
  if(Number.isFinite(tech.volumeRatio)){if(tech.volumeRatio>1.5)score += score>=50?4:-4;}
  score=Math.max(0,Math.min(100,Math.round(score)));
  if(score>=80)return {t:"STRONG BUY",c:"#00ff88",score,desc:"Strong bullish alignment across trend, momentum and participation"};
  if(score>=62)return {t:"BUY",c:"#22c55e",score,desc:"Bullish technical evidence outweighs bearish signals"};
  if(score<=20)return {t:"STRONG SELL",c:"#ff4444",score,desc:"Strong bearish alignment across trend, momentum and participation"};
  if(score<=38)return {t:"SELL",c:"#f87171",score,desc:"Bearish technical evidence outweighs bullish signals"};
  return {t:"HOLD",c:"#ffcc00",score,desc:"Signals are mixed; wait for stronger confirmation"};
}

export function classifyMarketCap(marketCap){
  if(!Number.isFinite(marketCap)) return null;
  if(marketCap>=100000000000) return "L";
  if(marketCap>=20000000000) return "M";
  return "S";
}

export function formatCompactNumber(value){
  if(!Number.isFinite(value)) return "--";
  if(value>=1e12) return (value/1e12).toFixed(2)+"T";
  if(value>=1e9) return (value/1e9).toFixed(2)+"B";
  if(value>=1e7) return (value/1e7).toFixed(2)+"Cr";
  if(value>=1e5) return (value/1e5).toFixed(2)+"L";
  return value.toLocaleString("en-IN");
}

export async function getFastStockData(symbol){
  const quote=await getFastQuote(symbol);
  return {...quote,rsi:null,sma20:null,sma50:null,sma200:null,yearChange:null};
}

export async function getStockData(symbol){
  const [fast,fund]=await Promise.all([getFastStockData(symbol),getFundamentals(symbol)]);
  return {...fast,fund};
}

export async function getNews(symbol){
  const key=String(symbol).toUpperCase();
  const cached=newsCache.get(key);
  if(cached && Date.now()-cached.time<5*60*1000) return cached.data;
  const base=symbol.replace(/\.(NS|BO)$/,"");
  const query=key==="MARKET"?"stock market India global markets":base;
  const response=await fetch("/api/news?query="+encodeURIComponent(query)+"&count=8",{cache:"no-store"});
  if(!response.ok) throw new Error("News endpoint returned "+response.status);
  const json=await response.json();
  const data=(json?.news||[]).filter(item=>item?.title).slice(0,6).map(item=>({
    title:item.title,
    publisher:item.publisher||"Market news",
    link:item.link||null,
    published:item.published ? new Date(item.published) : (item.providerPublishTime ? new Date(item.providerPublishTime*1000) : null)
  }));
  newsCache.set(key,{time:Date.now(),data});
  return data;
}

export async function getMarketOverview(){
  const indexes=[
    ["^NSEI","NIFTY 50"],["^CNX100","NIFTY 100"],["^CNX500","NIFTY 500"],["NIFTYMIDCAP150.NS","NIFTY Midcap 150"],
    ["^NSEBANK","NIFTY Bank"],["^CNXFIN","NIFTY Financial Services"],["^CNXIT","NIFTY IT"],["^CNXAUTO","NIFTY Auto"],
    ["^CNXPHARMA","NIFTY Pharma"],["^CNXFMCG","NIFTY FMCG"],["^CNXMETAL","NIFTY Metal"],["^CNXREALTY","NIFTY Realty"],
    ["^CNXPSUBANK","NIFTY PSU Bank"],["^CNXENERGY","NIFTY Energy"],["^CNXINFRA","NIFTY Infrastructure"],["^CNXMEDIA","NIFTY Media"],
    ["^CNXCONSUMER","NIFTY India Consumption"],["^CNXDIVOPP","NIFTY Dividend Opportunities 50"],["^BSESN","BSE SENSEX"]
  ];
  const quotes=await getQuotesBatch(indexes.map(x=>x[0]));
  return indexes.map(([symbol,name])=>{
    const q=quotes.get(symbol.toUpperCase());
    const price=Number.isFinite(q?.price)?q.price:null;
    const prev=Number.isFinite(q?.prev)?q.prev:null;
    return {n:name,q:price!=null?{price,prev}:null,pct:Number.isFinite(price)&&Number.isFinite(prev)&&prev!==0?(price-prev)/prev*100:null};
  });
}

export async function searchSymbols(query){
  const q=String(query||"").trim();
  if(!q) return [];
  const json=await fetchYahoo(YAHOO_SEARCH+encodeURIComponent(q)+"&quotesCount=15&newsCount=0");
  return (json?.quotes||[]).filter(x=>x?.symbol&&/\.(NS|BO)$/i.test(x.symbol)).map(x=>({symbol:x.symbol.toUpperCase(),display:x.symbol.replace(/\.(NS|BO)$/i,""),name:x.longname||x.shortname||x.symbol,exchange:x.exchange==="BSE"||x.symbol.endsWith(".BO")?"BSE":"NSE",cap:null}));
}

export async function getMarketCap(symbol){
  const json=await fetchYahoo(YAHOO_QUOTE+encodeURIComponent(symbol));
  const q=json?.quoteResponse?.result?.[0]||{};
  return {marketCap:Number.isFinite(q.marketCap)?q.marketCap:null,cap:classifyMarketCap(q.marketCap)};
}

export async function fetchLivePrice(symbol){
  const q=await getFastQuote(symbol);
  return {price:"₹"+q.price.toFixed(2),changePct:((q.price-q.prev)/q.prev*100).toFixed(2)};
}

export async function getFinnhubCandles(){
  return null;
}

export function generateMockCandles(){
  return [];
}

