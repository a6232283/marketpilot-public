import {
  Asset,
  atr,
  Bar,
  completedDailyBars,
  ema,
  PUBLIC_ASSETS,
  PublicError,
  rsi,
  technicalAssessment,
} from "./core.ts";

export type DatedBar = Bar & { date: string };
export type BacktestConfig = {
  start: string;
  end: string;
  validationStart: string | null;
  strategy: string;
  direction: string;
  initial: number;
  feePct: number;
  slippagePct: number;
  shortApr: number;
  atrProtection: boolean;
  fastPeriod: number;
  slowPeriod: number;
  rsiPeriod: number;
  rsiLower: number;
  rsiUpper: number;
  breakoutPeriod: number;
  bbPeriod: number;
  bbStdDev: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  momentumPeriod: number;
  atrStopMult: number;
  atrTargetMult: number;
};
export const STRATEGIES = ["combined", "buyhold", "ema", "sma", "rsi", "breakout", "bollinger", "macd", "momentum"];
const PARAMS: Record<string, [number, number, number]> = {
  fastPeriod: [20, 2, 100], slowPeriod: [50, 3, 200],
  rsiPeriod: [14, 2, 50], rsiLower: [30, 5, 45], rsiUpper: [70, 55, 95],
  breakoutPeriod: [20, 5, 200], bbPeriod: [20, 5, 200], bbStdDev: [2, .5, 4],
  macdFast: [12, 2, 100], macdSlow: [26, 3, 200], macdSignal: [9, 2, 50],
  momentumPeriod: [60, 5, 200], atrStopMult: [1.5, .5, 10], atrTargetMult: [3, .5, 20],
};
const INTEGERS = new Set(["fastPeriod", "slowPeriod", "rsiPeriod", "breakoutPeriod", "bbPeriod", "macdFast", "macdSlow", "macdSignal", "momentumPeriod"]);
const DAY = 86400;
const dayStamp = (date: string) => Date.parse(date + "T00:00:00Z") / 1000;

export function normalizeBacktest(
  raw: unknown,
  now = Date.now() / 1000,
): BacktestConfig {
  const p = raw && typeof raw === "object"
    ? raw as Record<string, unknown>
    : {};
  const date = (name: string) => {
    const v = String(p[name] || "");
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(dayStamp(v)) ||
      new Date(dayStamp(v) * 1000).toISOString().slice(0, 10) !== v
    ) throw new PublicError("請輸入有效的開始與結束日期。");
    return v;
  };
  const start = date("start"), end = date("end");
  const validationStart = p.validationStart ? date("validationStart") : null;
  if (
    start < "2000-01-01" || dayStamp(start) >= dayStamp(end) ||
    dayStamp(end) >= Math.floor(now / DAY) * DAY ||
    dayStamp(end) - dayStamp(start) > 1830 * DAY
  ) {
    throw new PublicError(
      "回測需至少兩天、最長五年，結束日不得晚於 UTC 昨日。",
    );
  }
  if (validationStart && !(start < validationStart && validationStart < end)) {
    throw new PublicError("樣本外驗證起點必須位於開始與結束日期之間。");
  }
  const number = (name: string, fallback: number, min: number, max: number) => {
    const value = p[name] === undefined ? fallback : p[name];
    if (
      typeof value !== "number" || !Number.isFinite(value) || value < min ||
      value > max
    ) throw new PublicError("回測金額或成本設定超出範圍。");
    return value;
  };
  const strategy = String(p.strategy || "combined"),
    direction = String(p.direction || "long");
  if (
    !STRATEGIES.includes(strategy) || !["long", "both"].includes(direction) ||
    (p.atrProtection !== undefined && typeof p.atrProtection !== "boolean")
  ) throw new PublicError("回測策略設定不正確。");
  const params = Object.fromEntries(Object.entries(PARAMS).map(([name, [fallback, min, max]]) => {
    const value = number(name, fallback, min, max);
    if (INTEGERS.has(name) && !Number.isInteger(value)) throw new PublicError("策略週期必須為整數。");
    return [name, value];
  })) as Record<string, number>;
  if (params.fastPeriod >= params.slowPeriod || params.macdFast >= params.macdSlow || params.rsiLower >= 50 || params.rsiUpper <= 50 || params.rsiLower >= params.rsiUpper) {
    throw new PublicError("策略週期或門檻設定不正確；快線需短於慢線，RSI 門檻需分列 50 兩側。");
  }
  return {
    start,
    end,
    validationStart,
    strategy,
    direction: strategy === "buyhold" ? "long" : direction,
    initial: number("initial", 10000, 100, 1e9),
    feePct: number("feePct", .1, 0, 2),
    slippagePct: number("slippagePct", .05, 0, 2),
    shortApr: number("shortApr", 5, 0, 100),
    atrProtection: strategy === "buyhold" ? false : p.atrProtection !== false,
    ...params as Omit<BacktestConfig, "start" | "end" | "validationStart" | "strategy" | "direction" | "initial" | "feePct" | "slippagePct" | "shortApr" | "atrProtection">,
  };
}

