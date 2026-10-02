import './style.css'
import { allIndianIndices } from './data/allIndices.js'
import { defaultWatchlist } from './data/topStocks.js'
import { AdvancedChart } from './components/AdvancedChart.js'
import { WatchlistManager } from './components/Watchlist.js'
import { nseSearchUniverse } from './data/topStocks.js'

const app = document.querySelector('#app')

app.innerHTML = `
  <div class="topbar">
    <div class="brand"><div class="brand-icon">₹</div><div><h1>STOCK SENSE</h1><p>HYBRID • ADVANCED CHART + CUSTOM INTEL</p></div></div>
    <div class="search-wrap" style="position:relative;flex:1;max-width:400px;margin-left:20px">
      <input id="globalSearch" class="search mono" placeholder="Search NSE/BSE (also search inside chart)..." style="width:100%"/>
      <div id="searchDropdown" style="display:none;position:absolute;top:42px;left:0;right:0;background:#0F1A2E;border:1px solid #1D2D50;border-radius:12px;z-index:50;max-height:300px;overflow:auto"></div>
    </div>
  </div>
  <div class="ticker-wrap mono"><div class="ticker" id="ticker"></div></div>
  <div class="layout">
    <div class="card">
      <h3>Watchlist • <span id="listName">10 Mix Caps (Large+Mid+Small)</span></h3>
      <div id="customLists"></div>
      <div id="watchlist" style="margin-top:12px"></div>
      <p style="font-size:10px;color:var(--muted);margin-top:10px">💡 Tip: Chart on right has built-in TradingView search for 5000+ NSE/BSE stocks. Your custom watchlist is for your 2x15 personal lists.</p>
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      <div style="padding:12px;display:flex;justify-content:space-between;align-items:center;background:var(--card)">
        <h3 style="margin:0">LIFE CHART • <span id="activeSymbol" class="mono positive">NSE:RELIANCE - Full History</span></h3>
        <span class="pill">TradingView Advanced - Indicators, Heikin Ashi, Drawings included</span>
      </div>
      <div id="advancedChart" style="height:520px"></div>
      <div style="padding:12px;display:grid;grid-template-columns:repeat(4,1fr);gap:8px" class="mono">
        <div class="mini-stat"><span>Type</span><b>Candles/Line/Heikin</b></div>
        <div class="mini-stat"><span>Indicators</span><b>MA, RSI, MACD, BB</b></div>
        <div class="mini-stat"><span>Range</span><b>1D to Life (MAX)</b></div>
        <div class="mini-stat"><span>Search</span><b>Inside Chart + Global</b></div>
      </div>
    </div>
    <div class="card"><h3>All Indian Indices • Live</h3><div id="indicesList"></div></div>
  </div>
`

// Ticker
document.getElementById('ticker').innerHTML = [...allIndianIndices,...allIndianIndices].map(i=>`<span style="margin-right:40px">${i.label}</span>`).join('')

// Chart - Hybrid
const chart = new AdvancedChart('advancedChart')
chart.load('RELIANCE.NS')

// Watchlist
const watchlist = new WatchlistManager((sym)=>{
  document.getElementById('activeSymbol').textContent = sym
  chart.setSymbol(sym)
})
watchlist.render()

// Global Search that syncs to Advanced Chart
const input = document.getElementById('globalSearch')
const dropdown = document.getElementById('searchDropdown')
input.addEventListener('input', ()=>{
  const q = input.value.toLowerCase().trim()
  if(q.length<1){ dropdown.style.display='none'; return }
  const matches = nseSearchUniverse.filter(s=> s.display.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)).slice(0,8)
  dropdown.innerHTML = matches.map(s=>`
    <div class="search-item" data-symbol="${s.symbol}" style="padding:10px;display:flex;justify-content:space-between;cursor:pointer;border-bottom:1px solid #1D2D50">
      <div><b class="mono">${s.display}</b> <span class="badge" style="background:#1A294E;padding:2px 6px;border-radius:4px;font-size:10px">${s.symbol.includes('.NS')?'NSE':'BSE'}</span><br><span style="font-size:11px;color:#7C8DB0">${s.name}</span></div>
      <div style="font-size:11px;color:#7C8DB0">${s.cap}</div>
    </div>
  `).join('')
  dropdown.style.display='block'
})
dropdown.addEventListener('click', (e)=>{
  const item = e.target.closest('.search-item')
  if(!item) return
  const sym = item.dataset.symbol
  input.value = sym
  dropdown.style.display='none'
  document.getElementById('activeSymbol').textContent = sym
  chart.setSymbol(sym)
})
document.addEventListener('click',(e)=>{ if(!e.target.closest('.search-wrap')) dropdown.style.display='none' })

// Indices list
document.getElementById('indicesList').innerHTML = allIndianIndices.map(i=>`<div class="stock-row"><div><b class="mono">${i.label}</b><div style="font-size:10px;color:var(--muted)">${i.name}</div></div><div class="mono" style="font-size:11px;color:var(--green)">LIVE</div></div>`).join('')