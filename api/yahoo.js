const YAHOO_HOSTS=["query1.finance.yahoo.com","query2.finance.yahoo.com"];
const YAHOO_SESSION_TTL_MS=15*60*1000;
let yahooSessionCache=null;
let yahooSessionExpiresAt=0;
let yahooSessionPromise=null;

function browserHeaders(){
  return {
    "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
    "Accept":"application/json,text/plain,*/*",
    "Accept-Language":"en-US,en;q=0.9"
  };
}

function captureYahooCookies(response,jar){
  const separate=typeof response.headers.getSetCookie==="function"?response.headers.getSetCookie():[];
  const values=separate.length?separate:[response.headers.get("set-cookie")||""];
  for(const value of values){
    for(const match of value.matchAll(/(?:^|,\s*)([A-Za-z0-9!#$%&'*+.^_`|~-]+)=([^;,\s]+)/g)){
      const name=match[1],cookie=match[2];
      if(cookie)jar.set(name,cookie);
    }
  }
}

async function fetchTimed(url,options={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),2500);
  try{return await fetch(url,{...options,signal:controller.signal});}
  finally{clearTimeout(timer);}
}

async function createYahooSession(){
  const jar=new Map();
  let url="https://fc.yahoo.com";
  for(let attempt=0;attempt<6;attempt++){
    const response=await fetchTimed(url,{headers:browserHeaders(),redirect:"manual"});
    captureYahooCookies(response,jar);
    const location=response.headers.get("location");
    if(response.status<300||response.status>=400||!location)break;
    const next=new URL(location,url);
    if(next.protocol!=="https:"||!(next.hostname==="yahoo.com"||next.hostname.endsWith(".yahoo.com")))throw new Error("Yahoo cookie redirect was not allowed");
    url=next.href;
  }
  const cookie=[...jar].map(([name,value])=>`${name}=${value}`).join("; ");
  if(!cookie)throw new Error("Yahoo did not issue a quote cookie");
  const crumbResponse=await fetchTimed("https://query1.finance.yahoo.com/v1/test/getcrumb",{headers:{...browserHeaders(),Cookie:cookie}});
  const crumb=(await crumbResponse.text()).trim();
  if(!crumbResponse.ok||!crumb||crumb.includes("Too Many Requests")||/<html/i.test(crumb))throw new Error("Yahoo quote crumb unavailable");
  return {cookie,crumb};
}

async function getYahooSession(){
  if(yahooSessionCache&&Date.now()<yahooSessionExpiresAt)return yahooSessionCache;
  if(yahooSessionPromise)return yahooSessionPromise;
  yahooSessionPromise=createYahooSession().then(session=>{
    yahooSessionCache=session;
    yahooSessionExpiresAt=Date.now()+YAHOO_SESSION_TTL_MS;
    return session;
  }).finally(()=>{yahooSessionPromise=null;});
  return yahooSessionPromise;
}

export default async function handler(req, res) {
  const raw = req.query?.url;
  if (!raw) return res.status(400).json({ error: "Missing url" });

  let target;
  try {
    target = new URL(raw);
  } catch {
    return res.status(400).json({ error: "Invalid url" });
  }

  if (!YAHOO_HOSTS.includes(target.hostname)) {
    return res.status(403).json({ error: "Upstream host not allowed" });
  }

  let yahooSession=null;
  if(target.pathname==="/v7/finance/quote"){
    try{yahooSession=await getYahooSession();}catch{}
  }

  const hosts=[target.hostname,...YAHOO_HOSTS.filter(h=>h!==target.hostname)];
  let lastStatus=502;
  for(const host of hosts){
    const candidate=new URL(target.toString());
    candidate.hostname=host;
    if(yahooSession)candidate.searchParams.set("crumb",yahooSession.crumb);
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),2500);
    try{
      const response=await fetch(candidate.toString(),{
        headers:{...browserHeaders(),...(yahooSession?{Cookie:yahooSession.cookie}:{})},
        cache:"no-store",
        signal:controller.signal
      });
      const body=await response.text();
      lastStatus=response.status;
      if(response.ok){
        res.setHeader("Content-Type",response.headers.get("content-type")||"application/json");
        res.setHeader("Cache-Control","s-maxage=30, stale-while-revalidate=120");
        return res.status(200).send(body);
      }
    }catch{
      lastStatus=502;
    }finally{
      clearTimeout(timer);
    }
  }
  return res.status(lastStatus>=400&&lastStatus<600?lastStatus:502).json({error:"Yahoo market data provider unavailable"});
}