export function validationResults(rawBars: DatedBar[], cfg: BacktestConfig) {
  const cut = cfg.validationStart;
  if (!cut) return null;
  const before = rawBars.filter(b => b.date >= cfg.start && b.date < cut);
  const after = rawBars.filter(b => b.date >= cut && b.date <= cfg.end);
  if (before.length < 2 || after.length < 2) {
    throw new PublicError("樣本外切點兩側各需至少兩根完整交易日 K。");
  }
  const training = simulate(rawBars, {...cfg, end:before.at(-1)!.date, validationStart:null});
  const testing = simulate(rawBars, {...cfg, start:after[0].date, validationStart:null});
  const compact = (result: ReturnType<typeof simulate>) => ({
    actualStart:result.actualStart, actualEnd:result.actualEnd,
    bars:result.bars, summary:result.summary,
  });
  return {cutoff:cut, training:compact(training), testing:compact(testing),
    note:"驗證區間使用切點前資料暖機；切點當日重設資金與部位。若曾依驗證結果調參，該區間不再是未碰過的樣本。"};
}

export function warmupBars(cfg: BacktestConfig) {
  if (cfg.strategy === "buyhold") return 0;
  const key: Record<string, keyof BacktestConfig> = {ema:"slowPeriod",sma:"slowPeriod",rsi:"rsiPeriod",breakout:"breakoutPeriod",bollinger:"bbPeriod",macd:"macdSlow",momentum:"momentumPeriod"};
  const period = key[cfg.strategy] ? Number(cfg[key[cfg.strategy]]) : 0;
  return Math.max(60, period + (cfg.strategy === "macd" ? cfg.macdSignal : 1));
}

