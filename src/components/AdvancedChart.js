export class AdvancedChart{
  constructor(containerId){
    this.containerId = containerId;
    this.widget = null;
    this.currentSymbol = "NSE:RELIANCE";
  }

  load(symbol){
    // Convert NSE symbols to TradingView format
    let tvSymbol = symbol;
    if(symbol.includes('.NS')) tvSymbol = "NSE:" + symbol.replace('.NS','');
    else if(symbol.includes('.BO')) tvSymbol = "BSE:" + symbol.replace('.BO','');
    else if(!symbol.includes(':')) tvSymbol = "NSE:" + symbol;
    
    this.currentSymbol = tvSymbol;
    const container = document.getElementById(this.containerId);
    container.innerHTML = '';

    // TradingView Advanced Chart Widget - auto includes search, life chart, indicators
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/tv.js';
    script.onload = () => {
      this.widget = new window.TradingView.widget({
        autosize: true,
        symbol: tvSymbol,
        interval: "D",
        timezone: "Asia/Kolkata",
        theme: "dark",
        style: "1",
        locale: "in",
        toolbar_bg: "#0F1A2E",
        enable_publishing: false,
        allow_symbol_change: true, // THIS GIVES BUILT-IN GLOBAL SEARCH FOR ALL NSE/BSE
        hide_side_toolbar: false,
        details: true,
        hotlist: true,
        calendar: true,
        studies: ["MASimple@tv-basicstudies"],
        container_id: this.containerId,
        backgroundColor: "#080E1D",
        gridColor: "#1D2D50",
        width: "100%",
        height: 500,
      });
    };
    document.head.appendChild(script);
  }

  // Called when user selects from OUR custom search or watchlist
  setSymbol(symbol){
    this.load(symbol);
  }
}