const YAHOO_HOSTS=["query1.finance.yahoo.com","query2.finance.yahoo.com"];

function browserHeaders(){
  return {
    "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
    "Accept":"application/json,text/plain,*/*",
    "Accept-Language":"en-US,en;q=0.9"
  };
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

  const hosts=[target.hostname,...YAHOO_HOSTS.filter(h=>h!==target.hostname)];
  let lastStatus=502;
  for(const host of hosts){
    const candidate=new URL(target.toString());
    candidate.hostname=host;
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),2500);
    try{
      const response=await fetch(candidate.toString(),{
        headers:browserHeaders(),
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