export async function dailyHistory(
  symbol: string,
  asset: Asset,
  start: string,
  end: string,
  fetcher: (url: string) => Promise<unknown>,
) {
  const startTime = dayStamp(start) - 400 * DAY, endTime = dayStamp(end) + DAY;
  let rows: unknown[] = [], zone = "Etc/UTC", sessionEnd: number | undefined;
  if (asset.kind === "crypto") {
    let cursor = startTime * 1000;
    for (let page = 0; page < 4 && cursor < endTime * 1000; page++) {
      const response = await fetcher(
        "https://data-api.binance.vision/api/v3/klines?" +
          new URLSearchParams({
            symbol,
            interval: "1d",
            limit: "1000",
            startTime: String(cursor),
            endTime: String(endTime * 1000 - 1),
          }),
      );
      if (!Array.isArray(response)) {
        throw new PublicError("歷史行情格式不符。", 502);
      }
      if (!response.length) break;
      rows.push(
        ...response.map((r) => ({
          time: Number(r[0]) / 1000,
          open: r[1],
          high: r[2],
          low: r[3],
          close: r[4],
          volume: r[5],
        })),
      );
      const next = Number(response.at(-1)[0]) + DAY * 1000;
      if (!Number.isFinite(next) || next <= cursor) {
        throw new PublicError("歷史行情分頁時間異常。", 502);
      }
      cursor = next;
      if (response.length < 1000) break;
    }
  } else {
    const payload = await fetcher(
      "https://query1.finance.yahoo.com/v8/finance/chart/" +
        encodeURIComponent(symbol) + "?" +
        new URLSearchParams({
          interval: "1d",
          period1: String(startTime),
          period2: String(endTime),
          includePrePost: "false",
          events: "div,splits",
        }),
    ) as any;
    const chart = payload?.chart?.result?.[0];
    if (!chart?.timestamp?.length) {
      throw new PublicError("來源沒有此日期範圍的日線。", 502);
    }
    const q = chart.indicators?.quote?.[0],
      adjusted = chart.indicators?.adjclose?.[0]?.adjclose;
    if (!q || !Array.isArray(adjusted)) {
      throw new PublicError("缺少股票還原權息價格，暫不回測。", 502);
    }
    zone = chart.meta?.exchangeTimezoneName || "Etc/UTC";
    sessionEnd = chart.meta?.currentTradingPeriod?.regular?.end;
    rows = chart.timestamp.map((time: number, i: number) => {
      const ratio = Number(adjusted[i]) / Number(q.close[i]);
      return {
        time,
        open: q.open[i] * ratio,
        high: q.high[i] * ratio,
        low: q.low[i] * ratio,
        close: adjusted[i],
        volume: q.volume[i],
      };
    });
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const bars = completedDailyBars(
    rows,
    asset.kind === "crypto" ? "crypto" : "stock",
    Date.now() / 1000,
    zone,
    sessionEnd,
  ).map((b) => ({ ...b, date: formatter.format(new Date(b.time * 1000)) }))
    .filter((b) => b.date <= end);
  if (
    asset.kind === "crypto" &&
    bars.some((b, i) => i > 0 && b.time - bars[i - 1].time !== DAY)
  ) throw new PublicError("歷史日 K 有缺漏，暫停回測以避免錯誤成交。", 502);
  return {
    bars,
    source: asset.kind === "crypto"
      ? "Binance 公開日 K"
      : "Yahoo Finance 還原權息日 K",
    zone,
    adjusted: asset.kind === "stock",
  };
}

export function strategySignal(history: Bar[], config: BacktestConfig | string, side: number) {
  const cfg = typeof config === "string" ? normalizeBacktest({start:"2023-01-01",end:"2023-01-03",strategy:config}, Date.parse("2024-01-01") / 1000) : config;
  const strategy = cfg.strategy;
  const bars = history.slice(-260), closes = bars.map((b) => b.close);
  if (strategy === "buyhold") return 1;
  if (bars.length < warmupBars(cfg)) return 0;
  if (strategy === "combined") {
    if (!(atr(bars)! > 0)) return 0;
    const action = technicalAssessment(
      bars,
      { ...PUBLIC_ASSETS.BTCUSDT, symbol: "BACKTEST" },
      "1d",
      closes.at(-1),
    ).ruleAction;
    return action === "LONG" ? 1 : action === "SHORT" ? -1 : 0;
  }
  if (strategy === "ema") {
    const delta = ema(closes, cfg.fastPeriod)! - ema(closes, cfg.slowPeriod)!;
    return Math.abs(delta) < 1e-8 ? 0 : Math.sign(delta);
  }
  if (strategy === "sma") {
    const mean = (period: number) => closes.slice(-period).reduce((a,b)=>a+b,0)/period;
    const delta = mean(cfg.fastPeriod)-mean(cfg.slowPeriod);
    return Math.abs(delta)<1e-8 ? 0 : Math.sign(delta);
  }
  if (strategy === "rsi") {
    const value = rsi(closes, cfg.rsiPeriod)!;
    if (value < cfg.rsiLower) return 1;
    if (value > cfg.rsiUpper) return -1;
    return side === 1 && value < 50 ? 1 : side === -1 && value > 50 ? -1 : 0;
  }
  if (strategy === "breakout") {
    const prior = bars.slice(-cfg.breakoutPeriod-1, -1), close = closes.at(-1)!;
    return close > Math.max(...prior.map((b) => b.high)) ? 1 : close < Math.min(...prior.map((b) => b.low)) ? -1 : side;
  }
  if (strategy === "bollinger") {
    const values = closes.slice(-cfg.bbPeriod), mean = values.reduce((a,b)=>a+b,0)/values.length;
    const deviation = Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/values.length);
    const lower = mean-cfg.bbStdDev*deviation, upper = mean+cfg.bbStdDev*deviation, close = closes.at(-1)!;
    if (close<lower) return 1;
    if (close>upper) return -1;
    return side===1 && close<mean ? 1 : side===-1 && close>mean ? -1 : 0;
  }
  if (strategy === "momentum") {
    const delta = closes.at(-1)!-closes.at(-cfg.momentumPeriod-1)!;
    return Math.abs(delta)<1e-8 ? 0 : Math.sign(delta);
  }
  if (strategy === "macd") {
    let fast=closes[0],slow=closes[0];
    const af=2/(cfg.macdFast+1),aslow=2/(cfg.macdSlow+1),diffs:number[]=[];
    for (const close of closes) {fast=close*af+fast*(1-af);slow=close*aslow+slow*(1-aslow);diffs.push(fast-slow);}
    const delta=diffs.at(-1)!-ema(diffs,cfg.macdSignal)!;
    return Math.abs(delta)<1e-8 ? 0 : Math.sign(delta);
  }
  return 0;
}

