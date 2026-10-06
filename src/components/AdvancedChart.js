import { getQuote } from "../utils/api.js";
import { createChart, CandlestickSeries, HistogramSeries } from "lightweight-charts";

export class AdvancedChart{
  constructor(containerId){this.containerId=containerId;this.chart=null;this.exchange="NSE";this.currentSymbol=null;}
  setExchange(exchange){this.exchange=exchange;return this.load(this.currentSymbol);}
  async load(symbol){
    this.currentSymbol=symbol;
    const container=document.getElementById(this.containerId);
    if(!container||!symbol)return;
    container.innerHTML='<div style="height:520px;display:flex;align-items:center;justify-content:center;color:#7C8DB0">Loading live chart...</div>';
    try{
      const data=await getQuote(symbol);
      container.innerHTML="";
      this.chart=createChart(container,{width:container.clientWidth,height:520,layout:{background:{color:"#080E1D"},textColor:"#7C8DB0"},grid:{vertLines:{color:"#1D2D50"},horzLines:{color:"#1D2D50"}},timeScale:{borderColor:"#1D2D50",timeVisible:true}});
      const series=this.chart.addSeries(CandlestickSeries,{upColor:"#22C55E",downColor:"#EF4444",borderVisible:false,wickUpColor:"#22C55E",wickDownColor:"#EF4444"});
      const candles=[];data.timestamps.forEach((ts,i)=>{const o=data.opens[i],h=data.highs[i],l=data.lows[i],c=data.closes[i];if([o,h,l,c].every(Number.isFinite))candles.push({time:ts,open:o,high:h,low:l,close:c});});
      series.setData(candles);
      const vol=this.chart.addSeries(HistogramSeries,{priceFormat:{type:"volume"},priceScaleId:""});vol.setData(candles.map((c,i)=>({time:c.time,value:Number(data.volumes[i])||0})));
      this.chart.timeScale().fitContent();
    }catch{container.innerHTML='<div style="height:520px;display:flex;align-items:center;justify-content:center;color:#ffcc00">Live chart data unavailable.</div>';}
  }
  setSymbol(symbol){return this.load(symbol);}
}
