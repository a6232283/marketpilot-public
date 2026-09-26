/**
 * Pure, provider-independent logic for the public Deno research service.
 * It deliberately accepts only the fixed public asset universe and never
 * accepts a visitor-provided URL, model name, tool name, account, or trading
 * instruction. A visitor may provide one Gemini key for the current request.
 */

export const MAX_NEWS_ITEMS = 6;

export const PUBLIC_ASSETS = Object.freeze({
  BTCUSDT: { kind: 'crypto', label: 'Bitcoin', currency: 'USDT', chart: 'BINANCE:BTCUSDT' },
  ETHUSDT: { kind: 'crypto', label: 'Ethereum', currency: 'USDT', chart: 'BINANCE:ETHUSDT' },
  SOLUSDT: { kind: 'crypto', label: 'Solana', currency: 'USDT', chart: 'BINANCE:SOLUSDT' },
  AAPL: { kind: 'stock', label: 'Apple', currency: 'USD', chart: 'NASDAQ:AAPL' },
  NVDA: { kind: 'stock', label: 'NVIDIA', currency: 'USD', chart: 'NASDAQ:NVDA' },
  '2330.TW': { kind: 'stock', label: '台積電', currency: 'TWD', chart: 'TWSE:2330' },
  '0700.HK': { kind: 'stock', label: '騰訊控股', currency: 'HKD', chart: 'HKEX:700' },
  '7203.T': { kind: 'stock', label: '豐田汽車', currency: 'JPY', chart: 'TSE:7203' }
});

export const INTERVALS = Object.freeze({
  '5m': { crypto: '5m', stock: '5m', label: '5 分鐘' },
  '15m': { crypto: '15m', stock: '15m', label: '15 分鐘' },
  '30m': { crypto: '30m', stock: '30m', label: '30 分鐘' },
  '1h': { crypto: '1h', stock: '1h', label: '1 小時' }
});

export const INTERVAL_SECONDS = Object.freeze({ '5m': 300, '15m': 900, '30m': 1800, '1h': 3600 });

export type Asset = (typeof PUBLIC_ASSETS)[keyof typeof PUBLIC_ASSETS];
export type Interval = keyof typeof INTERVALS;
export type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };

export class PublicError extends Error {
  status: number;
  retryAfter: number;

  constructor(message: string, status = 400, retryAfter = 0) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function asPositiveInt(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

export function safeModel(value: unknown) {
  const model = String(value || 'gemini-3.1-flash-lite');
  return /^[A-Za-z0-9._-]{1,120}$/.test(model) ? model : 'gemini-3.1-flash-lite';
}

export function clampText(value: unknown, maximum: number) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, maximum) : '';
}

export function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeResearchRequest(value: unknown) {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const symbol = typeof record.symbol === 'string' ? record.symbol.toUpperCase().trim() : '';
  const asset = PUBLIC_ASSETS[symbol as keyof typeof PUBLIC_ASSETS];
  const interval = typeof record.interval === 'string' ? record.interval : '';
  if (!asset || !Object.hasOwn(INTERVALS, interval)) {
    throw new PublicError('只支援精選標的與 5、15、30 分鐘或 1 小時週期。');
  }
  if (record.debate !== undefined && typeof record.debate !== 'boolean') {
    throw new PublicError('多空辯論設定格式不正確。');
  }
  let apiKey: string | null = null;
  if (record.apiKey !== undefined) {
    if (typeof record.apiKey !== 'string' || !/^[A-Za-z0-9._~-]{20,256}$/.test(record.apiKey)) {
      throw new PublicError('自備 Gemini API key 格式不正確。');
    }
    apiKey = record.apiKey;
  }
  return { symbol, asset, interval: interval as Interval, debate: record.debate === true, apiKey };
}

