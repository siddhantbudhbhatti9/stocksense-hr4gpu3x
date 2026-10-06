const NSE_HOME = "https://www.nseindia.com/";
const NSE_API = "https://www.nseindia.com/api/integrated-filing-results";
const NSE_ARCHIVE = "https://nsearchives.nseindia.com";
const FILING_TYPE = "Integrated Filing- Financials";

const HEADERS = {
  "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0 Safari/537.36",
  "Accept":"application/json,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language":"en-IN,en;q=0.9",
  "Referer":"https://www.nseindia.com/companies-listing/corporate-integrated-filing",
  "X-Requested-With":"XMLHttpRequest"
};

function clean(value){
  return String(value ?? "").replace(/\\u00a0/g," ").replace(/\\s+/g," ").trim();
}
function norm(value){
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}
function number(value){
  if(value==null) return null;
  let s=clean(value).replace(/₹|rs\\.?/gi,"").replace(/,/g,"").trim();
  if(!s || /^(-|--|na|n/a|null)$/i.test(s)) return null;
  if(/^\\(.*\\)$/.test(s)) s="-"+s.slice(1,-1);
  const m=s.match(/[-+]?\\d+(?:\\.\\d+)?/);
  return m?Number(m[0]):null;
}
function dateValue(value){
  const s=clean(value);
  const m=s.match(/(\\d{1,2})[-\\/ ]([A-Za-z]{3,9})[-\\/ ](\\d{4})/);
  if(m){
    const months={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
    const mo=months[m[2].slice(0,3).toLowerCase()];
    if(mo!=null) return Date.UTC(Number(m[3]),mo,Number(m[1]))/1000;
  }
  const iso=Date.parse(s);
  return Number.isNaN(iso)?null:iso/1000;
}
function stripHtml(html){
  return clean(html.replace(/<script[\\s\\S]*?<\\/script>/gi," ").replace(/<style[\\s\\S]*?<\\/style>/gi," ").replace(/<[^>]+>/g," "));
}
function decodeHtml(s){
  return s.replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">");
}
function cellsFromTable(table){
  const rows=[];
  const trRe=/<tr[\\s\\S]*?<\\/tr>/gi;
  const cellRe=/<t[dh]\\b[^>]*>[\\s\\S]*?<\\/t[dh]>/gi;
  for(const tr of table.match(trRe)||[]){
    const cells=[...tr.matchAll(cellRe)].map(m=>decodeHtml(stripHtml(m[0])));
    if(cells.some(Boolean)) rows.push(cells);
  }
  return rows;
}
function scaleFor(text){
  const n=norm(text);
  if(n.includes("in crores")) return 1e7;
  if(n.includes("in lakhs")) return 1e5;
  return 1;
}
function valueRow(rows, patterns, col, scale=1){
  for(const row of rows){
    const label=norm(row.slice(0,Math.min(col,row.length)).join(" "));
    if(patterns.some(p=>label.includes(norm(p)))){
      const v=number(row[col]);
      if(v!=null) return v*scale;
    }
  }
  return null;
}
function firstMatchingRow(rows, patterns){
  return rows.find(row=>patterns.some(p=>norm(row.join(" ")).includes(norm(p))))||null;
}
function parseFilingHtml(html, filing){
  const scale=scaleFor(html);
  const tables=[...html.matchAll(/<table\\b[\\s\\S]*?<\\/table>/gi)].map(m=>m[0]);
  let financialRows=[];
  for(const table of tables){
    const rows=cellsFromTable(table);
    const text=norm(rows.flat().join(" "));
    if(text.includes("date of end of reporting period") && (text.includes("revenue from operations")||text.includes("total income")) && (text.includes("earnings per share")||text.includes("eps"))){
      financialRows=rows; break;
    }
  }
  if(!financialRows.length){
    return {ok:false,error:"NSE filing financial-results table not found"};
  }
  const dateRow=financialRows.find(r=>r.some(x=>norm(x).includes("date of end of reporting period")));
  const dateIdx=dateRow?dateRow.findIndex(x=>norm(x).includes("date of end of reporting period")):-1;
  const dates=[];
  if(dateRow){
    for(let i=dateIdx+1;i<dateRow.length;i++){const d=dateValue(dateRow[i]); if(d) dates.push({index:i,date:d});}
  }
  const target=dates.find(x=>Math.abs(x.date-filing.qeDate)<86400*2)||dates[0];
  const qcol=target?.index ?? 1;
  const ycol=dates.length>1 ? (dates.find(x=>x.index!==qcol)?.index ?? qcol+1) : qcol;

  const qRevenue=valueRow(financialRows,["revenue from operations","revenue from operation"],qcol,scale);
  const yRevenue=valueRow(financialRows,["revenue from operations","revenue from operation"],ycol,scale);
  const qOther=valueRow(financialRows,["other income"],qcol,scale);
  const yOther=valueRow(financialRows,["other income"],ycol,scale);
  const qPbt=valueRow(financialRows,["total profit before tax","profit before tax"],qcol,scale);
  const yPbt=valueRow(financialRows,["total profit before tax","profit before tax"],ycol,scale);
  const qFinance=valueRow(financialRows,["finance costs","finance cost"],qcol,scale);
  const yFinance=valueRow(financialRows,["finance costs","finance cost"],ycol,scale);
  const qDep=valueRow(financialRows,["depreciation, depletion and amortisation expense","depreciation, depletion and amortisation"],qcol,scale);
  const yDep=valueRow(financialRows,["depreciation, depletion and amortisation expense","depreciation, depletion and amortisation"],ycol,scale);
  const qPat=valueRow(financialRows,["net profit loss for the period from continuing operations","net profit after tax from continuing & discontinued operations","total profit (loss) for period","net profit/(loss)"],qcol,scale);
  const yPat=valueRow(financialRows,["net profit loss for the period from continuing operations","net profit after tax from continuing & discontinued operations","total profit (loss) for period","net profit/(loss)"],ycol,scale);
  const qEps=valueRow(financialRows,["diluted earnings (loss) per share from continuing and discontinued operations","basic earnings (loss) per share from continuing and discontinued operations","basic & diluted eps","earnings per share"],qcol,1);
  const yEps=valueRow(financialRows,["diluted earnings (loss) per share from continuing and discontinued operations","basic earnings (loss) per share from continuing and discontinued operations","basic & diluted eps","earnings per share"],ycol,1);
  const qDebtEq=valueRow(financialRows,["debt equity ratio"],qcol,1);
  const yDebtEq=valueRow(financialRows,["debt equity ratio"],ycol,1);

  const qEbitdaText=stripHtml(html).match(/ebitda[^0-9-]{0,80}([-]?[0-9][0-9,]*(?:\\.[0-9]+)?)/i);
  const ebitdaExplicit=qEbitdaText?number(qEbitdaText[1]):null;
  const qEbitda=ebitdaExplicit ?? (qPbt!=null && qFinance!=null && qDep!=null ? qPbt+qFinance+qDep-(qOther||0):null);
  const yEbitda=(yPbt!=null&&yFinance!=null&&yDep!=null)?yPbt+yFinance+yDep-(yOther||0):null;

  const allText=stripHtml(html);
  const qOperatingMargin=valueRow(financialRows,["operating margin (%)","operating margin percent"],qcol,1);
  const qNetMargin=valueRow(financialRows,["net profit margin (%)","net profit margin percent"],qcol,1);
  const yOperatingMargin=valueRow(financialRows,["operating margin (%)","operating margin percent"],ycol,1);
  const yNetMargin=valueRow(financialRows,["net profit margin (%)","net profit margin percent"],ycol,1);

  const balanceTables=tables.map(t=>cellsFromTable(t)).filter(rows=>norm(rows.flat().join(" ")).includes("statement of asset and liabilities"));
  const balanceRows=balanceTables[0]||[];
  const balanceScale=scaleFor(balanceTables[0]?balanceTables[0].flat().join(" "):allText);
  const balDateRow=balanceRows.find(r=>r.some(x=>norm(x).includes("date of end of reporting period")));
  const balCol=balDateRow?Math.max(1,balDateRow.findIndex(x=>dateValue(x)!=null)):1;
  const assets=valueRow(balanceRows,["total assets"],balCol,balanceScale);
  const equity=valueRow(balanceRows,["total equity","total equity attributable to owners of parent","equity attributable to owners"],balCol,balanceScale);
  const cash=valueRow(balanceRows,["cash and cash equivalents","cash and cash equivalents and bank balances"],balCol,balanceScale);
  const debt=valueRow(balanceRows,["total borrowings","total debt","borrowings"],balCol,balanceScale);
  const netWorth=valueRow(balanceRows,["net worth"],balCol,balanceScale);

  const periodStart=dateRow&&dateIdx>=0?dateValue(dateRow[qcol-0]||""):null;
  return {
    ok:true,
    periodEnd:filing.qeDate,
    periodStart,
    q:{revenue:qRevenue,ebitda:qEbitda,pat:qPat,eps:qEps,debtEquity:qDebtEq,operatingMargin:qOperatingMargin,netMargin:qNetMargin,assets,equity,cash,debt,netWorth},
    y:{revenue:yRevenue,ebitda:yEbitda,pat:yPat,eps:yEps,debtEquity:yDebtEq,operatingMargin:yOperatingMargin,netMargin:yNetMargin},
    unit:scale===1e7?"INR Crores":scale===1e5?"INR Lakhs":"INR Actuals"
  };
}

