import { defaultWatchlist } from '../data/topStocks.js';
import { fetchLivePrice } from '../utils/api.js';

export class WatchlistManager{
  constructor(onSelect){
    this.onSelect = onSelect;
    this.customLists = JSON.parse(localStorage.getItem('ss_custom_lists')||'{"List 1":[],"List 2":[]}');
    this.activeList = localStorage.getItem('ss_active_list')||'Default';
  }

  async render(){
    const container = document.getElementById('watchlist');
    if(!container) return;
    let stocks = this.activeList==='Default'? defaultWatchlist : this.customLists[this.activeList];

    container.innerHTML = stocks.map(s=>`
      <div class="stock-row" data-sym="${s.symbol}" style="padding:10px;display:flex;justify-content:space-between;cursor:pointer;border-bottom:1px solid #1D2D50">
        <div><b class="mono" style="font-size:13px">${s.display||s.symbol}</b><div style="font-size:10px;color:#7C8DB0">${s.name||''}</div></div>
        <div class="mono" style="font-size:12px;text-align:right" id="price-${(s.display||'').replace(/[^A-Z0-9]/g,'')}">${s.display||s.symbol}</div>
      </div>
    `).join('');

    // Fetch prices in background
    for(let s of stocks){
      try{
        const p = await fetchLivePrice(s.symbol);
        const id = (s.display||'').replace(/[^A-Z0-9]/g,'');
        const el = document.getElementById(`price-${id}`);
        if(el && p) el.innerHTML = `<span style="color:white">${p.price}</span>`;
      }catch(e){}
    }

    container.querySelectorAll('.stock-row').forEach(r=> r.addEventListener('click', ()=> this.onSelect(r.dataset.sym)));

    this.renderCustomControls();
  }

  renderCustomControls(){
    const ctrl = document.getElementById('customLists');
    if(!ctrl) return;
    ctrl.innerHTML = `
      <div style="display:flex;gap:6px;margin-bottom:12px">
        ${['Default','List 1','List 2'].map(l=>`<button class="pill ${this.activeList===l?'active':''}" data-list="${l}" style="padding:6px 12px;background:${this.activeList===l?'#FF8C1A':'#1A294E'};color:white;border-radius:20px;border:none;cursor:pointer;font-size:12px">${l}</button>`).join('')}
      </div>
      ${this.activeList!=='Default'?`
        <div style="display:flex;gap:6px">
          <input id="addSymbol" class="search" style="flex:1;padding:8px;background:#0F1A2E;border:1px solid #1D2D50;border-radius:8px;color:white" placeholder="Add e.g. TCS"/>
          <button id="addBtn" class="btn" style="padding:8px 14px;background:#FF8C1A;border:none;border-radius:8px;cursor:pointer;font-weight:bold">+</button>
        </div>
        <p style="font-size:10px;color:#7C8DB0;margin-top:6px">${(this.customLists[this.activeList]?.length||0)}/15 stocks - e.g. type TCS, RELIANCE, INFY</p>
      ` : `<p style="font-size:11px;color:#7C8DB0">Default: 10 curated mix caps (Large+Mid+Small). Click to create your own max 2 lists, 15 stocks each.</p>`}
    `;
    ctrl.querySelectorAll('[data-list]').forEach(b=> b.addEventListener('click', ()=>{ this.activeList=b.dataset.list; localStorage.setItem('ss_active_list',this.activeList); this.render(); }));
    const addBtn = document.getElementById('addBtn');
    if(addBtn) addBtn.addEventListener('click', ()=>{
      const inp = document.getElementById('addSymbol').value.trim().toUpperCase();
      if(!inp) return;
      if(this.customLists[this.activeList].length>=15){ alert("Max 15 stocks per list"); return; }
      const sym = inp.includes('.')?inp:inp+'.NS';
      this.customLists[this.activeList].push({ symbol: sym, display: inp.replace('.NS',''), name: inp });
      localStorage.setItem('ss_custom_lists', JSON.stringify(this.customLists));
      this.render();
    });
  }
}