export function cleanBars(rows: unknown[]) {
  const byTime = new Map<number, Bar>();
  for (const row of rows) {
    const item = row && typeof row === 'object' ? row as Record<string, unknown> : {};
    const time = finiteNumber(item.time);
    const open = finiteNumber(item.open);
    const high = finiteNumber(item.high);
    const low = finiteNumber(item.low);
    const close = finiteNumber(item.close);
    const volume = finiteNumber(item.volume) ?? 0;
    if (![time, open, high, low, close, volume].every(Number.isFinite)) continue;
    if (Math.min(open!, high!, low!, close!) <= 0 || high! < Math.max(open!, close!, low!) || low! > Math.min(open!, close!, high!) || volume! < 0) continue;
    byTime.set(Math.trunc(time!), { time: Math.trunc(time!), open: open!, high: high!, low: low!, close: close!, volume: volume! });
  }
  return [...byTime.values()].sort((left, right) => left.time - right.time);
}

export function completedBars(rows: unknown[], interval: Interval, nowSeconds: number, sessionEnd?: number) {
  const step = INTERVAL_SECONDS[interval];
  const cutoff = Math.floor(nowSeconds) - 2;
  return cleanBars(rows).filter(bar => {
    const regularClose = bar.time + step;
    const end = Number.isFinite(sessionEnd) && sessionEnd! > bar.time && sessionEnd! < regularClose ? sessionEnd! : regularClose;
    return end <= cutoff;
  });
}

export function recentFlashes<T extends { published: number }>(items: T[], nowSeconds: number, maximumAgeSeconds = 24 * 3600) {
  const cutoff = nowSeconds - maximumAgeSeconds;
  return items.filter(item => Number.isFinite(item.published) && item.published >= cutoff && item.published <= nowSeconds + 120)
    .sort((left, right) => right.published - left.published).slice(0, MAX_NEWS_ITEMS);
}

export function publishedSeconds(value: unknown) {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value.trim())) return Number.NaN;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : Number.NaN;
}

function ema(values: number[], period: number) {
  if (values.length < period) return null;
  const multiplier = 2 / (period + 1);
  let result = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (const value of values.slice(period)) result += multiplier * (value - result);
  return result;
}

function rsi(values: number[], period = 14) {
  if (values.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1];
    gain += Math.max(change, 0);
    loss += Math.max(-change, 0);
  }
  gain /= period;
  loss /= period;
  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

function atr(bars: Bar[], period = 14) {
  if (bars.length <= period) return null;
  const ranges: number[] = [];
  for (let index = 1; index < bars.length; index += 1) {
    const current = bars[index];
    const previous = bars[index - 1];
    ranges.push(Math.max(current.high - current.low, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close)));
  }
  let result = ranges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (const value of ranges.slice(period)) result = (result * (period - 1) + value) / period;
  return result;
}

function priceDecimals(price: number) {
  if (price >= 1_000) return 2;
  if (price >= 1) return 4;
  return 8;
}

function rounded(value: number, price: number) {
  return Number(value.toFixed(priceDecimals(price)));
}

