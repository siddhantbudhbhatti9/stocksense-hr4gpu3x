// Using Yahoo Finance chart API via CORS proxy for Indian stocks
// Works for NSE.NS symbols
const CORS = 'https://api.allorigins.win/raw?url=';

export async function fetchLivePrice(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
    const res = await fetch(CORS + encodeURIComponent(url));
    const data = await res.json();
    const meta = data.chart.result[0].meta;
    return {
      price: meta.regularMarketPrice,
      prevClose: meta.previousClose,
      change: meta.regularMarketPrice - meta.previousClose,
      changePercent: (
        ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) *
        100
      ).toFixed(2),
      high: meta.regularMarketDayHigh,
      low: meta.regularMarketDayLow,
      volume: meta.regularMarketVolume,
    };
  } catch (e) {
    console.error(e);
    return null;
  }
}

export async function fetchHistorical(symbol, range = '1y') {
  // range: 1d,5d,1mo,3mo,6mo,1y,5y,max = Life chart
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=${range}`;
    const res = await fetch(CORS + encodeURIComponent(url));
    const data = await res.json();
    const result = data.chart.result[0];
    const timestamps = result.timestamp;
    const closes = result.indicators.quote[0].close;
    const opens = result.indicators.quote[0].open;
    const highs = result.indicators.quote[0].high;
    const lows = result.indicators.quote[0].low;
    const volumes = result.indicators.quote[0].volume;

    return timestamps
      .map((t, i) => ({
        time: t,
        open: opens[i],
        high: highs[i],
        low: lows[i],
        close: closes[i],
        value: closes[i],
        volume: volumes[i],
      }))
      .filter((c) => c.close);
  } catch (e) {
    console.error('history error', e);
    return [];
  }
}

export async function fetchQuoteDetails(symbol) {
  const price = await fetchLivePrice(symbol);
  // mock key metrics for now (Yahoo quote API needs extra call)
  return {
    ...price,
    marketCap: '₹ 19.8L Cr',
    pe: '24.5',
    week52High: '3024.90',
    week52Low: '2221.05',
    divYield: '0.42%',
    about: `${symbol} is a leading Indian company listed on NSE/BSE with strong fundamentals and market presence in its sector.`,
  };
}
