// AI + Signals - Pure JS, No API Key, Fast
export function RSI(closes, period=14){
    let gains=0, losses=0;
    for(let i=1;i<=period;i++){
      let diff=closes[i]-closes[i-1];
      if(diff>=0) gains+=diff; else losses-=diff;
    }
    let avgGain=gains/period, avgLoss=losses/period;
    for(let i=period+1;i<closes.length;i++){
      let diff=closes[i]-closes[i-1];
      if(diff>=0){ avgGain=(avgGain*(period-1)+diff)/period; avgLoss=(avgLoss*(period-1))/period; }
      else { avgGain=(avgGain*(period-1))/period; avgLoss=(avgLoss*(period-1)-diff)/period; }
    }
    if(avgLoss===0) return 100;
    const RS=avgGain/avgLoss;
    return 100-(100/(1+RS));
  }
  
  export function SMA(closes, period){
    if(closes.length<period) return null;
    return closes.slice(-period).reduce((a,b)=>a+b,0)/period;
  }
  
  export function getSignals(candles){
    const closes=candles.map(c=>c.close);
    const rsi=RSI(closes);
    const sma50=SMA(closes,50);
    const sma200=SMA(closes,200);
    const last=closes[closes.length-1];
  
    let signals=[];
    let insight="NEUTRAL";
  
    if(rsi>70){ signals.push("SELL: RSI Overbought "+rsi.toFixed(1)); insight="BEARISH"; }
    else if(rsi<30){ signals.push("BUY: RSI Oversold "+rsi.toFixed(1)); insight="BULLISH"; }
  
    if(sma50 && sma200){
      if(sma50>sma200 && last>sma50) { signals.push("BUY: Golden Cross (SMA50 > SMA200)"); insight="BULLISH"; }
      if(sma50<sma200) { signals.push("SELL: Death Cross"); insight="BEARISH"; }
    }
  
    if(last > Math.max(...candles.slice(-20).map(c=>c.high))*0.98) signals.push("SELL: Near 20D High");
    if(last < Math.min(...candles.slice(-20).map(c=>c.low))*1.02) signals.push("BUY: Near 20D Low");
  
    if(signals.length===0) signals.push("HOLD: No strong signal");
  
    return { rsi: rsi.toFixed(1), sma50: sma50?.toFixed(2), sma200: sma200?.toFixed(2), signals, insight };
  }