// Independent, bounded price-action lens. Only completed, ordered bars reach
// this function; it does not import PA_Agent code or its prompt library.
export function priceActionDiagnosis(bars: Bar[], atrValue: number) {
  if (bars.length < 42 || !Number.isFinite(atrValue) || atrValue <= 0) {
    return { gate: 'WAIT', regime: 'unknown', breakout: 'none', reason: '完整 K 線或波動資料不足。' };
  }
  const recent = bars.slice(-41);
  const last = recent.at(-1)!;
  const prior = recent.slice(-21, -1);
  const ceiling = Math.max(...prior.map(bar => bar.high));
  const floor = Math.min(...prior.map(bar => bar.low));
  const width = ceiling - floor;
  if (width <= 0) return { gate: 'WAIT', regime: 'unknown', breakout: 'none', reason: '區間寬度無效。' };
  const overlapValues = recent.slice(-11, -1).map((left, index) => {
    const right = recent.slice(-10)[index];
    const shared = Math.max(0, Math.min(left.high, right.high) - Math.max(left.low, right.low));
    return shared / Math.max(Math.min(left.high - left.low, right.high - right.low), 1e-12);
  });
  const overlap = overlapValues.reduce((sum, value) => sum + value, 0) / overlapValues.length;
  const move = (last.close - recent.at(-11)!.close) / atrValue;
  const regime = overlap >= 0.70 && Math.abs(move) < 1.2 ? 'range' : move >= 1.2 ? 'up' : move <= -1.2 ? 'down' : 'transition';
  const previous = recent.at(-2)!;
  const older = recent.slice(-22, -2);
  const olderHigh = Math.max(...older.map(bar => bar.high));
  const olderLow = Math.min(...older.map(bar => bar.low));
  const threshold = 0.1 * atrValue;
  let breakout = 'none';
  if (previous.close > olderHigh + threshold && last.close <= ceiling) breakout = 'failed_up';
  else if (previous.close < olderLow - threshold && last.close >= floor) breakout = 'failed_down';
  else if (last.close > ceiling + threshold) breakout = 'up';
  else if (last.close < floor - threshold) breakout = 'down';
  else if (last.high > ceiling + threshold && last.close <= ceiling) breakout = 'up_probe';
  else if (last.low < floor - threshold && last.close >= floor) breakout = 'down_probe';
  const gate = regime === 'range' || breakout.startsWith('failed_') ? 'WAIT' : 'REVIEW';
  const reason = regime === 'range' ? 'K 線重疊偏高，暫停方向推論。' : breakout.startsWith('failed_') ? '突破後回到區間，等待重新確認。' : '結構僅供交叉檢查，不單獨形成進場訊號。';
  return { gate, regime, breakout, rangePosition: Number(((last.close - floor) / width).toFixed(3)),
    overlap10: Number(overlap.toFixed(3)), move10Atr: Number(move.toFixed(3)), rangeHigh: ceiling,
    rangeLow: floor, barTime: last.time, reason };
}

export function technicalAssessment(bars: Bar[], asset: Asset & { symbol: string }, interval: Interval, quote: unknown) {
  const cleaned = cleanBars(bars);
  if (cleaned.length < 60) throw new PublicError('市場資料不足，暫不產生研究結論。', 502);
  const closes = cleaned.map(bar => bar.close);
  const supplied = finiteNumber(quote);
  const price = supplied !== null && supplied > 0 ? supplied : closes.at(-1)!;
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(cleaned, 14);
  const momentum = closes.at(-1)! / closes.at(-21)! - 1;
  if (![e20, e50, rsi14, atr14, momentum, price].every(Number.isFinite) || atr14! <= 0) {
    throw new PublicError('市場資料無法通過完整性檢查。', 502);
  }
  let score = 0;
  if (price > e20!) score += 1; else score -= 1;
  if (e20! > e50!) score += 1; else score -= 1;
  if (momentum > 0) score += 1; else score -= 1;
  if (rsi14! < 75 && rsi14! > 25) score += momentum >= 0 ? 1 : -1;
  const ruleAction = score >= 3 && rsi14! < 75 ? 'LONG' : score <= -3 && rsi14! > 25 ? 'SHORT' : 'WAIT';
  const levels = ruleAction === 'LONG' ? {
    entryLow: rounded(price - atr14! * 0.2, price), entryHigh: rounded(price + atr14! * 0.2, price),
    invalidation: rounded(price - atr14! * 1.5, price), targetOne: rounded(price + atr14! * 3, price), targetTwo: rounded(price + atr14! * 4.5, price)
  } : ruleAction === 'SHORT' ? {
    entryLow: rounded(price - atr14! * 0.2, price), entryHigh: rounded(price + atr14! * 0.2, price),
    invalidation: rounded(price + atr14! * 1.5, price), targetOne: rounded(price - atr14! * 3, price), targetTwo: rounded(price - atr14! * 4.5, price)
  } : null;
  const returns = closes.slice(-60).slice(1).map((value, index) => Math.log(value / closes.slice(-60)[index]));
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  const width = Math.sqrt(variance) * Math.sqrt(10);
  return {
    symbol: asset.symbol,
    label: asset.label,
    currency: asset.currency,
    interval,
    price: rounded(price, price),
    ruleAction,
    score,
    confidence: Math.min(100, Math.round(Math.abs(score) / 4 * 100)),
    priceAction: priceActionDiagnosis(cleaned, atr14!),
    indicators: {
      ema20: rounded(e20!, price), ema50: rounded(e50!, price), rsi14: Number(rsi14!.toFixed(1)), atr14: rounded(atr14!, price),
      momentum20: Number((momentum * 100).toFixed(2)), support20: rounded(Math.min(...cleaned.slice(-20).map(bar => bar.low)), price),
      resistance20: rounded(Math.max(...cleaned.slice(-20).map(bar => bar.high)), price)
    },
    levels,
    scenarios: { lower: rounded(price * Math.exp(-width), price), middle: rounded(price, price), upper: rounded(price * Math.exp(width), price) },
    barTime: cleaned.at(-1)!.time,
    barCount: cleaned.length
  };
}

