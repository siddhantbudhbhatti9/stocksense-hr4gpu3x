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
    let stocks = this.activeList==='Default'? defaultWatchlist : this.customLists[this.activeList];

    container.innerHTML = stocks.map(s=>`<div class="stock-row" data-sym="${s.symbol}"><div><b class="mono">${s.display||s.symbol}</b><div style="font-size:10px;color:var(--muted)">${s.name||''}</div></div><div class="mono" style="font-size:12px" id="price-${s.display||s.symbol}">...</div></div>`).join('');

    // Live price update
    for(let s of stocks){
      const p = await fetchLivePrice(s.symbol);
      const el = document.getElementById(`price-${s.display||s.symbol}`);
      if(el && p) el.innerHTML = `${p.price}<br><span class="${p.change>=0?'positive':'negative'}">${p.changePercent}%</span>`;
    }

    container.querySelectorAll('.stock-row').forEach(r=> r.addEventListener('click', ()=> this.onSelect(r.dataset.sym)));

    this.renderCustomControls();
  }

  renderCustomControls(){
    const ctrl = document.getElementById('customLists');
    if(!ctrl) return;
    ctrl.innerHTML = `
      <div style="display:flex;gap:6px;margin-bottom:10px">
        ${['Default','List 1','List 2'].map(l=>`<button class="pill ${this.activeList===l?'active':''}" data-list="${l}">${l}</button>`).join('')}
      </div>
      ${this.activeList!=='Default'?`<div style="display:flex;gap:6px"><input id="addSymbol" class="search" style="padding:6px" placeholder="Add NSE symbol e.g. TCS.NS"/><button id="addBtn" class="btn" style="padding:6px 10px">+</button></div><p style="font-size:10px;color:var(--muted);margin-top:6px">${(this.customLists[this.activeList]?.length||0)}/15 stocks</p>` : `<p style="font-size:11px;color:var(--muted)">Default: 10 curated mix caps. Create your own max 2 lists, 15 stocks each.</p>`}
    `;
    ctrl.querySelectorAll('[data-list]').forEach(b=> b.addEventListener('click', ()=>{ this.activeList=b.dataset.list; localStorage.setItem('ss_active_list',this.activeList); this.render(); }));
    const addBtn = document.getElementById('addBtn');
    if(addBtn) addBtn.addEventListener('click', ()=>{
      const inp = document.getElementById('addSymbol').value.trim().toUpperCase();
      if(!inp) return;
      if(this.customLists[this.activeList].length>=15){ alert("Max 15 stocks per list"); return; }
      this.customLists[this.activeList].push({ symbol: inp.includes('.')?inp:inp+'.NS', display: inp.replace('.NS',''), name: inp });
      localStorage.setItem('ss_custom_lists', JSON.stringify(this.customLists));
      this.render();
    });
  }
}