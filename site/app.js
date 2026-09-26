/* Public UI: no credentials, local service routes, account data, or trading controls. */
'use strict';
(() => {
  const CONSENT_KEY = 'marketpilot.public.external.v2';
  const OPTIONS_KEY = 'marketpilot.public.options.v2';
  const INTERVALS = Object.freeze({
    '5m': ['5 分鐘', '5'], '15m': ['15 分鐘', '15'], '30m': ['30 分鐘', '30'], '1h': ['1 小時', '60']
  });
  const ZONES = Object.freeze(['Asia/Taipei', 'Etc/UTC', 'exchange']);
  const ASSETS = Object.freeze({
    BTCUSDT: { name: 'Bitcoin', badge: 'BTC / USDT', market: 'Binance · 加密貨幣現貨', chart: 'BINANCE:BTCUSDT', kind: 'crypto', currency: 'USDT', zone: 'Etc/UTC' },
    ETHUSDT: { name: 'Ethereum', badge: 'ETH / USDT', market: 'Binance · 加密貨幣現貨', chart: 'BINANCE:ETHUSDT', kind: 'crypto', currency: 'USDT', zone: 'Etc/UTC' },
    SOLUSDT: { name: 'Solana', badge: 'SOL / USDT', market: 'Binance · 加密貨幣現貨', chart: 'BINANCE:SOLUSDT', kind: 'crypto', currency: 'USDT', zone: 'Etc/UTC' },
    NVDA: { name: 'NVIDIA', badge: 'NVDA', market: 'NASDAQ · 美國股票', chart: 'NASDAQ:NVDA', kind: 'stock', currency: 'USD', zone: 'America/New_York' },
    AAPL: { name: 'Apple', badge: 'AAPL', market: 'NASDAQ · 美國股票', chart: 'NASDAQ:AAPL', kind: 'stock', currency: 'USD', zone: 'America/New_York' },
    '2330.TW': { name: '台積電', badge: '2330', market: 'TWSE · 台灣股票', chart: 'TWSE:2330', kind: 'stock', currency: 'TWD', zone: 'Asia/Taipei' },
    '0700.HK': { name: '騰訊控股', badge: '0700', market: 'HKEX · 香港股票', chart: 'HKEX:700', kind: 'stock', currency: 'HKD', zone: 'Asia/Hong_Kong' },
    '7203.T': { name: '豐田汽車', badge: '7203', market: 'TSE · 日本股票', chart: 'TSE:7203', kind: 'stock', currency: 'JPY', zone: 'Asia/Tokyo' }
  });
  const PROVIDER_SCRIPTS = Object.freeze({
    chart: 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js',
    news: 'https://s3.tradingview.com/external-embedding/embed-widget-timeline.js',
    overview: 'https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js'
  });
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
      return value.protocol === 'https:' && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?[.]deno[.]dev$/i.test(value.hostname) ? value.origin : '';
    } catch { return ''; }
  })();
  let saved = {};
  try { saved = JSON.parse(read(OPTIONS_KEY) || '{}'); } catch { saved = {}; }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
  const state = {
    allowed: !forcedOff && read(CONSENT_KEY) === 'granted',
    symbol: Object.hasOwn(ASSETS, saved.symbol) ? saved.symbol : 'BTCUSDT',
    interval: Object.hasOwn(INTERVALS, saved.interval) ? saved.interval : '15m',
    timezone: ZONES.includes(saved.timezone) ? saved.timezone : 'Asia/Taipei',
    marketFilter: ['all', 'crypto', 'stock'].includes(saved.marketFilter) ? saved.marketFilter : 'all',
    researchConsent: false,
    busy: false,
    lastResearch: null,
    researchRequest: 0,
    researchAbort: null,
    serviceReady: false,
    serviceChecked: false
  };
  const slots = new Map();
  let renderTimer;

  function saveOptions() {
    write(OPTIONS_KEY, JSON.stringify({ symbol: state.symbol, interval: state.interval, timezone: state.timezone, marketFilter: state.marketFilter }));
  }

  function asset() { return ASSETS[state.symbol]; }
  function chartURL() { return 'https://www.tradingview.com/chart/?symbol=' + encodeURIComponent(asset().chart); }
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
    $('crumb-symbol').textContent = state.symbol;
    $('metric-symbol').textContent = selected.badge;
    const badge = element('span', '', selected.badge);
    badge.id = 'chart-symbol';
    $('chart-title').replaceChildren(document.createTextNode(selected.name + ' '), badge);
    $('chart-subtitle').textContent = selected.market;
    $('open-chart').href = chartURL();
    $('timezone').value = state.timezone;
    $('chart-selection').textContent = '預設每根 K 線 ' + INTERVALS[state.interval][0] + ' · ' + (state.timezone === 'exchange' ? selected.zone : state.timezone) + ' · 圖內可縮放；以圖內實際週期為準';
    $('chart-refresh-status').textContent = !state.allowed ? '圖表在取得同意後由 TradingView 載入' : '資料由 TradingView 提供；延遲與交易時段以圖內標示為準';
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
    });
    $('research-consent').checked = state.researchConsent;
    $('run-analysis').disabled = state.busy || !state.researchConsent || !state.serviceReady;
    $('run-analysis').textContent = state.busy ? 'AI 深度評估中…' : state.serviceReady ? 'AI 深度評估 ↗' : '公開研究服務尚不可用';
    if (!configuredApi) {
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
    updateControls();
  }

  function widgetError(root, kind, detail) {
    if (!root.isConnected || !state.allowed) return;
    const box = element('div', 'widget-error');
    box.append(element('p', '', detail));
    const retry = element('button', 'button subtle', '重新載入來源');
    retry.addEventListener('click', () => { disposeSlot(kind); renderWidgets(); });
    const link = element('a', 'text-button', '直接開啟 TradingView ↗');
    link.href = kind === 'chart' ? chartURL() : 'https://www.tradingview.com/markets/';
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    box.append(retry, link); root.replaceChildren(box);
    if (kind === 'chart') $('chart-refresh-status').textContent = '外部圖表來源暫時無法載入，可直接開啟來源圖表';
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
    source.href = kind === 'chart' ? chartURL() : 'https://www.tradingview.com/'; source.target = '_blank'; source.rel = 'noopener noreferrer';
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
    mount('chart', { autosize: true, symbol: asset().chart, interval: INTERVALS[state.interval][1], timezone: state.timezone === 'exchange' ? asset().zone : state.timezone, theme: 'dark', style: '1', locale: 'zh_TW', allow_symbol_change: false, hide_top_toolbar: true, withdateranges: false, calendar: false, support_host: 'https://www.tradingview.com' }, '市場 K 線圖表');
    mount('news', { feedMode: 'all_symbols', colorTheme: 'dark', isTransparent: true, displayMode: 'regular', width: '100%', height: '100%', locale: 'zh_TW' }, '市場新聞');
    mount('overview', { colorTheme: 'dark', dateRange: '1D', showChart: true, locale: 'zh_TW', width: '100%', height: '100%', isTransparent: true, showSymbolLogo: true, showFloatingTooltip: true, tabs: [
      { title: '加密貨幣', symbols: [{ s: 'BINANCE:BTCUSDT', d: 'Bitcoin' }, { s: 'BINANCE:ETHUSDT', d: 'Ethereum' }, { s: 'BINANCE:SOLUSDT', d: 'Solana' }] },
      { title: '美國股票', symbols: [{ s: 'NASDAQ:AAPL', d: 'Apple' }, { s: 'NASDAQ:NVDA', d: 'NVIDIA' }, { s: 'NASDAQ:MSFT', d: 'Microsoft' }] },
      { title: '全球股票', symbols: [{ s: 'TWSE:2330', d: '台積電' }, { s: 'HKEX:700', d: '騰訊控股' }, { s: 'TSE:7203', d: '豐田汽車' }] }
    ] }, '全球市場概覽');
  }

  function applyChartOptions() {
    saveOptions(); updateControls(); clearTimeout(renderTimer);
    renderTimer = setTimeout(renderWidgets, 160);
  }

  function allowExternal() {
    if (!state.allowed) { state.allowed = true; write(CONSENT_KEY, 'granted'); }
    const url = new URL(window.location.href); url.searchParams.delete('external'); window.history.replaceState(null, '', url);
    updateControls(); renderWidgets();
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
    const root = $('analysis'); root.replaceChildren();
    const wrap = element('div', 'analysis-result');
    const action = result.action || 'WAIT';
    const banner = element('div', 'signal-banner ' + ({ LONG: 'long', SHORT: 'short', WAIT: 'wait' })[action]);
    const icon = element('span', 'signal-icon', action === 'LONG' ? '↗' : action === 'SHORT' ? '↘' : '—');
    const copy = element('div');
    copy.append(element('strong', '', actionText(action)));
    copy.append(element('p', '', result.summary || '未產生可驗證的 AI 摘要，保持觀望。'));
    banner.append(icon, copy); wrap.append(banner);
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
    const meta = element('p', 'analysis-meta', '透明規則：' + actionText(result.ruleAction) + ' · 事件風險：' + (result.eventRisk || 'UNKNOWN') + ' · 資料時間：' + formatTime(data.generatedAt || market.fetchedAt));
    wrap.append(meta); root.append(wrap);
    $('analysis-status').textContent = actionText(action); setTone($('analysis-status'), ({ LONG: 'up', SHORT: 'down', WAIT: 'neutral' })[action]);
    $('metric-ai').textContent = actionText(action); setTone($('metric-ai'), ({ LONG: 'up', SHORT: 'down', WAIT: 'neutral' })[action]);
    $('metric-ai-detail').textContent = '事件風險：' + (result.eventRisk || 'UNKNOWN');
    $('metric-rule').textContent = actionText(result.ruleAction); setTone($('metric-rule'), ({ LONG: 'up', SHORT: 'down', WAIT: 'neutral' })[result.ruleAction]);
    $('metric-score').textContent = '證據分數 ' + (Number.isFinite(market.score) ? market.score : '—') + ' · 一致性非勝率';
    $('metric-price').textContent = formatNumber(market.price, market.currency || asset().currency);
    $('metric-source').textContent = market.source || '資料來源未確認';
    $('metric-freshness').textContent = formatTime(market.fetchedAt);
    $('metric-news').textContent = data.news?.available ? '已納入' : '暫未使用'; setTone($('metric-news'), data.news?.available ? 'up' : 'neutral');
    $('metric-news-detail').textContent = data.news?.available ? '受限事件資料 ' + data.news.count + ' 則 · ' + formatTime(data.news.fetchedAt) : '未提供可用事件脈絡';
    $('news-state').textContent = data.news?.available ? 'AI 事件脈絡已更新' : '金十資料暫不可用'; setTone($('news-state'), data.news?.available ? 'up' : 'neutral');
    $('jin10-note').textContent = data.news?.available ? '金十 MCP 事件資料已在本輪以受限方式提供給 AI，未傳回或重製快訊全文。資料時間：' + formatTime(data.news.fetchedAt) + '。' : '本輪未取得可用金十事件資料；AI 已以市場快照進行保守研究，事件風險會反映在結論中。';
    drawStrategy(market, result, data.generatedAt);
  }

  function drawLine(canvas, points, color, dash = '') {
    const line = svg('polyline', { points: points.map(point => point.join(',')).join(' '), fill: 'none', stroke: color, 'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
    if (dash) line.setAttribute('stroke-dasharray', dash);
    canvas.append(line);
  }

  function drawStrategy(market, assessment, generatedAt) {
    const current = Number(market.price);
    const levels = market.levels;
    const action = assessment.action || 'WAIT';
    const chart = $('strategy-svg'); chart.replaceChildren();
    chart.setAttribute('aria-label', '公開研究的條件式策略走線');
    chart.append(svg('rect', { width: 1000, height: 260, fill: '#111923' }));
    const values = levels ? [levels.entryLow, levels.entryHigh, levels.invalidation, levels.targetOne, levels.targetTwo, current] : [market.scenarios?.lower, market.scenarios?.middle, market.scenarios?.upper, current];
    const numbers = values.map(Number).filter(Number.isFinite);
    if (!numbers.length) return;
    const lower = Math.min(...numbers); const upper = Math.max(...numbers); const padding = Math.max((upper - lower) * .18, Math.abs(current) * .005 || 1);
    const low = lower - padding; const high = upper + padding;
    const y = value => 220 - ((value - low) / Math.max(0.000001, high - low)) * 180;
    for (let index = 0; index < 5; index += 1) {
      const yy = 38 + index * 43; chart.append(svg('line', { x1: 84, y1: yy, x2: 950, y2: yy, stroke: '#243343', 'stroke-width': 1 }));
      const label = svg('text', { x: 73, y: yy + 4, 'text-anchor': 'end', fill: '#72889e', 'font-size': 11 }); label.textContent = formatNumber(high - (high - low) * index / 4, market.currency).replace(' ' + market.currency, ''); chart.append(label);
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
    if (!configuredApi) throw new Error('公開研究服務尚未完成部署。');
    let answer;
    try { answer = await fetch(configuredApi + path, { mode: 'cors', credentials: 'omit', cache: 'no-store', ...options }); } catch { throw new Error('無法連線到公開研究服務，請稍後再試。'); }
    let data = {};
    try { data = await answer.json(); } catch { /* Sanitized fallback below. */ }
    if (!answer.ok) throw new Error(typeof data.error === 'string' ? data.error.slice(0, 240) : '公開研究服務暫時無法完成。');
    return data;
  }

  async function checkService() {
    if (!configuredApi || Date.now() - (state.lastServiceCheck || 0) < 30000) return;
    state.lastServiceCheck = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const answer = await fetch(configuredApi + '/v1/status', { mode: 'cors', credentials: 'omit', cache: 'no-store', signal: controller.signal });
      const status = answer.ok ? await answer.json() : {};
      state.serviceReady = answer.ok && status.ready === true;
    } catch { state.serviceReady = false; }
    finally { clearTimeout(timeout); state.serviceChecked = true; updateControls(); }
  }

  async function runAnalysis() {
    $('analysis-error').textContent = '';
    if (!state.researchConsent) { $('analysis-error').textContent = '請先確認研究資料的使用方式。'; return; }
    if (!state.serviceReady) { $('analysis-error').textContent = '公開研究服務尚未就緒，請稍後再試。'; return; }
    const request = ++state.researchRequest;
    const controller = new AbortController();
    const symbol = state.symbol, interval = state.interval, debate = $('ai-debate').checked;
    state.researchAbort = controller;
    const timeout = setTimeout(() => controller.abort(), debate ? 145000 : 80000);
    state.busy = true; updateControls();
    $('analysis-status').textContent = '研究處理中'; setTone($('analysis-status'), 'neutral');
    try {
      const result = await callResearch('/v1/research', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol, interval, debate }), signal: controller.signal });
      if (request !== state.researchRequest || symbol !== state.symbol || interval !== state.interval) return;
      if (result.market?.symbol !== symbol || result.market?.interval !== interval) throw new Error('研究結果與目前標的或週期不符，請重新執行。');
      state.lastResearch = result; renderAnalysis(result);
    } catch (error) {
      if (request !== state.researchRequest) return;
      $('analysis-error').textContent = controller.signal.aborted ? '研究等候逾時，請稍後重試。' : error instanceof Error ? error.message : '公開研究服務暫時無法完成。';
      $('analysis-status').textContent = '未產生結論'; setTone($('analysis-status'), 'neutral');
    } finally {
      clearTimeout(timeout);
      if (request === state.researchRequest) { state.researchAbort = null; state.busy = false; updateControls(); }
    }
  }

  async function refreshNewsStatus() {
    if (!state.researchConsent) { $('analysis-error').textContent = '請先確認研究資料的使用方式，再檢查金十公開研究來源。'; return; }
    const button = $('refresh-news');
    if (button.disabled) return;
    button.disabled = true; button.textContent = '檢查中…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35000);
    try {
      const data = await callResearch('/v1/news', { signal: controller.signal });
      $('news-state').textContent = data.available ? 'AI 事件脈絡可使用' : '金十資料暫不可用'; setTone($('news-state'), data.available ? 'up' : 'neutral');
      $('jin10-note').textContent = data.available ? '金十 MCP 可供受限 AI 研究使用；目前 ' + data.count + ' 則事件脈絡，時間：' + formatTime(data.fetchedAt) + '。公開頁面不重製快訊全文。' : '金十 MCP 公開研究來源目前暫不可用；圖表與 TradingView 新聞仍可依你的同意載入。';
    } catch (error) { $('jin10-note').textContent = controller.signal.aborted ? '事件資料檢查逾時，請稍後重試。' : error instanceof Error ? error.message : '無法確認金十公開研究來源。'; }
    finally { clearTimeout(timeout); button.disabled = false; button.textContent = '更新來源狀態'; }
  }

  $('allow-external').addEventListener('click', allowExternal);
  document.querySelectorAll('[data-allow-external]').forEach(button => button.addEventListener('click', allowExternal));
  $('revoke-external').addEventListener('click', revokeExternal);
  $('privacy-revoke').addEventListener('click', revokeExternal);
  $('clear-preferences').addEventListener('click', () => {
    remove(OPTIONS_KEY); state.symbol = 'BTCUSDT'; state.interval = '15m'; state.timezone = 'Asia/Taipei'; state.marketFilter = 'all';
    clearResearch(); $('privacy-status').textContent = '已清除本站圖表偏好並恢復預設。外部資料同意狀態維持不變。'; renderWidgets();
  });
  document.querySelectorAll('[data-symbol]').forEach(button => button.addEventListener('click', () => {
    if (!Object.hasOwn(ASSETS, button.dataset.symbol)) return;
    if (state.symbol === button.dataset.symbol) return;
    state.symbol = button.dataset.symbol; clearResearch(); applyChartOptions();
  }));
  document.querySelectorAll('[data-market-filter]').forEach(button => button.addEventListener('click', () => { state.marketFilter = button.dataset.marketFilter; saveOptions(); updateControls(); }));
  document.querySelectorAll('[data-interval]').forEach(button => button.addEventListener('click', () => { if (Object.hasOwn(INTERVALS, button.dataset.interval) && state.interval !== button.dataset.interval) { state.interval = button.dataset.interval; clearResearch(); applyChartOptions(); } }));
  $('timezone').addEventListener('change', event => { if (ZONES.includes(event.target.value)) { state.timezone = event.target.value; applyChartOptions(); if (state.lastResearch) renderAnalysis(state.lastResearch); } });
  $('research-consent').addEventListener('change', event => { state.researchConsent = event.target.checked; if (!state.researchConsent) clearResearch(); else updateControls(); });
  $('ai-debate').addEventListener('change', clearResearch);
  $('run-analysis').addEventListener('click', runAnalysis);
  $('refresh-news').addEventListener('click', refreshNewsStatus);
  document.querySelectorAll('[data-dialog]').forEach(button => button.addEventListener('click', () => $(button.dataset.dialog).showModal()));
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  }));
  updateControls();
  checkService();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkService(); });
  if (configuredApi) setInterval(() => { if (!document.hidden) checkService(); }, 60000);
  if (state.allowed) renderWidgets();
})();
