const PROXIES = [
  "/api/yahoo?url=",
  "https://api.allorigins.win/raw?url=",
  "https://corsproxy.io/?url=",
  "https://api.codetabs.com/v1/proxy?quest="
];
const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/";
const YAHOO_QUOTE = "https://query1.finance.yahoo.com/v7/finance/quote?symbols=";
const YAHOO_SEARCH = "https://query1.finance.yahoo.com/v1/finance/search?q=";

async function fetchYahoo(url){
  for(const proxy of PROXIES){
    try{
      const response=await fetch(proxy+encodeURIComponent(url),{cache:"no-store"});
      if(!response.ok) continue;
      const text=await response.text();
      const parsed=JSON.parse(text);
      return parsed?.contents ? JSON.parse(parsed.contents) : parsed;
    }catch{}
  }
  return null;
}

export async function getQuote(symbol){
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
  return {
    symbol, price, prev, closes,
    timestamps:result.timestamp||[],
    opens:quote?.open||[], highs:quote?.high||[], lows:quote?.low||[], volumes:quote?.volume||[],
    high:(quote?.high||[]).filter(Number.isFinite).slice(-1)[0] ?? null,
    low:(quote?.low||[]).filter(Number.isFinite).slice(-1)[0] ?? null,
    vol:Number.isFinite(meta?.regularMarketVolume)?meta.regularMarketVolume:null,
    high52:Number.isFinite(meta?.fiftyTwoWeekHigh)?meta.fiftyTwoWeekHigh:Math.max(...closes),
    low52:Number.isFinite(meta?.fiftyTwoWeekLow)?meta.fiftyTwoWeekLow:Math.min(...closes)
  };
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

export async function getFundamentals(symbol){
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

export function getAISignal(rsi,sma20,sma50){
  if(rsi==null) return {t:"UNAVAILABLE",c:"#ffcc00"};
  if(rsi<30) return {t:"STRONG BUY",c:"#00ff88"};
  if(rsi<45 && sma20!=null && sma50!=null && sma20>sma50) return {t:"BUY",c:"#00ff88"};
  if(rsi>70) return {t:"STRONG SELL",c:"#ff4444"};
  return {t:"HOLD",c:"#ffcc00"};
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

export async function getStockData(symbol){
  const [quote,fund] = await Promise.all([getQuote(symbol),getFundamentals(symbol)]);
  const rsi=calcRSI(quote.closes);
  const sma20=calcSMA(quote.closes,20);
  const sma50=calcSMA(quote.closes,50);
  const sma200=calcSMA(quote.closes,200);
  const first=quote.closes[0];
  return {
    ...quote,
    change:quote.price-quote.prev,
    changePct:((quote.price-quote.prev)/quote.prev)*100,
    rsi,sma20,sma50,sma200,
    yearChange:first ? ((quote.price-first)/first)*100 : null,
    fund,
    cap:classifyMarketCap(fund.mcap)
  };
}

export async function getNews(symbol){
  const base=symbol.replace(/\.(NS|BO)$/,"");
  const json=await fetchYahoo(YAHOO_SEARCH+encodeURIComponent(base)+"&newsCount=6");
  return (json?.news||[]).filter(item=>item?.title).slice(0,6).map(item=>({
    title:item.title,
    publisher:item.publisher||"Yahoo Finance",
    link:item.link||null,
    published:item.providerPublishTime ? new Date(item.providerPublishTime*1000) : null
  }));
}

export async function searchSymbols(query){
  const q=String(query||"").trim();
  if(!q) return [];
  const json=await fetchYahoo(YAHOO_SEARCH+encodeURIComponent(q)+"&quotesCount=15&newsCount=0");
  return (json?.quotes||[]).filter(x=>x?.symbol&&/\.(NS|BO)$/i.test(x.symbol)).map(x=>({symbol:x.symbol.toUpperCase(),display:x.symbol.replace(/\.(NS|BO)$/i,""),name:x.longname||x.shortname||x.symbol,exchange:x.exchange==="BSE"||x.symbol.endsWith(".BO")?"BSE":"NSE",cap:null}));
}

export async function getMarketCap(symbol){
  const fund=await getFundamentals(symbol);
  return {marketCap:fund.mcap,cap:classifyMarketCap(fund.mcap)};
}

export async function fetchLivePrice(symbol){
  const q=await getQuote(symbol);
  return {price:"₹"+q.price.toFixed(2),changePct:((q.price-q.prev)/q.prev*100).toFixed(2)};
}

export async function getFinnhubCandles(){
  return null;
}

export function generateMockCandles(){
  return [];
}
