import { getFinnhubCandles, generateMockCandles } from '../utils/api.js';

export class AdvancedChart{
  constructor(containerId){
    this.containerId=containerId;
    this.chart=null;
    this.exchange='NSE'; // Default NSE, can switch to BSE
  }

  async ensureLib(){
    if(window.LightweightCharts) return;
    await new Promise((res, rej)=>{
      const s=document.createElement('script');
      s.src='https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.js';
      s.onload=res; s.onerror=rej; document.head.appendChild(s);
    });
  }

  setExchange(exchange){
    this.exchange = exchange; // 'NSE' or 'BSE'
    this.load(this.currentSymbol);
  }

  async load(symbol){
    this.currentSymbol = symbol;
    const container=document.getElementById(this.containerId);
    if(!container) return;

    container.innerHTML=`<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:520px;color:#FF8C1A;font-family:monospace"><div>Loading ${symbol.replace('.NS','').replace('.BO','')} [${this.exchange}]...</div><div style="font-size:10px;color:#7C8DB0;margin-top:8px">Finnhub ${this.exchange} REAL Data</div></div>`;
    await this.ensureLib();

    let candles = null;
    let source = "DEMO";

    // 1. Try Finnhub NSE/BSE
    candles = await getFinnhubCandles(symbol, this.exchange, 800);
    if(candles && candles.length>30) source = `FINNHUB ${this.exchange} LIVE`;

    // 2. Fallback mock (NSE + BSE realistic)
    if(!candles){
      candles = generateMockCandles(symbol, this.exchange);
      source = `${this.exchange} DEMO (Add Finnhub token for LIVE)`;
    }

    container.innerHTML=''; container.style.position='relative';
    this.chart=window.LightweightCharts.createChart(container,{
      width:container.clientWidth, height:520,
      layout:{ background:{ color:'#080E1D' }, textColor:'#7C8DB0' },
      grid:{ vertLines:{ color:'#1D2D50' }, horzLines:{ color:'#1D2D50' } },
      timeScale:{ borderColor:'#1D2D50', timeVisible:true }
    });
    const candleSeries=this.chart.addCandlestickSeries({ upColor:'#22C55E', downColor:'#EF4444', borderVisible:false, wickUpColor:'#22C55E', wickDownColor:'#EF4444' });
    candleSeries.setData(candles);
    const volSeries=this.chart.addHistogramSeries({ priceScaleId:'', priceFormat:{ type:'volume' } });
    volSeries.setData(candles.map(c=>({ time:c.time, value:c.volume, color:c.close>=c.open?'rgba(34,197,94,0.4)':'rgba(239,68,68,0.4)' })));
    this.chart.timeScale().fitContent();

    // NSE/BSE Badge + Toggle
    const badge=document.createElement('div');
    badge.style.cssText='position:absolute;top:10px;left:10px;background:#0F1A2E;padding:8px 12px;border-radius:8px;font-size:11px;color:white;border:1px solid #1D2D50;z-index:10;display:flex;gap:8px;align-items:center';
    badge.innerHTML=`
      <div><b style="color:#22C55E">${symbol.replace('.NS','').replace('.BO','')} • ${source} • ${candles.length} DAYS</b><br>
      <span style="color:#7C8DB0;font-size:10px">Finnhub API • ${this.exchange} + ${this.exchange==='NSE'?'BSE':'NSE'} support</span></div>
      <div style="margin-left:10px;display:flex;gap:4px">
        <button id="btn-nse" style="padding:4px 8px;background:${this.exchange==='NSE'?'#FF8C1A':'#1D2D50'};color:white;border:none;border-radius:4px;cursor:pointer;font-size:10px">NSE</button>
        <button id="btn-bse" style="padding:4px 8px;background:${this.exchange==='BSE'?'#FF8C1A':'#1D2D50'};color:white;border:none;border-radius:4px;cursor:pointer;font-size:10px">BSE</button>
      </div>
    `;
    container.appendChild(badge);

    setTimeout(()=>{
      const nseBtn=document.getElementById('btn-nse');
      const bseBtn=document.getElementById('btn-bse');
      if(nseBtn) nseBtn.onclick=()=>{ this.exchange='NSE'; this.load(symbol); };
      if(bseBtn) bseBtn.onclick=()=>{ this.exchange='BSE'; this.load(symbol.replace('.NS','.BO')); };
    },100);
  }
  setSymbol(s){ this.load(s); }
}