export const ASSESSMENT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['LONG', 'SHORT', 'WAIT'] }, summary: { type: 'string' },
    reasons: { type: 'array', items: { type: 'string' } }, risks: { type: 'array', items: { type: 'string' } },
    invalidation: { type: 'string' }, event_risk: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'] },
    cited_source_ids: { type: 'array', items: { type: 'string' } }
  },
  required: ['action', 'summary', 'reasons', 'risks', 'invalidation', 'event_risk', 'cited_source_ids']
});

export const CASE_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    thesis: { type: 'string' }, counterpoint: { type: 'string' },
    event_risk: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'] }, cited_source_ids: { type: 'array', items: { type: 'string' } }
  },
  required: ['thesis', 'counterpoint', 'event_risk', 'cited_source_ids']
});

function safeList(value: unknown, maximum: number) {
  return Array.isArray(value) ? value.map(item => clampText(item, maximum)).filter(Boolean).slice(0, 3) : [];
}

function safeRisk(value: unknown) {
  return ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'].includes(String(value)) ? String(value) : 'UNKNOWN';
}

function safeCitations(value: unknown, sourceIds: Set<string>) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string' && sourceIds.has(item)).slice(0, MAX_NEWS_ITEMS) : [];
}

export function validateAssessment(value: unknown, sourceIds: Set<string>) {
  const item = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const action = ['LONG', 'SHORT', 'WAIT'].includes(String(item.action)) ? String(item.action) : 'WAIT';
  const eventRisk = safeRisk(item.event_risk);
  return {
    action: eventRisk === 'HIGH' || eventRisk === 'UNKNOWN' ? 'WAIT' : action,
    summary: clampText(item.summary, 500) || 'AI 沒有提供可驗證的摘要，保持觀望。',
    reasons: safeList(item.reasons, 360), risks: safeList(item.risks, 360),
    invalidation: clampText(item.invalidation, 500) || '資訊不足，保持觀望。',
    eventRisk, citedSourceIds: safeCitations(item.cited_source_ids, sourceIds)
  };
}

export function validateCase(value: unknown, sourceIds: Set<string>) {
  const item = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    thesis: clampText(item.thesis, 500) || '資料不足，無法建立此方向論點。',
    counterpoint: clampText(item.counterpoint, 500) || '資料不足，無法驗證反證。',
    eventRisk: safeRisk(item.event_risk), citedSourceIds: safeCitations(item.cited_source_ids, sourceIds)
  };
}

export function parseMcpPayload(raw: string, id: number) {
  const trimmed = raw.trim();
  const parse = (text: string) => {
    const item = JSON.parse(text);
    return item && typeof item === 'object' && (item as Record<string, unknown>).id === id ? item as Record<string, unknown> : null;
  };
  if (trimmed.startsWith('{')) {
    const direct = parse(trimmed);
    if (direct) return direct;
  }
  for (const block of trimmed.split(/\r?\n\r?\n/)) {
    const text = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
    if (!text) continue;
    const item = parse(text);
    if (item) return item;
  }
  throw new PublicError('金十回應格式不符。', 502);
}
