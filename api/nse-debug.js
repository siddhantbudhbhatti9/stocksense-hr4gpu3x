export default async function handler(req,res){
  try{
    const symbol=String(req.query?.symbol||"RELIANCE").toUpperCase();
    const headers={"User-Agent":"Mozilla/5.0","Accept":"application/json,text/html,*/*","Referer":"https://www.nseindia.com/companies-listing/corporate-integrated-filing","X-Requested-With":"XMLHttpRequest"};
    const home=await fetch("https://www.nseindia.com/",{headers});
    const cookies=home.headers.getSetCookie?.()||[];
    const cookie=cookies.map(x=>x.split(";")[0]).join("; ");
    const url="https://www.nseindia.com/api/integrated-filing-results?symbol="+encodeURIComponent(symbol)+"&type=Integrated%20Filing-%20Financials&page=1&size=5";
    const r=await fetch(url,{headers:{...headers,...(cookie?{Cookie:cookie}:{})}});
    const text=await r.text();
    const payload=JSON.parse(text); const filing=payload?.data?.find(x=>x?.consolidated==="Standalone")||payload?.data?.[0]; const ix=filing?.ixbrl; let xr=null; if(ix){const rr=await fetch(ix,{headers}); const tt=await rr.text(); xr={status:rr.status,length:tt.length,sample:tt.slice(0,120)};} res.status(200).json({home:home.status,nse:r.status,length:text.length,filing,ix:xr});
  }catch(e){res.status(200).json({error:String(e?.stack||e)})}
}