export function simulate(
  rawBars: DatedBar[],
  cfg: BacktestConfig,
  signal = strategySignal,
) {
  const bars = rawBars.filter((b) => b.date <= cfg.end);
  const first = bars.findIndex((b) => b.date >= cfg.start);
  const needed = warmupBars(cfg);
  if (first < needed) {
    throw new PublicError(
      `開始日前需要至少 ${needed} 根完整日 K 暖機；請選擇較晚日期或縮短週期。`,
    );
  }
  const selected = bars.slice(first);
  if (selected.length < 2) {
    throw new PublicError("選定範圍至少需要兩個有效交易日。");
  }
  const fee = cfg.feePct / 100, slip = cfg.slippagePct / 100;
  let cash = cfg.initial,
    peak = cash,
    maxDrawdown = 0,
    position: any = null,
    invested = 0,
    totalCosts = 0,
    skipped = 0;
  const trades: any[] = [], equity: any[] = [];
  const benchmarkQty = cfg.initial /
    (selected[0].open * (1 + slip) * (1 + fee));
  const closePosition = (base: number, date: string, reason: string) => {
    const p = position,
      exit = base * (1 - p.side * slip),
      exitFee = p.qty * exit * fee;
    const gross = p.side * p.qty * (exit - p.entry),
      net = gross - p.entryFee - exitFee - p.borrow;
    cash += gross - exitFee;
    totalCosts += exitFee;
    trades.push({
      entryDate: p.date,
      exitDate: date,
      direction: p.side === 1 ? "LONG" : "SHORT",
      entry: p.entry,
      exit,
      netPnl: net,
      returnPct: net / (p.qty * p.entry) * 100,
      costs: p.entryFee + exitFee + p.borrow,
      reason,
    });
    position = null;
  };
  for (let i = first; i < bars.length; i++) {
    const b = bars[i], prev = bars[i - 1] || b;
    let protectedExit = false;
    if (position?.side === -1) {
      const cost = position.qty * prev.close * cfg.shortApr / 100 *
        Math.max(0, b.time - prev.time) / (365 * DAY);
      cash -= cost;
      position.borrow += cost;
      totalCosts += cost;
    }
    if (position && cfg.atrProtection) {
      if (
        (position.side === 1 && b.open <= position.stop) ||
        (position.side === -1 && b.open >= position.stop)
      ) {
        closePosition(b.open, b.date, "開盤跳空停損");
        protectedExit = true;
      } else if (
        (position.side === 1 && b.open >= position.target) ||
        (position.side === -1 && b.open <= position.target)
      ) {
        closePosition(position.target, b.date, "開盤觸及目標");
        protectedExit = true;
      }
    }
    let target = signal(
      bars.slice(Math.max(0, i - 260), i),
      cfg,
      position?.side || 0,
    );
    if (cfg.direction === "long" && target === -1) target = 0;
    if (!protectedExit && position && target !== position.side) {
      closePosition(b.open, b.date, "前日訊號改變");
    }
    if (!protectedExit && !position && target !== 0 && cash > 0) {
      const entry = b.open * (1 + target * slip),
        qty = cash / (entry * (1 + fee)),
        entryFee = qty * entry * fee;
      const volatility = cfg.atrProtection ? atr(bars.slice(Math.max(0, i - 260), i))! : 0;
      if (
        cfg.atrProtection &&
        (!(volatility > 0) ||
          Math.min(
              entry - target * volatility * cfg.atrStopMult,
              entry + target * volatility * cfg.atrTargetMult,
            ) <= 0)
      ) skipped++;
      else {
        cash -= entryFee;
        totalCosts += entryFee;
        position = {
          side: target,
          entry,
          qty,
          entryFee,
          borrow: 0,
          date: b.date,
          stop: entry - target * volatility * cfg.atrStopMult,
          target: entry + target * volatility * cfg.atrTargetMult,
        };
      }
    }
    if (position) invested++;
    if (position && cfg.atrProtection) {
      const stopHit = position.side === 1
        ? b.low <= position.stop
        : b.high >= position.stop;
      const targetHit = position.side === 1
        ? b.high >= position.target
        : b.low <= position.target;
      if (stopHit) {
        closePosition(
          position.stop,
          b.date,
          targetHit ? "同日雙觸及，保守停損優先" : "ATR 停損",
        );
      } else if (targetHit) closePosition(position.target, b.date, "ATR 目標");
    }
    if (i === bars.length - 1 && position) {
      closePosition(b.close, b.date, "回測結束結算");
    }
    let value = cash +
      (position
        ? position.side * position.qty * (b.close - position.entry)
        : 0);
    if (value <= 0) {
      if (position) closePosition(b.close, b.date, "模擬資金耗盡");
      value = cash;
    }
    peak = Math.max(peak, value);
    const dd = (value / peak - 1) * 100;
    maxDrawdown = Math.min(maxDrawdown, dd);
    const benchmark = benchmarkQty * b.close *
      (i === bars.length - 1 || value <= 0 ? (1 - slip) * (1 - fee) : 1);
    equity.push({ date: b.date, equity: value, benchmark, drawdown: dd });
    if (value <= 0) break;
  }
  const final = equity.at(-1)!.equity,
    gains = trades.reduce((s, t) => s + Math.max(0, t.netPnl), 0),
    losses = -trades.reduce((s, t) => s + Math.min(0, t.netPnl), 0);
  const days=(dayStamp(equity.at(-1)!.date)-dayStamp(selected[0].date))/DAY;
  const annualized=final>0 && days>=30 ? (Math.pow(final/cfg.initial,365.25/days)-1)*100 : null;
  return {
    config: cfg,
    actualStart: selected[0].date,
    actualEnd: equity.at(-1)!.date,
    warmupBars: first,
    bars: equity.length,
    summary: {
      initial: cfg.initial,
      final,
      netReturn: (final / cfg.initial - 1) * 100,
      annualizedReturn: annualized,
      benchmarkReturn: (equity.at(-1)!.benchmark / cfg.initial - 1) * 100,
      maxDrawdown,
      tradeCount: trades.length,
      winRate: trades.length && cfg.strategy !== "buyhold"
        ? trades.filter((t) => t.netPnl > 0).length / trades.length * 100
        : null,
      profitFactor: losses && cfg.strategy !== "buyhold" ? gains / losses : null,
      totalCosts,
      exposurePct: invested / equity.length * 100,
    },
    equity,
    trades,
    warnings: [
      ...(skipped
        ? [`${skipped} 個進場訊號因 ATR 或保護價格無效而略過。`]
        : []),
      ...(final <= 0
        ? ["模擬資金已耗盡並停止；理論做空可能虧損超過初始本金，未將負值截斷。"]
        : []),
      "只回測日線規則；未重播當時新聞或 AI，也不代表 AI 策略績效。",
      "收盤訊號在下一根開盤成交；同日停損與目標都觸及時採停損優先。",
      "期末按最後收盤價結算並計成本；最大回撤按日末權益計算，未包含盤中極值。",
      ...(cfg.direction === "both"
        ? [
          "做空為 1 倍名目本金模擬；融券可得性、保證金追繳與真實資金費率未建模。",
        ]
        : []),
      ...(cfg.strategy === "buyhold" ? ["買進持有只有一筆期末交易，勝率與獲利因子不適合用來評估。"] : []),
      ...(selected[0].date > cfg.start || selected.at(-1)!.date < cfg.end
        ? ["實際交易日期依來源和休市日調整，請核對結果列出的範圍。"]
        : []),
    ],
  };
}