function pickField(row, names){
  for(const name of names){ if(row?.[name]!=null && row[name]!=="") return row[name]; }
  return null;
}
function toAbsolute(url){
  if(!url) return null;
  if(/^https?:\\/\\//i.test(url)) return url;
  return NSE_ARCHIVE+ (url.startsWith("/")?url:"/"+url);
}
function normalizeFiling(row){
  const qe=pickField(row,["qe_Date","qeDate","quarterEndDate","periodEnded"]);
  const qeDate=dateValue(qe);
  return {
    symbol:clean(pickField(row,["symbol"])),
    company:clean(pickField(row,["smName","cmName","companyName"])),
    seqId:clean(pickField(row,["seq_Id","seqId","sequenceId"])),
    qeDate,
    type:clean(pickField(row,["type_Sub","typeSub","submissionType"])),
    audited:clean(pickField(row,["audited","auditedUnaudited"])),
    consolidated:clean(pickField(row,["consolidated","consolidatedStandalone"])),
    broadcast:clean(pickField(row,["broadcast_Date","broadcastDate","broadcastDateTime"])),
    creation:clean(pickField(row,["creation_Date","creationDate","revisedDateTime"])),
    xbrl:toAbsolute(pickField(row,["xbrl","xbrlUrl","xbrlFile"])),
    ixbrl:toAbsolute(pickField(row,["ixbrl","ixbrlUrl","ixbrlFile"])),
    raw:row
  };
}
async function fetchNseJson(url, options={}){
  const response=await fetch(url,{...options,headers:{...HEADERS,...(options.headers||{})},cache:"no-store"});
  const text=await response.text();
  let json=null; try{json=JSON.parse(text);}catch{}
  return {response,text,json};
}
async function loadFilings(symbol){
  const params=new URLSearchParams({symbol,type:FILING_TYPE,page:"1",size:"20"});
  let first=await fetchNseJson(NSE_HOME,{headers:{Accept:"text/html"}});
  const cookies=first.response.headers.getSetCookie?.()||[];
  const cookie=cookies.map(x=>x.split(";")[0]).join("; ");
  const result=await fetchNseJson(NSE_API+"?"+params.toString(),{headers:cookie?{Cookie:cookie}:{}});

  if(!result.response.ok || !result.json) throw new Error("NSE integrated filing feed unavailable ("+result.response.status+")");
  const rows=Array.isArray(result.json.data)?result.json.data:[];
  return rows.map(normalizeFiling).filter(x=>x.qeDate).sort((a,b)=>b.qeDate-a.qeDate);
}
async function fetchIxbrl(filing){
  const url=filing.ixbrl||filing.xbrl;
  if(!url) return null;
  const response=await fetch(url,{headers:HEADERS,cache:"no-store"});
  if(!response.ok) return null;
  const html=await response.text();
  return {url,html};
}
function latestUnique(filings, consolidated="Standalone"){
  const out=[]; const seen=new Set();
  for(const f of filings){
    if(consolidated && norm(f.consolidated)!==norm(consolidated)) continue;
    const key=f.qeDate;
    if(seen.has(key)) continue;
    seen.add(key); out.push(f);
  }
  return out;
}
async function main(symbol){
  const base=symbol.replace(/\\.(NS|BO)$/i,"").toUpperCase();
  const filings=await loadFilings(base);
  const standalone=latestUnique(filings,"Standalone").slice(0,4);
  const consolidated=latestUnique(filings,"Consolidated").slice(0,4);
  const selected=standalone.length?standalone:consolidated;
  const parsed=(await Promise.all(selected.map(async filing=>{
    try{
      const doc=await fetchIxbrl(filing);
      if(!doc) return null;
      const p=parseFilingHtml(doc.html,filing);
      return p.ok?{...p,filing:{quarterEnd:filing.qeDate,submission:filing.type,audited:filing.audited,consolidated:filing.consolidated,filingDate:filing.creation||filing.broadcast,sourceUrl:doc.url}}:null;
    }catch{return null;}
  }))).filter(Boolean);
  if(!parsed.length) throw new Error("NSE filings were found but financial values could not be parsed");
  const annual=parsed.filter(x=>new Date(x.periodEnd*1000).getUTCMonth()===2).map(x=>({date:x.periodEnd,...x.y})).slice(0,5);
  return {source:"NSE Integrated Filing - Financials",exchange:"NSE",symbol:base,mode:standalone.length?"Standalone":"Consolidated",filings:parsed,annual,quarterly:parsed.map(x=>({date:x.periodEnd,...x.q})).slice(0,8),updatedAt:new Date().toISOString()};
}

export default async function handler(req,res){
  const symbol=String(req.query?.symbol||"").trim().toUpperCase();
  if(!symbol) return res.status(400).json({error:"Missing symbol"});
  if(!/^[A-Z0-9&_-]+$/.test(symbol)) return res.status(400).json({error:"Invalid symbol"});
  try{
    const data=await main(symbol);
    res.setHeader("Cache-Control","s-maxage=21600, stale-while-revalidate=86400");
    return res.status(200).json(data);
  }catch(error){
    return res.status(502).json({error:error?.message||"NSE fundamentals unavailable",exchange:"NSE",symbol});
  }
}
