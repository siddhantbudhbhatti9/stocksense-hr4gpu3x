import { defaultWatchlist } from "../data/topStocks.js";
import { fetchLivePrice } from "../utils/api.js";

export class WatchlistManager{
  constructor(onSelect){this.onSelect=onSelect;this.customLists=JSON.parse(localStorage.getItem("ss_custom_lists_v2")||'{"List 1":[],"List 2":[]}');this.activeList=localStorage.getItem("ss_active_list_v2")||"Default";this.sortMode="default";}
  async render(){
    const container=document.getElementById("watchlist");if(!container)return;
    const stocks=this.activeList==="Default"?defaultWatchlist:(this.customLists[this.activeList]||[]);
    const results=await Promise.all(stocks.map(async s=>{try{const p=await fetchLivePrice(s.symbol);return {...s,p};}catch{return {...s,p:null};}}));
    container.innerHTML=results.map(s=>`<div class="stock-row" data-sym="${s.symbol}" style="padding:10px;display:flex;justify-content:space-between;cursor:pointer;border-bottom:1px solid #1D2D50"><div><b class="mono" style="font-size:13px">${s.display||s.symbol}</b><div style="font-size:10px;color:#7C8DB0">${s.name||""}</div></div><div class="mono" style="font-size:12px;text-align:right">${s.p?.price||"--"}</div></div>`).join("");
    container.querySelectorAll(".stock-row").forEach(r=>r.onclick=()=>this.onSelect(r.dataset.sym));this.renderCustomControls();
  }
  renderCustomControls(){
    const ctrl=document.getElementById("customLists");if(!ctrl)return;
    ctrl.innerHTML=`<div style="display:flex;gap:6px;margin-bottom:12px"><button class="pill">Default</button><button class="pill">List 1</button><button class="pill">List 2</button></div><p style="font-size:10px;color:#7C8DB0">Maximum 3 watchlists, 20 stocks each.</p>`;
  }
}
