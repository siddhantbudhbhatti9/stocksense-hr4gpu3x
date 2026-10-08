const HOSTS=["query1.finance.yahoo.com","query2.finance.yahoo.com"];
const cache=new Map();
const CACHE_MS=5*60*1000;
const UPSTREAM_TIMEOUT_MS=2500;

function headers(){
  return {
    "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
    "Accept":"application/json,text/plain,*/*",
    "Accept-Language":"en-US,en;q=0.9"
  };
}

export default async function handler(req,res){
  const query=String(req.query?.query||"").trim();
  const count=Math.min(10,Math.max(1,Number(req.query?.count||8)));
  if(!query) return res.status(400).json({error:"Missing query"});
  const key=query.toLowerCase()+"|"+count;
  const cached=cache.get(key);
  if(cached && Date.now()-cached.time<CACHE_MS){
    res.setHeader("Content-Type","application/json");
    res.setHeader("Cache-Control","public, s-maxage=300, stale-while-revalidate=900");
    return res.status(200).json(cached.data);
  }

  let lastStatus=502;
  for(const host of HOSTS){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),UPSTREAM_TIMEOUT_MS);
    try{
      const url="https://"+host+"/v1/finance/search?q="+encodeURIComponent(query)+"&newsCount="+count+"&quotesCount=0";
      const response=await fetch(url,{headers:headers(),cache:"no-store",signal:controller.signal});
      const body=await response.text();
      lastStatus=response.status;
      if(!response.ok) continue;
      const json=JSON.parse(body);
      const news=(json?.news||[]).filter(item=>item?.title).slice(0,count).map(item=>({
        title:item.title,
        publisher:item.publisher||"Yahoo Finance",
        link:item.link||null,
        providerPublishTime:item.providerPublishTime||null
      }));
      const data={news};
      cache.set(key,{time:Date.now(),data});
      res.setHeader("Content-Type","application/json");
      res.setHeader("Cache-Control","public, s-maxage=300, stale-while-revalidate=900");
      return res.status(200).json(data);
    }catch{}finally{clearTimeout(timer);}
  }
  res.setHeader("Cache-Control","no-store");
  return res.status(lastStatus>=400&&lastStatus<600?lastStatus:502).json({error:"News provider unavailable",news:[]});
}
