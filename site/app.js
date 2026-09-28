/* Public UI: visitor Gemini keys stay in a password field until a research request. */
'use strict';
(() => {
  const CONSENT_KEY = 'marketpilot.public.external.v2';
  const OPTIONS_KEY = 'marketpilot.public.options.v2';
  const INTERVALS = Object.freeze({
    '5m': ['5 分鐘', '5'], '15m': ['15 分鐘', '15'], '30m': ['30 分鐘', '30'], '1h': ['1 小時', '60']
  });
  const ZONES = Object.freeze(['Asia/Taipei', 'Etc/UTC', 'exchange']);
  const ASSETS = {
    BTCUSDT: { name: 'Bitcoin', badge: 'BTC / USDT', market: 'Binance · 加密貨幣現貨', chart: 'BINANCE:BTCUSDT', kind: 'crypto', currency: 'USDT', zone: 'Etc/UTC' },
    ETHUSDT: { name: 'Ethereum', badge: 'ETH / USDT', market: 'Binance · 加密貨幣現貨', chart: 'BINANCE:ETHUSDT', kind: 'crypto', currency: 'USDT', zone: 'Etc/UTC' },
    SOLUSDT: { name: 'Solana', badge: 'SOL / USDT', market: 'Binance · 加密貨幣現貨', chart: 'BINANCE:SOLUSDT', kind: 'crypto', currency: 'USDT', zone: 'Etc/UTC' },
    NVDA: { name: 'NVIDIA', badge: 'NVDA', market: 'NASDAQ · 美國股票', chart: 'NASDAQ:NVDA', kind: 'stock', currency: 'USD', zone: 'America/New_York' },
    AAPL: { name: 'Apple', badge: 'AAPL', market: 'NASDAQ · 美國股票', chart: 'NASDAQ:AAPL', kind: 'stock', currency: 'USD', zone: 'America/New_York' },
    '2330.TW': { name: '台積電', badge: '2330', market: 'TWSE · 台灣股票', chart: 'TWSE:2330', kind: 'stock', currency: 'TWD', zone: 'Asia/Taipei' },
    '0700.HK': { name: '騰訊控股', badge: '0700', market: 'HKEX · 香港股票', chart: 'HKEX:700', kind: 'stock', currency: 'HKD', zone: 'Asia/Hong_Kong' },
    '7203.T': { name: '豐田汽車', badge: '7203', market: 'TSE · 日本股票', chart: 'TSE:7203', kind: 'stock', currency: 'JPY', zone: 'Asia/Tokyo' }
  };
  const DEFAULT_WATCHLIST = Object.keys(ASSETS);
  const PROVIDER_SCRIPTS = Object.freeze({
    chart: 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js',
    news: 'https://s3.tradingview.com/external-embedding/embed-widget-timeline.js',
    overview: 'https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js'
  });
  // Only markets verified for these intraday widgets. Other symbols remain available
  // for research and open on their own TradingView pages without a misleading fallback.
  const EMBEDDABLE_CHART_EXCHANGES = new Set(['BINANCE', 'NASDAQ', 'NYSE']);
  const $ = id => document.getElementById(id);
  const svg = (name, attributes = {}) => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  };
  const element = (name, className, text) => {
    const node = document.createElement(name);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); return true; } catch { return false; } };
  const remove = key => { try { localStorage.removeItem(key); return true; } catch { return false; } };
  const forcedOff = new URLSearchParams(window.location.search).get('external') === 'off';
  const configuredApi = (() => {
    const raw = document.documentElement.dataset.apiBase || '';
    try {
      const value = new URL(raw);
      return value.protocol === 'https:' && !value.username && !value.password && !value.port && /^(?:(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?[.]){1,2}deno[.](?:dev|net)|marketpilot(?:-[0-9]+)?[.][a-z0-9-]+[.]ts[.]net)$/i.test(value.hostname) ? value.origin : '';
    } catch { return ''; }
  })();
  let saved = {};
  try { saved = JSON.parse(read(OPTIONS_KEY) || '{}'); } catch { saved = {}; }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
  const customAssets = Object.create(null);
  if (Array.isArray(saved.customAssets)) for (const item of saved.customAssets.slice(0,16)) {
    if (!item || typeof item !== 'object' || typeof item.symbol !== 'string') continue;
    const symbol = item.symbol.toUpperCase();
    if (Object.hasOwn(ASSETS,symbol) || !/^[A-Z0-9.^-]{1,20}$/.test(symbol) || !['stock','crypto'].includes(item.kind) ||
      (item.kind === 'crypto' && !/^[A-Z0-9]{2,16}USDT$/.test(symbol)) ||
      typeof item.chart !== 'string' || !/^[A-Z0-9.:^-]{1,45}$/.test(item.chart) ||
      typeof item.name !== 'string' || !item.name || item.name.length > 80 ||
      typeof item.currency !== 'string' || !/^[A-Z]{3,4}$/.test(item.currency) ||
      typeof item.zone !== 'string' || item.zone.length > 60) continue;
    const entry = {name:item.name,badge:symbol,market:item.kind === 'crypto' ? 'Binance · 加密貨幣現貨' : '全球股票 · 自選',chart:item.chart,kind:item.kind,currency:item.currency,zone:item.zone};
    ASSETS[symbol] = entry; customAssets[symbol] = {symbol,...entry};
  }
  const storedWatchlist = Array.isArray(saved.watchlist) ? saved.watchlist : DEFAULT_WATCHLIST;
  const watchlist = [...new Set(storedWatchlist.filter(symbol => typeof symbol === 'string' && Object.hasOwn(ASSETS,symbol)))].slice(0,16);
  if (!watchlist.length) watchlist.push('BTCUSDT');
  const state = {
    allowed: !forcedOff && read(CONSENT_KEY) === 'granted',
    symbol: watchlist.includes(saved.symbol) ? saved.symbol : watchlist[0],
    watchlist,
    interval: Object.hasOwn(INTERVALS, saved.interval) ? saved.interval : '15m',
    timezone: ZONES.includes(saved.timezone) ? saved.timezone : 'Asia/Taipei',
    marketFilter: ['all', 'crypto', 'stock'].includes(saved.marketFilter) ? saved.marketFilter : 'all',
    researchConsent: false,
    busy: false,
    lastResearch: null,
    researchRequest: 0,
    researchAbort: null,
    researchTimer: null,
    researchStartedAt: 0,
    serviceReady: false,
    servicePaused: document.documentElement.dataset.servicePaused === 'offline',
    serviceDue: 0,
    serviceChecked: false,
    sharedAi: false,
    keySource: 'shared',
    analysisMode: 'standard',
    dailySymbol: '',
    dailyLevels: null,
    dailyChecked: false,
    dailyRequest: 0,
    dailyDue: 0,
    rulesEnabled: saved.rulesEnabled !== false,
    rules: null,
    rulesError: ''
  };
  const slots = new Map();
  let renderTimer;

  function saveOptions() {
    write(OPTIONS_KEY, JSON.stringify({ symbol: state.symbol, interval: state.interval, timezone: state.timezone, marketFilter: state.marketFilter, rulesEnabled: state.rulesEnabled,
      watchlist:state.watchlist, customAssets:Object.values(customAssets) }));
  }

  function asset() { return ASSETS[state.symbol]; }
  function canEmbedChart(selected = asset()) {
    const exchange = selected.chart.split(':', 1)[0];
    return EMBEDDABLE_CHART_EXCHANGES.has(exchange) && (selected.kind === 'crypto' ? exchange === 'BINANCE' : selected.kind === 'stock' && exchange !== 'BINANCE');
  }
  function selectSymbol(symbol) {
    if (!state.watchlist.includes(symbol) || symbol === state.symbol) return;
    state.symbol = symbol; window.dispatchEvent(new Event('marketpilot:asset'));
    if (state.allowed) for (const kind of ['chart', 'news']) {
      disposeSlot(kind);
      $(kind + '-widget').replaceChildren(element('div', 'widget-placeholder', '正在切換至 ' + asset().name + '…'));
    }
    clearResearch(); applyChartOptions(); loadDailyLevels(); renderWatchlist();
  }
  function renderWatchlist() {
    const root = $('watchlist'); root.replaceChildren();
    const symbols = state.watchlist.filter(symbol => state.marketFilter === 'all' || ASSETS[symbol].kind === state.marketFilter);
    for (const symbol of symbols) {
      const item = ASSETS[symbol], button = element('button','watch-row');
      button.type = 'button'; button.dataset.symbol = symbol; button.dataset.kind = item.kind;
      button.setAttribute('aria-pressed',String(symbol === state.symbol));
      const mark = element('span','watch-mark',symbol === 'BTCUSDT' ? '₿' : symbol === 'ETHUSDT' ? 'Ξ' : /^[\u4e00-\u9fff]/.test(item.name) ? item.name.slice(0,1) : symbol.slice(0,1));
      if (symbol === 'BTCUSDT') mark.classList.add('bitcoin');
      if (symbol === 'ETHUSDT') mark.classList.add('ethereum');
      const label = element('span','watch-label'), values = element('span','watch-values');
      label.append(element('strong','',item.name),element('small','',item.badge));
      values.append(element('strong','',symbol),element('small','',item.kind === 'crypto' ? '加密貨幣' : '股票／ETF'));
      button.append(mark,label,values); button.addEventListener('click',()=>selectSymbol(symbol)); root.append(button);
    }
    if (!symbols.length) root.append(element('p','watch-empty','這個類別尚無自選標的。'));
    updateControls();
  }
  function renderWatchManager() {
    const root = $('asset-list'); root.replaceChildren();
    state.watchlist.forEach((symbol,index) => {
      const item = ASSETS[symbol], row = element('div','asset-manage-row'), name = element('span','',item.name+' · '+symbol);
      const controls = element('span','asset-manage-actions');
      for (const [label,action,disabled] of [['↑','up',index === 0],['↓','down',index === state.watchlist.length-1],['移除','remove',state.watchlist.length === 1]]) {
        const button = element('button','button subtle',label); button.type='button'; button.disabled=disabled;
        button.setAttribute('aria-label',action === 'remove' ? '移除 '+symbol : (action === 'up' ? '上移 ' : '下移 ')+symbol);
        button.addEventListener('click',()=>{
          $('asset-add-status').textContent='';
          if (action === 'remove') {
            state.watchlist.splice(index,1);
            if (state.symbol === symbol) selectSymbol(state.watchlist[0]);
            if (Object.hasOwn(customAssets,symbol)) {delete customAssets[symbol];delete ASSETS[symbol];}
          } else {
            const target = index + (action === 'up' ? -1 : 1);
            [state.watchlist[index],state.watchlist[target]] = [state.watchlist[target],state.watchlist[index]];
          }
          saveOptions(); renderWatchlist(); renderWatchManager();
        }); controls.append(button);
      }
      row.append(name,controls); root.append(row);
    });
    $('asset-count').textContent = state.watchlist.length + ' / 16 個自選標的';
  }
  function chartURL() {
    const symbol = asset().chart;
    const match = /^([A-Z0-9]+):([A-Z0-9.^-]+)$/.exec(symbol);
    if (!match) return 'https://www.tradingview.com/chart/?symbol=' + encodeURIComponent(symbol);
    if (match[1] === 'BINANCE') return 'https://www.tradingview.com/symbols/' + match[2] + '/?exchange=BINANCE';
    return 'https://www.tradingview.com/symbols/' + match[1] + '-' + match[2] + '/';
  }
  function actionText(value) { return ({ LONG: '偏多條件', SHORT: '偏空條件', WAIT: '保持觀望' })[value] || '保持觀望'; }
  function formatNumber(value, currency) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    try { return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: number >= 1000 ? 2 : number >= 1 ? 4 : 8 }).format(number) + ' ' + currency; } catch { return String(number) + ' ' + currency; }
  }
  function formatTime(value) {
    const stamp = Number(value);
    if (!Number.isFinite(stamp) || stamp <= 0) return '等待資料';
    try { return new Intl.DateTimeFormat('zh-TW', { dateStyle: 'short', timeStyle: 'medium', timeZone: state.timezone === 'exchange' ? asset().zone : state.timezone }).format(new Date(stamp * 1000)); } catch { return '時間格式暫不可用'; }
  }
  function setTone(node, tone) {
    node.classList.remove('up', 'down', 'neutral', 'long', 'short', 'wait', 'ready', 'error');
    if (tone) node.classList.add(tone);
  }

  function updateControls() {
    const selected = asset();
    $('rules-enabled').checked = state.rulesEnabled;
    $('crumb-symbol').textContent = state.symbol;
    $('metric-symbol').textContent = selected.badge;
    const badge = element('span', '', selected.badge);
    badge.id = 'chart-symbol';
    $('chart-title').replaceChildren(document.createTextNode(selected.name + ' '), badge);
    $('chart-subtitle').textContent = selected.market;
    $('open-chart').href = chartURL();
    $('news-title').textContent = '市場焦點 · ' + selected.name;
    $('news-subtitle').textContent = canEmbedChart(selected) ? '與目前選定標的相關的新聞由 TradingView 官方元件提供；新聞量依市場而異' : '此市場不載入可能顯示其他股票的內嵌新聞；請開啟對應標的頁';
    $('timezone').value = state.timezone;
    $('chart-selection').textContent = canEmbedChart(selected) ? '預設每根 K 線 ' + INTERVALS[state.interval][0] + ' · ' + (state.timezone === 'exchange' ? selected.zone : state.timezone) + ' · 圖內可縮放；以圖內實際週期為準' : '此市場的分鐘 K 線請至 TradingView 標的頁查看；本站不顯示其他股票的替代圖。';
    $('chart-range-note').textContent = canEmbedChart(selected) ? '顯示範圍可在圖內縮放' : '此市場的內嵌週期暫不可用';
    $('chart-refresh-status').textContent = !state.allowed ? '圖表在取得同意後由 TradingView 載入' : canEmbedChart(selected) ? '資料由 TradingView 提供；延遲與交易時段以圖內標示為準' : '此市場暫不內嵌 K 線；請開啟 TradingView 標的頁';
    $('consent-card').hidden = state.allowed;
    $('connection-bar').hidden = !state.allowed;
    document.querySelectorAll('[data-symbol]').forEach(button => {
      const active = button.dataset.symbol === state.symbol;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
      button.hidden = state.marketFilter !== 'all' && button.dataset.kind !== state.marketFilter;
    });
    document.querySelectorAll('[data-market-filter]').forEach(button => {
      const active = button.dataset.marketFilter === state.marketFilter;
      button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-interval]').forEach(button => {
      const active = button.dataset.interval === state.interval;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
      button.disabled = !canEmbedChart(selected);
    });
    $('research-consent').checked = state.researchConsent;
    $('analysis-mode').value = state.analysisMode;
    $('analysis-mode').disabled = state.busy;
    $('ai-debate').disabled = state.analysisMode === 'agents' || state.busy;
    const ownKey = $('own-api-key').value.trim();
    const keyReady = state.keySource === 'own' ? /^[A-Za-z0-9._~-]{20,256}$/.test(ownKey) : state.sharedAi;
    $('own-key-fields').hidden = state.keySource !== 'own';
    document.querySelectorAll('input[name="gemini-source"]').forEach(input => { input.checked = input.value === state.keySource; });
    $('run-analysis').disabled = state.busy || !state.researchConsent || !state.serviceReady || !keyReady;
    $('run-analysis').textContent = state.busy ? 'AI 深度評估中…' : !state.serviceReady ? '公開研究服務尚不可用' : !keyReady && state.keySource === 'own' ? '請輸入有效的 Gemini API key' : !keyReady ? '站方額度尚未啟用' : state.analysisMode === 'agents' ? '執行多角色研究 ↗' : 'AI 深度評估 ↗';
    $('service-notice').hidden = !state.servicePaused && (!state.serviceChecked || state.serviceReady);
    if (state.servicePaused) {
      $('service-state').textContent = '研究主機離線'; setTone($('service-state'),'error');
    } else if (!configuredApi) {
      $('service-state').textContent = '公開研究服務部署中'; setTone($('service-state'), 'neutral');
      $('analysis-status').textContent = '服務尚未設定'; setTone($('analysis-status'), 'neutral');
    } else if (!state.serviceChecked) {
      $('service-state').textContent = '研究服務檢查中'; setTone($('service-state'), 'neutral');
    } else if (!state.serviceReady) {
      $('service-state').textContent = '研究服務暫不可用'; setTone($('service-state'), 'error');
    } else {
      $('service-state').textContent = '公開研究服務可使用'; setTone($('service-state'), 'ready');
    }
  }

  function clearResearch() {
    state.researchRequest += 1;
    state.researchAbort?.abort();
    state.researchAbort = null;
    clearInterval(state.researchTimer);
    state.researchTimer = null;
    $('analysis-progress').hidden = true;
    state.busy = false;
    state.lastResearch = null;
    $('analysis').replaceChildren(element('div', 'analysis-empty', '請依目前標的與 K 線週期重新執行 AI 深度評估。'));
    $('analysis-error').textContent = '';
    $('analysis-status').textContent = '等待新評估'; setTone($('analysis-status'), 'neutral');
    $('metric-price').textContent = '—'; $('metric-source').textContent = '執行研究後顯示來源與時間'; $('metric-freshness').textContent = '等待資料';
    $('metric-rule').textContent = '等待評估'; setTone($('metric-rule'), 'neutral'); $('metric-score').textContent = '未產生分數';
    $('metric-ai').textContent = '待啟動'; setTone($('metric-ai'), 'neutral'); $('metric-ai-detail').textContent = '不公開 API key';
    $('metric-news').textContent = '待確認'; setTone($('metric-news'), 'neutral'); $('metric-news-detail').textContent = '不重製快訊全文';
    $('strategy-svg').replaceChildren(svg('rect', { width: 1000, height: 260, fill: '#111923' }));
    $('strategy-badge').textContent = '等待研究'; setTone($('strategy-badge'), 'neutral');
    $('strategy-message').textContent = '依目前標的與週期重新研究後，才會顯示對應的條件走線。';
    $('strategy-cards').replaceChildren(element('div', 'strategy-no-plan', '目前沒有對應這個標的與週期的策略價位。'));
    $('strategy-time').textContent = '尚無研究時間';
    renderDailyOnly();
    updateControls();
  }

  function widgetError(root, kind, detail) {
    if (!root.isConnected || !state.allowed) return;
    const box = element('div', 'widget-error');
    box.append(element('p', '', detail));
    const retry = element('button', 'button subtle', '重新載入來源');
    retry.addEventListener('click', () => { disposeSlot(kind); renderWidgets(); });
    const link = element('a', 'text-button', '直接開啟選定標的 ↗');
    link.href = kind === 'overview' ? 'https://www.tradingview.com/markets/' : chartURL();
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    box.append(retry, link); root.replaceChildren(box);
    if (kind === 'chart') $('chart-refresh-status').textContent = '外部圖表來源暫時無法載入，可直接開啟來源圖表';
  }

  function unsupportedWidget(kind) {
    disposeSlot(kind);
    const root = $(kind + '-widget'), box = element('div', 'widget-placeholder');
    const label = kind === 'chart' ? 'K 線' : '新聞';
    box.append(element('div', 'placeholder-art', '↗'), element('strong', '', asset().name + '的 ' + label + '請至 TradingView 查看'),
      element('p', '', '此交易所未列於本站已驗證的免費內嵌市場。為避免顯示其他股票的資料，這裡不載入 TradingView 元件。'));
    const link = element('a', 'button subtle', '開啟' + asset().name + '的標的頁 ↗');
    link.href = chartURL(); link.target = '_blank'; link.rel = 'noopener noreferrer';
    box.append(link); root.replaceChildren(box);
  }

  function disposeSlot(kind) {
    const prior = slots.get(kind);
    if (!prior) return;
    clearTimeout(prior.timeout);
    prior.observer.disconnect();
    slots.delete(kind);
  }

  function mount(kind, settings, title) {
    if (!state.allowed || !Object.hasOwn(PROVIDER_SCRIPTS, kind)) return;
    const key = JSON.stringify(settings);
    if (slots.get(kind)?.key === key) return;
    disposeSlot(kind);
    const root = $(kind + '-widget');
    root.replaceChildren();
    const wrapper = element('div', 'tradingview-widget-container');
    const content = element('div', 'tradingview-widget-container__widget');
    const attribution = element('div', 'tradingview-widget-copyright');
    const source = element('a', '', title + ' — TradingView');
    source.href = kind === 'overview' ? 'https://www.tradingview.com/markets/' : chartURL(); source.target = '_blank'; source.rel = 'noopener noreferrer';
    attribution.append(source); wrapper.append(content, attribution); root.append(wrapper);
    const slot = { key, observer: null, timeout: null, loaded: false };
    slot.observer = new MutationObserver(() => {
      const frame = wrapper.querySelector('iframe');
      if (!frame) return;
      frame.title = title + '（TradingView 外部資料）'; frame.referrerPolicy = 'no-referrer';
      slot.observer.disconnect();
      frame.addEventListener('load', () => {
        clearTimeout(slot.timeout); slot.loaded = true;
        if (kind === 'chart' && root.contains(wrapper)) $('chart-refresh-status').textContent = '預設每根 K 線 ' + INTERVALS[state.interval][0] + ' · 圖表由 TradingView 提供，顯示範圍可在圖內縮放';
      }, { once: true });
    });
    slot.observer.observe(wrapper, { childList: true, subtree: true });
    slot.timeout = setTimeout(() => {
      slot.observer.disconnect();
      if (root.contains(wrapper)) widgetError(root, kind, '外部來源尚未回應，可能受網路或瀏覽器設定影響。');
    }, 25000);
    slots.set(kind, slot);
    const script = document.createElement('script');
    script.src = PROVIDER_SCRIPTS[kind]; script.async = true; script.type = 'text/javascript';
    script.textContent = JSON.stringify(settings);
    script.addEventListener('error', () => {
      clearTimeout(slot.timeout); slot.observer.disconnect();
      if (root.contains(wrapper)) widgetError(root, kind, '無法載入 TradingView。請檢查連線，或直接查看來源網站。');
    }, { once: true });
    wrapper.append(script);
  }

  function renderWidgets() {
    if (!state.allowed) return;
    if (canEmbedChart()) {
      mount('chart', { autosize: true, symbol: asset().chart, interval: INTERVALS[state.interval][1], timezone: state.timezone === 'exchange' ? asset().zone : state.timezone, theme: 'dark', style: '1', locale: 'zh_TW', allow_symbol_change: false, hide_top_toolbar: true, withdateranges: false, calendar: false, support_host: 'https://www.tradingview.com' }, '市場 K 線圖表');
      mount('news', { feedMode: 'symbol', symbol: asset().chart, colorTheme: 'dark', isTransparent: true, displayMode: 'regular', width: '100%', height: '100%', locale: 'zh_TW' }, '選定標的新聞');
    } else {
      unsupportedWidget('chart'); unsupportedWidget('news');
    }
    mount('overview', { colorTheme: 'dark', dateRange: '1D', showChart: true, locale: 'zh_TW', width: '100%', height: '100%', isTransparent: true, showSymbolLogo: true, showFloatingTooltip: true, tabs: [
      { title: '加密貨幣', symbols: [{ s: 'BINANCE:BTCUSDT', d: 'Bitcoin' }, { s: 'BINANCE:ETHUSDT', d: 'Ethereum' }, { s: 'BINANCE:SOLUSDT', d: 'Solana' }] },
      { title: '美國股票', symbols: [{ s: 'NASDAQ:AAPL', d: 'Apple' }, { s: 'NASDAQ:NVDA', d: 'NVIDIA' }, { s: 'NASDAQ:MSFT', d: 'Microsoft' }] }
    ] }, '美股與加密市場概覽');
  }

  function applyChartOptions() {
    saveOptions(); updateControls(); clearTimeout(renderTimer);
    renderTimer = setTimeout(renderWidgets, 160);
  }

  function allowExternal() {
    if (!state.allowed) { state.allowed = true; write(CONSENT_KEY, 'granted'); }
    const url = new URL(window.location.href); url.searchParams.delete('external'); window.history.replaceState(null, '', url);
    updateControls(); renderWidgets(); loadDailyLevels();
  }

  function revokeExternal() {
    state.allowed = false; remove(CONSENT_KEY); clearTimeout(renderTimer);
    slots.forEach((_, kind) => disposeSlot(kind));
    const url = new URL(window.location.href); url.searchParams.set('external', 'off'); window.location.replace(url.href);
  }

  function appendList(parent, heading, values) {
    if (!Array.isArray(values) || !values.length) return;
    const section = element('section', 'analysis-list');
    section.append(element('h3', '', heading));
    const list = element('ul');
    values.forEach(value => list.append(element('li', '', value)));
    section.append(list); parent.append(section);
  }

  function renderAnalysis(data) {
    const result = data.assessment || {};
    const market = data.market || {};
    if (market.dailyLevels) {
      state.dailySymbol = state.symbol; state.dailyLevels = market.dailyLevels;
      state.dailyChecked = true;
    }
    const root = $('analysis'); root.replaceChildren();
    const wrap = element('div', 'analysis-result');
    const action = result.action || 'WAIT';
    const banner = element('div', 'signal-banner ' + ({ LONG: 'long', SHORT: 'short', WAIT: 'wait' })[action]);
    const icon = element('span', 'signal-icon', action === 'LONG' ? '↗' : action === 'SHORT' ? '↘' : '—');
    const copy = element('div');
    copy.append(element('strong', '', actionText(action)));
    copy.append(element('p', '', result.summary || '未產生可驗證的 AI 摘要，保持觀望。'));
    banner.append(icon, copy); wrap.append(banner);
    if (market.priceAction) {
      const pa = market.priceAction;
      const details = element('details', 'analysis-list');
      details.append(element('summary', '', '價格行為結構診斷 · ' + (pa.gate === 'WAIT' ? '觀望閘門' : '交叉檢查')));
      const regime = { up: '上行', down: '下行', range: '高重疊區間', transition: '轉換中', unknown: '資料不足' }[pa.regime] || '未確認';
      const breakout = { up: '向上收盤突破', down: '向下收盤突破', failed_up: '上破後回落', failed_down: '下破後收回', up_probe: '上緣探測', down_probe: '下緣探測', none: '無明確突破' }[pa.breakout] || '未確認';
      details.append(element('p', '', '結構：' + regime + ' · 突破：' + breakout + ' · 近 10 根重疊 ' + Math.round(Number(pa.overlap10 || 0) * 100) + '%'));
      details.append(element('p', '', pa.reason || '僅供研究交叉檢查。'));
      details.append(element('small', '', '僅使用已收盤 K 線；不是 PA_Agent 原程式或已驗證的交易策略。'));
      wrap.append(details);
    }
    appendList(wrap, '研究理由', result.reasons);
    appendList(wrap, '風險與反證', result.risks);
    const invalidation = element('section', 'analysis-list');
    invalidation.append(element('h3', '', '失效與觀望條件'));
    invalidation.append(element('p', '', result.invalidation || '資料不足，保持觀望。'));
    wrap.append(invalidation);
    if (data.debate?.enabled) {
      const details = element('details', 'analysis-list');
      details.append(element('summary', '', '查看多空辯論與反證'));
      const grid = element('div', 'debate-grid');
      [['多方論點', data.debate.bull], ['空方論點', data.debate.bear]].forEach(([label, item]) => {
        const card = element('div', 'debate-card'); card.append(element('strong', '', label)); card.append(element('p', '', item?.thesis || '資料不足。')); card.append(element('small', '', '反證：' + (item?.counterpoint || '資料不足。'))); grid.append(card);
      });
      details.append(grid); wrap.append(details);
    }
    if (data.committee?.enabled) {
      const team = data.committee;
      const details = element('details', 'analysis-list'); details.open = true;
      details.append(element('summary', '', 'TradingAgents 流程精簡版 · ' + team.calls + ' 次模型呼叫'));
      const grid = element('div', 'debate-grid');
      [['技術分析員', team.market], ['事件分析員', team.news], ['多方研究員', team.bull], ['空方研究員', team.bear]].forEach(([name, item]) => {
        const card = element('div', 'debate-card');
        card.append(element('strong', '', name), element('p', '', item?.thesis || '資料不足'), element('small', '', '反證：' + (item?.counterpoint || '資料不足')));
        grid.append(card);
      });
      details.append(grid, element('p', '', '風控審核：' + actionText(team.judge?.action) + ' · ' + (team.judge?.summary || '未產生結論。')),
        element('small', '', '同一模型分角色審查；不含未提供的基本面、社群或個人持倉資料，並非原版 TradingAgents 框架。'));
      wrap.append(details);
    }
    const meta = element('p', 'analysis-meta', (data.mode === 'rules' ? '日線規則 · 未呼叫 AI' : data.mode === 'agents' ? '多角色研究' : '標準研究') + ' · 透明規則：' + actionText(result.ruleAction) + (data.mode === 'rules' ? ' · 事件未審核' : ' · 事件風險：' + (result.eventRisk || 'UNKNOWN')) + ' · 已完成日 K 開始：' + formatTime(market.barTime) + ' · 報價：' + formatTime(market.quoteTime));
    wrap.append(meta); root.append(wrap);
    $('analysis-status').textContent = actionText(action); setTone($('analysis-status'), ({ LONG: 'up', SHORT: 'down', WAIT: 'neutral' })[action]);
    $('metric-ai').textContent = actionText(action); setTone($('metric-ai'), ({ LONG: 'up', SHORT: 'down', WAIT: 'neutral' })[action]);
    $('metric-ai-detail').textContent = '事件風險：' + (result.eventRisk || 'UNKNOWN');
    $('metric-rule').textContent = actionText(result.ruleAction); setTone($('metric-rule'), ({ LONG: 'up', SHORT: 'down', WAIT: 'neutral' })[result.ruleAction]);
    $('metric-score').textContent = '證據分數 ' + (Number.isFinite(market.score) ? market.score : '—') + ' · 一致性非勝率';
    $('metric-price').textContent = formatNumber(market.price, market.currency || asset().currency);
    $('metric-source').textContent = (market.source || '資料來源未確認') + ' · 已收盤 K 線';
    $('metric-freshness').textContent = formatTime(market.quoteTime);
    $('metric-news').textContent = data.news?.available ? '已納入' : '暫未使用'; setTone($('metric-news'), data.news?.available ? 'up' : 'neutral');
    $('metric-news-detail').textContent = data.news?.available ? '受限事件資料 ' + data.news.count + ' 則 · ' + formatTime(data.news.fetchedAt) : '未提供可用事件脈絡';
    if (data.mode !== 'rules') {
    $('jin10-state').textContent = data.news?.available ? 'AI 事件脈絡已更新' : '來源暫不可用'; setTone($('jin10-state'), data.news?.available ? 'up' : 'neutral');
    $('jin10-note').textContent = data.news?.available ? '金十 MCP 事件資料已在本輪以受限方式提供給 AI，未傳回或重製快訊全文。資料時間：' + formatTime(data.news.fetchedAt) + '。' : '本輪未取得可用金十事件資料；AI 已以市場快照進行保守研究，事件風險會反映在結論中。';
    }
    drawStrategy(market, result, data.generatedAt);
  }

  function drawLine(canvas, points, color, dash = '') {
    const line = svg('polyline', { points: points.map(point => point.join(',')).join(' '), fill: 'none', stroke: color, 'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
    if (dash) line.setAttribute('stroke-dasharray', dash);
    canvas.append(line);
  }

  function renderDailyOnly() {
    if (state.lastResearch) return;
    if (state.rulesEnabled && state.rules?.market.symbol === state.symbol && Date.now()/1000-state.rules.generatedAt<=1200) { renderRules(); return; }
    const chart = $('strategy-svg');
    chart.replaceChildren(svg('rect', { width: 1000, height: 260, fill: '#111923' }));
    const cards = $('strategy-cards'); cards.replaceChildren();
    const daily = state.dailySymbol === state.symbol ? state.dailyLevels : null;
    if (!daily || !Number.isFinite(Number(daily.support)) || !Number.isFinite(Number(daily.resistance))) {
      $('strategy-badge').textContent = state.dailyChecked && state.dailySymbol === state.symbol ? '日線暫不可用' : '等待日線';
      setTone($('strategy-badge'), 'neutral');
      $('strategy-message').textContent = !state.allowed ? '同意載入市場資料後，即可查看 20 日支撐與壓力；AI 評估需另行手動執行。' : state.dailyChecked && state.dailySymbol === state.symbol ? '目前日線資料不足或來源限流，暫不顯示 20 日歷史水平線；稍後會自動再檢查。' : '正在檢查最近 20 根已完成日 K；AI 評估需另行手動執行。';
      cards.append(element('div', 'strategy-no-plan', '20 日支撐／壓力暫無可用完整日線，不會以分鐘 K 線替代。'));
      $('strategy-time').textContent = '尚無完整日線時間';
      chart.setAttribute('aria-label', '20 日日線資料尚未可用');
      return;
    }
    const support = Number(daily.support), resistance = Number(daily.resistance);
    const span = Math.max(resistance - support, Math.abs(resistance) * .01, 1);
    const lower = support - span * .25, upper = resistance + span * .25;
    const y = value => 220 - (value - lower) / (upper - lower) * 180;
    [['20 日壓力', resistance, '#ee9aa9', -9], ['20 日支撐', support, '#80d4a7', 16]].forEach(([label, value, color, offset]) => {
      const yy = y(Number(value));
      chart.append(svg('line', { x1: 98, y1: yy, x2: 942, y2: yy, stroke: color, 'stroke-width': 2, 'stroke-dasharray': '7 6' }));
      const text = svg('text', { x: 112, y: yy + offset, fill: color, 'font-size': 15 });
      text.textContent = label + ' ' + formatNumber(value, asset().currency);
      chart.append(text);
      const card = element('div', 'strategy-card ' + (label.includes('支撐') ? 'support' : 'resistance'));
      card.append(element('span', '', label), element('strong', '', formatNumber(value, asset().currency)), element('small', '', daily.basis + ' · ' + formatTime(daily.lastBarTime)));
      cards.append(card);
    });
    chart.setAttribute('aria-label', state.symbol + ' 最近 20 個完整日線的支撐與壓力');
    $('strategy-badge').textContent = '歷史 20 日'; setTone($('strategy-badge'), 'neutral');
    $('strategy-message').textContent = '水平線取最近 20 根已完成日 K 的最低價與最高價；只表示歷史區間，AI 方向與條件走線須另行研究。';
    $('strategy-time').textContent = '最後完整日 K：' + formatTime(daily.lastBarTime);
  }

  function renderRules() {
    const data = state.rules;
    if (!data || data.market.symbol !== state.symbol) return;
    const m = data.market;
    renderAnalysis({...data, mode:'rules', assessment:{action:m.ruleAction, ruleAction:m.ruleAction,
      summary: m.ruleAction === 'WAIT' ? '指標分歧、過熱或價格結構要求觀望。' : '日線趨勢與動能符合規則條件；尚未進行 AI 或新聞風險審核。',
      reasons:['EMA20 '+formatNumber(m.indicators.ema20,m.currency)+' · EMA50 '+formatNumber(m.indicators.ema50,m.currency),
        'RSI14 '+m.indicators.rsi14+' · 20 日動能 '+m.indicators.momentum20+'%',m.priceAction.reason],
      risks:['證據分數是指標一致性，不是勝率。'], invalidation:'行情過期、條件改變或失效價觸及時重新評估。'}});
    $('metric-ai').textContent = '尚未執行'; setTone($('metric-ai'),'neutral');
    $('metric-ai-detail').textContent = '規則計算不消耗 AI 額度';
    $('analysis-status').textContent = '日線規則引擎';
    $('metric-news').textContent = '未納入'; $('metric-news-detail').textContent = '規則引擎只使用行情資料';
  }

  async function loadDailyLevels() {
    if (!state.allowed || !configuredApi) return;
    if (state.servicePaused) { $('rules-status').textContent='研究主機離線；服務恢復後自動啟用規則。'; return; }
    const request = ++state.dailyRequest, symbol = state.symbol;
    const controller = new AbortController(), timeout = setTimeout(()=>controller.abort(),30000);
    state.dailyDue = Date.now() + 900000;
    $('rules-status').textContent = '正在更新已完成日線…';
    try {
      const result = await callResearch((state.rulesEnabled?'/v1/rules':'/v1/levels')+'?'+new URLSearchParams({symbol,kind:asset().kind}),{signal:controller.signal});
      if (request !== state.dailyRequest || symbol !== state.symbol) return;
      state.rules = result.market ? result : null;
      state.dailySymbol = symbol; state.dailyLevels = result.market?.dailyLevels || result.dailyLevels || null; state.dailyChecked = true;
      state.dailyDue = Date.now() + (state.rulesEnabled ? 900000 : 1800000);
      $('rules-status').textContent = state.rulesEnabled ? '已更新 · 已收盤日 K · 15 分鐘檢查 · 零 AI 呼叫' : '規則引擎已關閉；保留 20 日線';
      if (state.lastResearch && !state.busy && state.rules) {
        const old = state.lastResearch;
        if (Date.now()/1000-old.generatedAt>300 || old.market.barTime!==result.market.barTime || Math.abs(old.market.price-result.market.price)>result.market.indicators.atr14*.5) {
          clearResearch(); $('analysis-error').textContent = '先前 AI 快照已過期或行情變動，已回到最新規則；可手動重新研究。';
        }
      }
    } catch(error) {
      if (request !== state.dailyRequest || symbol !== state.symbol) return;
      state.rules=null;state.dailySymbol=symbol;state.dailyLevels=null;state.dailyChecked=true;state.dailyDue=Date.now()+900000;
      $('rules-status').textContent = (error instanceof Error?error.message:'行情暫不可用')+' · 15 分鐘後再檢查';
      if (state.lastResearch && !state.busy) clearResearch();
      if (!state.lastResearch) { $('analysis').replaceChildren(element('p','analysis-empty','規則資料暫不可用，已停止顯示先前的規則與價位。')); $('metric-rule').textContent='資料不足'; $('metric-score').textContent='等待有效資料'; $('metric-price').textContent='—'; }
    } finally { clearTimeout(timeout); }
    if (!state.lastResearch) renderDailyOnly();
  }

  function drawStrategy(market, assessment, generatedAt) {
    const current = Number(market.price);
    const levels = market.levels;
    const daily = market.dailyLevels;
    const action = assessment.action || 'WAIT';
    const chart = $('strategy-svg'); chart.replaceChildren();
    chart.setAttribute('aria-label', '公開研究的條件式策略走線');
    chart.append(svg('rect', { width: 1000, height: 260, fill: '#111923' }));
    const values = [...(levels ? [levels.entryLow, levels.entryHigh, levels.invalidation, levels.targetOne, levels.targetTwo, current] : [market.scenarios?.lower, market.scenarios?.middle, market.scenarios?.upper, current]), daily?.support, daily?.resistance];
    const numbers = values.map(Number).filter(Number.isFinite);
    if (!numbers.length) return;
    const lower = Math.min(...numbers); const upper = Math.max(...numbers); const padding = Math.max((upper - lower) * .18, Math.abs(current) * .005 || 1);
    const low = lower - padding; const high = upper + padding;
    const y = value => 220 - ((value - low) / Math.max(0.000001, high - low)) * 180;
    for (let index = 0; index < 5; index += 1) {
      const yy = 38 + index * 43; chart.append(svg('line', { x1: 84, y1: yy, x2: 950, y2: yy, stroke: '#243343', 'stroke-width': 1 }));
      const label = svg('text', { x: 73, y: yy + 4, 'text-anchor': 'end', fill: '#72889e', 'font-size': 11 }); label.textContent = formatNumber(high - (high - low) * index / 4, market.currency).replace(' ' + market.currency, ''); chart.append(label);
    }
    if (daily) {
      [['20 日壓力', daily.resistance, '#ee9aa9', -8], ['20 日支撐', daily.support, '#80d4a7', 15]].forEach(([label, value, color, offset]) => {
        const yy = y(Number(value));
        chart.append(svg('line', { x1: 98, y1: yy, x2: 942, y2: yy, stroke: color, 'stroke-width': 1.5, 'stroke-dasharray': '6 5', opacity: .85 }));
        const note = svg('text', { x: 590, y: yy + offset, fill: color, 'font-size': 11 });
        note.textContent = label + ' ' + formatNumber(value, market.currency);
        chart.append(note);
      });
    }
    const currentY = y(current);
    drawLine(chart, [[98, currentY], [330, currentY]], '#99c9ff');
    const currentText = svg('text', { x: 100, y: currentY - 9, fill: '#bcd9f7', 'font-size': 12 }); currentText.textContent = '參考價 ' + formatNumber(current, market.currency); chart.append(currentText);
    if (levels && action !== 'WAIT') {
      const entryY = y((Number(levels.entryLow) + Number(levels.entryHigh)) / 2);
      const targetY = y(levels.targetOne);
      const secondY = y(levels.targetTwo);
      const stopY = y(levels.invalidation);
      drawLine(chart, [[330, currentY], [520, entryY]], '#e5d38b', '7 6');
      drawLine(chart, [[520, entryY], [735, targetY], [890, secondY]], '#80d4a7');
      drawLine(chart, [[520, entryY], [690, stopY]], '#ee9aa9', '7 6');
      [['觀察區', entryY, '#e5d38b'], ['目標一', targetY, '#80d4a7'], ['目標二', secondY, '#80d4a7'], ['失效', stopY, '#ee9aa9']].forEach(([label, yy, color]) => {
        chart.append(svg('line', { x1: 810, y1: yy, x2: 942, y2: yy, stroke: color, 'stroke-width': 1, 'stroke-dasharray': '3 4' }));
        const text = svg('text', { x: 947, y: yy + 4, fill: color, 'font-size': 11 }); text.textContent = label; chart.append(text);
      });
    } else {
      const lowerY = y(market.scenarios?.lower || current); const upperY = y(market.scenarios?.upper || current);
      drawLine(chart, [[330, currentY], [620, currentY], [880, currentY]], '#e1c279', '7 6');
      chart.append(svg('line', { x1: 520, y1: lowerY, x2: 520, y2: upperY, stroke: '#768fa8', 'stroke-width': 2, 'stroke-dasharray': '4 5' }));
      const note = svg('text', { x: 540, y: upperY - 8, fill: '#9bb0c5', 'font-size': 11 }); note.textContent = '觀望：只顯示歷史波動情境'; chart.append(note);
    }
    const title = svg('text', { x: 98, y: 22, fill: '#8ea4b9', 'font-size': 11 }); title.textContent = '條件式走線 · ' + INTERVALS[state.interval][0] + ' · ' + state.symbol; chart.append(title);
    $('strategy-badge').textContent = actionText(action); setTone($('strategy-badge'), ({ LONG: 'long', SHORT: 'short', WAIT: 'wait' })[action]);
    $('strategy-message').textContent = action === 'WAIT' ? '規則與 AI 目前維持觀望，走線只呈現現價與歷史波動情境，不能解讀為價格預測。' : '方向、觀察區、條件目標與失效條件均從這一輪市場快照計算；價格變動、休市或事件風險改變後，應重新評估。';
    const cards = $('strategy-cards'); cards.replaceChildren();
    const addCard = (label, value, note, type) => {
      const card = element('div', 'strategy-card ' + (type || ''));
      const display = typeof value === 'string' ? value : formatNumber(value, market.currency);
      card.append(element('span', '', label), element('strong', '', display), element('small', '', note)); cards.append(card);
    };
    addCard('參考價', current, '資料快照', '');
    if (daily) {
      addCard('20 日支撐', daily.support, daily.basis + ' · ' + formatTime(daily.lastBarTime), 'support');
      addCard('20 日壓力', daily.resistance, daily.basis + ' · ' + formatTime(daily.lastBarTime), 'resistance');
    } else {
      addCard('20 日支撐／壓力', '暫無完整日線', '來源不足或日線尚未完成，不以分鐘 K 線替代。', '');
    }
    if (levels && action !== 'WAIT') {
      addCard('觀察區', String(formatNumber(levels.entryLow, market.currency) + ' – ' + formatNumber(levels.entryHigh, market.currency)), '需先確認行情與交易成本', 'entry');
      addCard('條件目標一', levels.targetOne, '非保證賣出價格', 'target');
      addCard('條件目標二', levels.targetTwo, '非保證賣出價格', 'target');
      addCard('失效條件', levels.invalidation, '不是自動停損單', 'stop');
    } else {
      addCard('偏空情境', market.scenarios?.lower, '10 日歷史波動參考', '');
      addCard('盤整參考', market.scenarios?.middle, '不是預測或機率', '');
      addCard('偏多情境', market.scenarios?.upper, '10 日歷史波動參考', '');
    }
    $('strategy-time').textContent = '研究時間：' + formatTime(generatedAt);
  }

  async function callResearch(path, options = {}) {
    if (state.servicePaused) throw new Error('公開後端因研究主機離線，請等候站方恢復服務；本機功能不受影響。');
    if (!configuredApi) throw new Error('公開研究服務尚未完成部署。');
    let answer;
    try { answer = await fetch(configuredApi + path, { mode: 'cors', credentials: 'omit', cache: 'no-store', ...options }); } catch { throw new Error('無法連線到公開研究服務，請稍後再試。'); }
    let data = {};
    try { data = await answer.json(); } catch { /* Sanitized fallback below. */ }
    if (!answer.ok) throw new Error(typeof data.error === 'string' ? data.error.slice(0, 240) : '公開研究服務暫時無法完成。');
    return data;
  }

  async function checkService(force = false) {
    if (!configuredApi || Date.now() - (state.lastServiceCheck || 0) < 30000 || (!force && Date.now()<state.serviceDue)) return;
    state.lastServiceCheck = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const answer = await fetch(configuredApi + '/v1/status', { mode: 'cors', credentials: 'omit', cache: 'no-store', signal: controller.signal });
      const status = answer.ok ? await answer.json() : {};
      state.serviceReady = answer.ok && status.ready === true;
      state.sharedAi = status.ai === true;
      if (state.serviceReady && state.servicePaused) { state.servicePaused=false;state.dailyDue=0;loadDailyLevels(); }
    } catch { state.serviceReady = false; state.sharedAi = false; }
    finally { clearTimeout(timeout); state.serviceChecked = true; state.servicePaused = !state.serviceReady; state.serviceDue=Date.now()+(state.serviceReady?900000:60000); updateControls(); }
  }

  async function runAnalysis() {
    $('analysis-error').textContent = '';
    if (!state.researchConsent) { $('analysis-error').textContent = '請先確認研究資料的使用方式。'; return; }
    if (!state.serviceReady) { $('analysis-error').textContent = '公開研究服務尚未就緒，請稍後再試。'; return; }
    const apiKey = state.keySource === 'own' ? $('own-api-key').value.trim() : null;
    if (state.keySource === 'own' && !/^[A-Za-z0-9._~-]{20,256}$/.test(apiKey)) { $('analysis-error').textContent = '請輸入有效的 Gemini API key。'; return; }
    if (state.keySource === 'shared' && !state.sharedAi) { $('analysis-error').textContent = '站方 AI 額度尚未啟用，請選擇自備金鑰。'; return; }
    const request = ++state.researchRequest;
    const controller = new AbortController();
    const symbol = state.symbol, interval = state.interval, mode = state.analysisMode, debate = mode === 'standard' && $('ai-debate').checked;
    state.researchAbort = controller;
    const timeout = setTimeout(() => controller.abort(), mode === 'agents' ? 190000 : debate ? 145000 : 80000);
    state.busy = true;
    state.researchStartedAt = performance.now();
    const progress = $('analysis-progress');
    const updateProgress = () => { progress.textContent = '研究請求已送出 · 已等待 ' + Math.floor((performance.now() - state.researchStartedAt) / 1000) + ' 秒' + (mode === 'agents' ? ' · 多角色研究需 5 次模型回應' : debate ? ' · 多空辯論需 3 次模型回應' : ''); };
    progress.hidden = false;
    updateProgress();
    state.researchTimer = setInterval(updateProgress, 1000);
    updateControls();
    $('analysis-status').textContent = '研究處理中'; setTone($('analysis-status'), 'neutral');
    try {
      const body = { symbol, kind:asset().kind, interval, mode, debate };
      if (apiKey !== null) body.apiKey = apiKey;
      const result = await callResearch('/v1/research', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      if (request !== state.researchRequest || symbol !== state.symbol || interval !== state.interval) return;
      if (result.market?.symbol !== symbol || result.market?.interval !== interval) throw new Error('研究結果與目前標的或週期不符，請重新執行。');
      state.lastResearch = result; renderAnalysis(result);
    } catch (error) {
      if (request !== state.researchRequest) return;
      $('analysis-error').textContent = controller.signal.aborted ? '研究等候逾時，請稍後重試。' : error instanceof Error ? error.message : '公開研究服務暫時無法完成。';
      $('analysis-status').textContent = '未產生結論'; setTone($('analysis-status'), 'neutral');
    } finally {
      clearTimeout(timeout);
      if (request === state.researchRequest) {
        clearInterval(state.researchTimer); state.researchTimer = null;
        progress.hidden = true;
        state.researchAbort = null; state.busy = false; updateControls();
      }
    }
  }

  async function refreshNewsStatus() {
    if (!state.researchConsent) { $('jin10-state').textContent = '需研究同意'; $('jin10-note').textContent = '請先在 AI 研究區確認資料使用方式，再檢查金十 MCP 是否可供 AI 使用。官方新聞連結不需要這項同意。'; return; }
    const button = $('refresh-news');
    if (button.disabled) return;
    button.disabled = true; button.textContent = '檢查中…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35000);
    try {
      const data = await callResearch('/v1/news', { signal: controller.signal });
      $('jin10-state').textContent = data.available ? 'AI 事件脈絡可使用' : '來源暫不可用'; setTone($('jin10-state'), data.available ? 'up' : 'neutral');
      $('jin10-note').textContent = data.available ? '金十 MCP 可供受限 AI 研究使用；目前 ' + data.count + ' 則事件脈絡，時間：' + formatTime(data.fetchedAt) + '。公開頁面不重製快訊全文。' : '金十 MCP 公開研究來源目前暫不可用；圖表與 TradingView 新聞仍可依你的同意載入。';
    } catch (error) { $('jin10-state').textContent = '檢查失敗'; setTone($('jin10-state'), 'neutral'); $('jin10-note').textContent = controller.signal.aborted ? '事件資料檢查逾時，請稍後重試。' : error instanceof Error ? error.message : '無法確認金十公開研究來源。'; }
    finally { clearTimeout(timeout); button.disabled = false; button.textContent = '檢查 AI 來源'; }
  }

  $('allow-external').addEventListener('click', allowExternal);
  document.querySelectorAll('[data-allow-external]').forEach(button => button.addEventListener('click', allowExternal));
  $('revoke-external').addEventListener('click', revokeExternal);
  $('privacy-revoke').addEventListener('click', revokeExternal);
  $('clear-preferences').addEventListener('click', () => {
    remove(OPTIONS_KEY); state.watchlist = [...DEFAULT_WATCHLIST]; state.symbol = 'BTCUSDT'; state.interval = '15m'; state.timezone = 'Asia/Taipei'; state.marketFilter = 'all'; state.rulesEnabled = true;
    for (const symbol of Object.keys(customAssets)) {delete customAssets[symbol];delete ASSETS[symbol];}
    window.dispatchEvent(new Event('marketpilot:asset')); clearResearch(); renderWatchlist(); renderWatchManager(); loadDailyLevels();
    $('privacy-status').textContent = '已清除本站圖表與自選標的偏好，並恢復預設。外部資料同意狀態維持不變。'; renderWidgets();
  });
  document.querySelectorAll('[data-market-filter]').forEach(button => button.addEventListener('click', () => { state.marketFilter = button.dataset.marketFilter; saveOptions(); renderWatchlist(); }));
  $('asset-kind').addEventListener('change',()=>{$('asset-symbol-input').placeholder=$('asset-kind').value === 'crypto' ? '例如 DOGEUSDT' : '例如 MSFT';});
  $('asset-add-form').addEventListener('submit',async event=>{
    event.preventDefault(); const symbol=$('asset-symbol-input').value.toUpperCase().trim(), kind=$('asset-kind').value;
    const status=$('asset-add-status'), button=$('asset-add-button');
    status.textContent='';
    if (state.watchlist.includes(symbol)) {status.textContent='這個標的已在自選清單。';return;}
    if (state.watchlist.length >= 16) {status.textContent='最多追蹤 16 個標的；請先移除一個。';return;}
    if (kind === 'crypto' ? !/^[A-Z0-9]{2,16}USDT$/.test(symbol) : !/^[A-Z0-9^][A-Z0-9.^-]{0,19}$/.test(symbol)) {status.textContent='請輸入完整有效代號，例如 DOGEUSDT、MSFT 或 2454.TW。';return;}
    if (Object.hasOwn(ASSETS,symbol) && ASSETS[symbol].kind === kind) {
      state.watchlist.push(symbol); state.marketFilter='all'; selectSymbol(symbol); saveOptions(); renderWatchlist(); renderWatchManager();
      $('asset-symbol-input').value='';status.textContent='已加入 '+symbol+'。';return;
    }
    if (!state.allowed) {status.textContent='請先同意載入市場資料，再驗證新標的。';return;}
    button.disabled=true;button.textContent='驗證中…';status.textContent='正在確認標的與歷史日線；可能需要數秒。';
    try {
      const data=await callResearch('/v1/assets/lookup?'+new URLSearchParams({symbol,kind}));
      if (data.symbol !== symbol || data.kind !== kind || typeof data.chart !== 'string' || !/^[A-Z0-9.:^-]{1,45}$/.test(data.chart) ||
        typeof data.label !== 'string' || !data.label || data.label.length>80 || typeof data.currency !== 'string' || !/^[A-Z]{3,4}$/.test(data.currency) ||
        typeof data.zone !== 'string' || data.zone.length>60) throw new Error('市場來源回傳的標的資料格式不符。');
      const entry={name:data.label,badge:symbol,market:kind === 'crypto' ? 'Binance · 加密貨幣現貨' : '全球股票 · 自選',chart:data.chart,kind,currency:data.currency,zone:data.zone};
      ASSETS[symbol]=entry;customAssets[symbol]={symbol,...entry};state.watchlist.push(symbol);state.marketFilter='all';
      selectSymbol(symbol);saveOptions();renderWatchlist();renderWatchManager();$('asset-symbol-input').value='';status.textContent='已驗證並加入 '+symbol+'。';
    } catch(error) {status.textContent=error instanceof Error ? error.message : '無法驗證標的，請稍後再試。';}
    finally {button.disabled=false;button.textContent='驗證並加入';}
  });
  document.querySelectorAll('[data-interval]').forEach(button => button.addEventListener('click', () => { if (Object.hasOwn(INTERVALS, button.dataset.interval) && state.interval !== button.dataset.interval) { state.interval = button.dataset.interval; clearResearch(); applyChartOptions(); } }));
  $('timezone').addEventListener('change', event => { if (ZONES.includes(event.target.value)) { state.timezone = event.target.value; applyChartOptions(); if (state.lastResearch) renderAnalysis(state.lastResearch); else renderDailyOnly(); } });
  $('research-consent').addEventListener('change', event => { state.researchConsent = event.target.checked; if (!state.researchConsent) clearResearch(); else updateControls(); });
  $('ai-debate').addEventListener('change', clearResearch);
  $('analysis-mode').addEventListener('change', () => { state.analysisMode = $('analysis-mode').value === 'agents' ? 'agents' : 'standard'; clearResearch(); });
  document.querySelectorAll('input[name="gemini-source"]').forEach(input => input.addEventListener('change', () => {
    if (!input.checked) return;
    state.keySource = input.value === 'own' ? 'own' : 'shared';
    clearResearch();
    if (state.keySource === 'own') $('own-api-key').focus();
  }));
  $('own-api-key').addEventListener('input', () => { if (state.lastResearch || state.busy) clearResearch(); else updateControls(); });
  $('clear-own-key').addEventListener('click', () => { $('own-api-key').value = ''; clearResearch(); $('own-api-key').focus(); });
  window.addEventListener('pagehide', () => { $('own-api-key').value = ''; });
  $('rules-enabled').addEventListener('change',()=>{state.rulesEnabled=$('rules-enabled').checked;state.rules=null;saveOptions();clearResearch();loadDailyLevels();});
  $('refresh-rules').addEventListener('click',()=>{clearResearch();loadDailyLevels();});
  window.MarketPilotBacktest.mount({root:$('backtest-panel'),getAsset:()=>({symbol:state.symbol,...asset()}),allowed:()=>state.allowed,request:(body,signal)=>callResearch('/v1/backtest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal})});
  $('retry-service').addEventListener('click',async()=>{const button=$('retry-service');button.disabled=true;try{await checkService(true);}finally{button.disabled=false;}});
  $('run-analysis').addEventListener('click', runAnalysis);
  $('refresh-news').addEventListener('click', refreshNewsStatus);
  document.querySelectorAll('[data-dialog]').forEach(button => button.addEventListener('click', () => {if(button.dataset.dialog==='assets-dialog')renderWatchManager();$(button.dataset.dialog).showModal();}));
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  }));
  renderWatchlist();
  renderDailyOnly();
  checkService();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkService(); });
  if (configuredApi) setInterval(() => { if (!document.hidden) checkService(); }, 60000);
  if (configuredApi) setInterval(() => { if (!document.hidden) { if(state.lastResearch && !state.busy && Date.now()/1000-state.lastResearch.generatedAt>300) { clearResearch();$('analysis-error').textContent='先前 AI 快照超過 5 分鐘，請重新研究。'; } if(state.allowed && !state.servicePaused && Date.now()>=state.dailyDue)loadDailyLevels(); } }, 15000);
  if (state.allowed) { renderWidgets(); loadDailyLevels(); }
})();
