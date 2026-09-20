/* MarketPilot public research. No local APIs, credentials, analytics or trading routes. */
'use strict';
(() => {
  const CONSENT_KEY = 'marketpilot.public.external.v1';
  const OPTIONS_KEY = 'marketpilot.public.options.v1';
  const INTERVALS = Object.freeze({5:'5 分鐘',15:'15 分鐘',30:'30 分鐘',60:'1 小時',240:'4 小時',D:'1 天',W:'1 週'});
  const ZONES = ['Asia/Taipei','Etc/UTC','exchange'];
  const SYMBOLS = Object.freeze({
    'BINANCE:BTCUSDT': ['Bitcoin','BTC / USDT','Binance · 加密貨幣現貨'],
    'BINANCE:ETHUSDT': ['Ethereum','ETH / USDT','Binance · 加密貨幣現貨'],
    'BINANCE:SOLUSDT': ['Solana','SOL / USDT','Binance · 加密貨幣現貨'],
    'NASDAQ:AAPL': ['Apple','AAPL','NASDAQ · 美國股票'],
    'NASDAQ:NVDA': ['NVIDIA','NVDA','NASDAQ · 美國股票'],
    'TWSE:2330': ['台積電','2330','TWSE · 台灣股票'],
    'HKEX:700': ['騰訊控股','700','HKEX · 香港股票'],
    'TSE:7203': ['豐田汽車','7203','TSE · 日本股票']
  });
  const SCRIPTS = Object.freeze({
    chart:'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js',
    news:'https://s3.tradingview.com/external-embedding/embed-widget-timeline.js',
    overview:'https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js'
  });
  const $ = id => document.getElementById(id);
  const isSymbol = value => typeof value === 'string' && /^[A-Z0-9_]{1,20}:[A-Z0-9._!/-]{1,40}$/.test(value);
  const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key,value) => { try { localStorage.setItem(key,value); return true; } catch { return false; } };
  const remove = key => { try { localStorage.removeItem(key); return true; } catch { return false; } };
  const forcedOff = new URLSearchParams(window.location.search).get('external') === 'off';
  let saved = {};
  try { saved = JSON.parse(read(OPTIONS_KEY) || '{}'); } catch { /* Invalid stored options are ignored. */ }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
  const state = {
    allowed:!forcedOff && read(CONSENT_KEY) === 'granted',
    symbol:isSymbol(saved.symbol) ? saved.symbol : 'BINANCE:BTCUSDT',
    interval:Object.hasOwn(INTERVALS,saved.interval) ? String(saved.interval) : '15',
    timezone:ZONES.includes(saved.timezone) ? saved.timezone : 'Asia/Taipei',
    feed:saved.feed === 'symbol' ? 'symbol' : 'all'
  };
  const saveOptions = () => write(OPTIONS_KEY,JSON.stringify({symbol:state.symbol,interval:state.interval,timezone:state.timezone,feed:state.feed}));
  const chartURL = () => 'https://www.tradingview.com/chart/?symbol=' + encodeURIComponent(state.symbol);
  const slots = new Map();
  let renderTimer;

  function updateControls() {
    const details = SYMBOLS[state.symbol] || [state.symbol.split(':')[1],state.symbol,'自選標的 · 可用性依來源授權'];
    const badge = document.createElement('span');
    badge.id = 'symbol-badge'; badge.textContent = details[1];
    $('chart-title').replaceChildren(document.createTextNode(details[0] + ' '),badge);
    $('chart-market').textContent = details[2];
    $('open-chart').href = chartURL();
    $('timezone').value = state.timezone;
    $('news-feed').value = state.feed;
    document.querySelectorAll('[data-symbol]').forEach(button => {
      const active = button.dataset.symbol === state.symbol;
      button.classList.toggle('active',active); button.setAttribute('aria-pressed',String(active));
    });
    document.querySelectorAll('[data-interval]').forEach(button => {
      const active = button.dataset.interval === state.interval;
      button.classList.toggle('active',active); button.setAttribute('aria-pressed',String(active));
    });
    $('consent-card').hidden = state.allowed;
    $('connection-bar').hidden = !state.allowed;
    const chart = slots.get('chart');
    const ready = chart?.loaded && chart.symbol === state.symbol && chart.interval === state.interval && chart.timezone === state.timezone;
    $('chart-state').textContent = '每根 K 線 ' + INTERVALS[state.interval] + ' · ' + (!state.allowed ? '圖表待授權載入' : ready ? '圖表由 TradingView 提供，資料狀態以圖內標示為準' : '來源資料載入中；歷史範圍可在圖表內調整');
  }

  function widgetError(root,kind,details) {
    if (!root.isConnected || !state.allowed) return;
    const box = document.createElement('div'); box.className = 'widget-error';
    const note = document.createElement('p'); note.textContent = details;
    const retry = document.createElement('button'); retry.className = 'button quiet'; retry.textContent = '重新載入來源';
    retry.addEventListener('click',() => { const old = slots.get(kind); if (old) { clearTimeout(old.timeout); old.observer.disconnect(); } slots.delete(kind); renderWidgets(); });
    const source = document.createElement('a'); source.href = kind === 'chart' ? chartURL() : 'https://www.tradingview.com/markets/';
    source.target = '_blank'; source.rel = 'noopener noreferrer'; source.textContent = '直接開啟 TradingView ↗';
    box.append(note,retry,source); root.replaceChildren(box);
    if (kind === 'chart') $('chart-state').textContent = '每根 K 線 ' + INTERVALS[state.interval] + ' · 外部來源暫時無法載入';
  }

  function mount(kind,settings,title) {
    if (!state.allowed || !Object.hasOwn(SCRIPTS,kind)) return;
    const key = JSON.stringify(settings);
    if (slots.get(kind)?.key === key) return;
    const previous = slots.get(kind);
    if (previous) { clearTimeout(previous.timeout); previous.observer.disconnect(); }
    const root = $(kind + '-widget'); root.replaceChildren();
    const wrapper = document.createElement('div'); wrapper.className = 'tradingview-widget-container';
    const content = document.createElement('div'); content.className = 'tradingview-widget-container__widget';
    const attribution = document.createElement('div'); attribution.className = 'tradingview-widget-copyright';
    const source = document.createElement('a'); source.href = kind === 'chart' ? chartURL() : 'https://www.tradingview.com/';
    source.target = '_blank'; source.rel = 'noopener noreferrer'; source.textContent = title + ' — TradingView';
    attribution.append(source); wrapper.append(content,attribution); root.append(wrapper);
    const entry = {key,observer:null,timeout:null,loaded:false,symbol:settings.symbol,interval:settings.interval,timezone:settings.timezone};
    entry.observer = new MutationObserver(() => {
      const frame = wrapper.querySelector('iframe');
      if (!frame) return;
      frame.title = title + '（TradingView 外部資料）';
      frame.referrerPolicy = 'no-referrer';
      entry.observer.disconnect();
      // An iframe load is not proof that its cross-origin quote data is available.
      frame.addEventListener('load',() => {
        clearTimeout(entry.timeout); entry.loaded = true;
        if (kind === 'chart' && root.contains(wrapper) && entry.symbol === state.symbol && entry.interval === state.interval && entry.timezone === state.timezone) $('chart-state').textContent = '每根 K 線 ' + INTERVALS[state.interval] + ' · 圖表由 TradingView 提供，資料狀態以圖內標示為準';
      },{once:true});
    });
    entry.observer.observe(wrapper,{childList:true,subtree:true});
    entry.timeout = setTimeout(() => {
      entry.observer.disconnect();
      if (root.contains(wrapper)) widgetError(root,kind,'外部來源尚未回應，可能受網路或瀏覽器設定影響。');
    },25000);
    slots.set(kind,entry);
    const script = document.createElement('script');
    script.src = SCRIPTS[kind]; script.async = true; script.type = 'text/javascript';
    // This is the provider's documented JSON configuration, not executable inline JS.
    script.textContent = JSON.stringify(settings);
    script.addEventListener('error',() => {
      clearTimeout(entry.timeout); entry.observer.disconnect();
      if (root.contains(wrapper)) widgetError(root,kind,'無法載入 TradingView。請檢查連線，或直接查看來源網站。');
    },{once:true});
    wrapper.append(script);
  }

  function renderWidgets() {
    if (!state.allowed) return;
    mount('chart',{autosize:true,symbol:state.symbol,interval:state.interval,timezone:state.timezone,theme:'dark',style:'1',locale:'zh_TW',allow_symbol_change:false,calendar:false,support_host:'https://www.tradingview.com'},'市場 K 線圖表');
    const news = {feedMode:state.feed === 'symbol' ? 'symbol' : 'all_symbols',colorTheme:'dark',isTransparent:true,displayMode:'regular',width:'100%',height:'100%',locale:'zh_TW'};
    if (state.feed === 'symbol') news.symbol = state.symbol;
    mount('news',news,'市場新聞');
    mount('overview',{colorTheme:'dark',dateRange:'1D',showChart:true,locale:'zh_TW',width:'100%',height:'100%',isTransparent:true,showSymbolLogo:true,showFloatingTooltip:true,tabs:[
      {title:'加密貨幣',symbols:[{s:'BINANCE:BTCUSDT',d:'Bitcoin'},{s:'BINANCE:ETHUSDT',d:'Ethereum'},{s:'BINANCE:SOLUSDT',d:'Solana'}]},
      {title:'美國股票',symbols:[{s:'NASDAQ:AAPL',d:'Apple'},{s:'NASDAQ:NVDA',d:'NVIDIA'},{s:'NASDAQ:MSFT',d:'Microsoft'},{s:'NYSE:TSM',d:'台積電 ADR'}]},
      {title:'全球股票',symbols:[{s:'TWSE:2330',d:'台積電'},{s:'HKEX:700',d:'騰訊控股'},{s:'TSE:7203',d:'豐田汽車'},{s:'XETR:SAP',d:'SAP'}]}
    ]},'全球市場概覽');
  }

  function applyOptions() {
    saveOptions(); updateControls(); clearTimeout(renderTimer);
    renderTimer = setTimeout(renderWidgets,180);
  }
  function allowExternal() {
    if (state.allowed) return;
    state.allowed = true; write(CONSENT_KEY,'granted');
    const url = new URL(window.location.href); url.searchParams.delete('external'); window.history.replaceState(null,'',url);
    updateControls(); renderWidgets();
  }
  function revokeExternal() {
    state.allowed = false; remove(CONSENT_KEY); clearTimeout(renderTimer);
    slots.forEach(entry => { clearTimeout(entry.timeout); entry.observer.disconnect(); });
    // Reload removes the already executed provider scripts and active iframe connections.
    const url = new URL(window.location.href); url.searchParams.set('external','off'); window.location.replace(url.href);
  }
  function applySymbol() {
    const value = $('custom-symbol').value.trim().toUpperCase();
    if (!isSymbol(value)) {
      $('symbol-help').textContent = '請填交易所:標的代碼，例如 NASDAQ:AAPL。僅支援英數字及 . _ ! / -，不可填網址。';
      $('custom-symbol').setAttribute('aria-invalid','true'); return;
    }
    $('custom-symbol').removeAttribute('aria-invalid');
    $('symbol-help').textContent = '已選擇 ' + value + '。若來源不支援嵌入，請使用「來源圖表」。';
    state.symbol = value; applyOptions();
  }

  $('allow-external').addEventListener('click',allowExternal);
  document.querySelectorAll('[data-allow-external]').forEach(button => button.addEventListener('click',allowExternal));
  $('revoke-external').addEventListener('click',revokeExternal);
  $('privacy-revoke').addEventListener('click',revokeExternal);
  $('clear-preferences').addEventListener('click',() => {
    remove(OPTIONS_KEY); state.symbol = 'BINANCE:BTCUSDT'; state.interval = '15'; state.timezone = 'Asia/Taipei'; state.feed = 'all';
    $('custom-symbol').value = ''; $('custom-symbol').removeAttribute('aria-invalid');
    updateControls(); renderWidgets(); $('privacy-status').textContent = '已清除本站圖表偏好，恢復預設顯示。外部資料同意狀態維持不變。';
  });
  document.querySelectorAll('[data-symbol]').forEach(button => button.addEventListener('click',() => {
    if (!isSymbol(button.dataset.symbol)) return;
    state.symbol = button.dataset.symbol; applyOptions();
  }));
  document.querySelectorAll('[data-interval]').forEach(button => button.addEventListener('click',() => {
    if (!Object.hasOwn(INTERVALS,button.dataset.interval)) return;
    state.interval = button.dataset.interval; applyOptions();
  }));
  $('timezone').addEventListener('change',event => { if (ZONES.includes(event.target.value)) { state.timezone = event.target.value; applyOptions(); } });
  $('news-feed').addEventListener('change',event => { state.feed = event.target.value === 'symbol' ? 'symbol' : 'all'; applyOptions(); });
  $('apply-symbol').addEventListener('click',applySymbol);
  $('custom-symbol').addEventListener('keydown',event => { if (event.key === 'Enter') { event.preventDefault(); applySymbol(); } });
  document.querySelectorAll('[data-dialog]').forEach(button => button.addEventListener('click',() => $(button.dataset.dialog).showModal()));
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click',() => button.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click',event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } }));
  updateControls();
  if (state.allowed) renderWidgets();
})();
