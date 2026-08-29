import type { ChartUnit } from "@/lib/chart-series";

export type CandlestickPeriod = ChartUnit;
export type MovingAverageWindow = 5 | 20 | 60;

export type SecurityCandleBar = Readonly<{
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}>;

export type CandlestickPlanOverlay = Readonly<{
  reviewBand?: Readonly<{ low: number; high: number; label: string }> | null;
  markers?: readonly Readonly<{
    id: string;
    price: number;
    label: string;
    tone?: "primary" | "warning" | "muted";
  }>[];
  stages?: readonly Readonly<{
    id: string;
    label: string;
    shareLabel: string;
    weightPct: number;
  }>[];
}>;

export type SecurityChartObservation = Readonly<{
  latestClose: number | null;
  movingAverage20: number | null;
  relativeVolume20: number | null;
  pricePosition: "ABOVE" | "BELOW" | "NEAR" | "UNAVAILABLE";
  priceText: string;
  volumeText: string;
  movingAverageText: string;
}>;

export type ChartPoint = SecurityCandleBar & {
  candleRange: number;
  ma5: number | null;
  ma20: number | null;
  ma60: number | null;
};

export const CHART_UNITS = ["MINUTE", "DAY", "WEEK", "MONTH", "YEAR"] as const;

export const MA_COLORS: Record<MovingAverageWindow, string> = {
  5: "#f79009",
  20: "#155eef",
  60: "#0e9384",
};

export const MARKER_COLORS = {
  primary: "#155eef",
  warning: "#dc6803",
  muted: "#667085",
} as const;

export function normalizeChartBars(
  bars: readonly SecurityCandleBar[],
): SecurityCandleBar[] {
  const byTimestamp = new Map<number, SecurityCandleBar>();
  for (const bar of bars) {
    if (!byTimestamp.has(bar.timestamp)) byTimestamp.set(bar.timestamp, bar);
  }
  return [...byTimestamp.values()].sort(
    (left, right) => left.timestamp - right.timestamp,
  );
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function movingAverageAt(
  bars: readonly SecurityCandleBar[],
  index: number,
  window: MovingAverageWindow,
): number | null {
  if (index + 1 < window) return null;
  return average(
    bars.slice(index + 1 - window, index + 1).map((bar) => bar.close),
  );
}

export function withMovingAverages(
  bars: readonly SecurityCandleBar[],
): ChartPoint[] {
  return bars.map((bar, index) => ({
    ...bar,
    candleRange: Math.max(bar.high - bar.low, bar.high * 0.00000001),
    ma5: movingAverageAt(bars, index, 5),
    ma20: movingAverageAt(bars, index, 20),
    ma60: movingAverageAt(bars, index, 60),
  }));
}

export function buildSecurityChartObservation(
  sourceBars: readonly SecurityCandleBar[],
): SecurityChartObservation {
  const bars = normalizeChartBars(sourceBars);
  const latest = bars.at(-1);
  const recentTwenty = bars.slice(-20);
  const ma20 =
    recentTwenty.length === 20
      ? average(recentTwenty.map((bar) => bar.close))
      : null;
  const previousTwenty = bars.slice(-21, -1);
  const averageVolume20 =
    previousTwenty.length === 20
      ? average(previousTwenty.map((bar) => bar.volume))
      : null;
  const relativeVolume =
    latest && averageVolume20 && averageVolume20 > 0
      ? latest.volume / averageVolume20
      : null;

  let pricePosition: SecurityChartObservation["pricePosition"] = "UNAVAILABLE";
  if (latest && ma20) {
    const differencePct = ((latest.close - ma20) / ma20) * 100;
    pricePosition =
      Math.abs(differencePct) < 0.25
        ? "NEAR"
        : differencePct > 0
          ? "ABOVE"
          : "BELOW";
  }

  const priceText =
    pricePosition === "ABOVE"
      ? "최근 가격이 20일 평균보다 위에 있습니다."
      : pricePosition === "BELOW"
        ? "최근 가격이 20일 평균보다 아래에 있습니다."
        : pricePosition === "NEAR"
          ? "최근 가격이 20일 평균과 비슷한 범위에 있습니다."
          : "20일 평균과 비교할 거래일 데이터가 충분하지 않습니다.";
  const volumeText =
    relativeVolume === null
      ? "거래량을 최근 평균과 비교할 데이터가 충분하지 않습니다."
      : relativeVolume > 1.05
        ? "최근 거래일 거래량은 이전 20개 거래일 평균보다 많습니다."
        : relativeVolume < 0.95
          ? "최근 거래일 거래량은 이전 20개 거래일 평균보다 적습니다."
          : "최근 거래일 거래량은 이전 20개 거래일 평균과 비슷합니다.";

  return {
    latestClose: latest?.close ?? null,
    movingAverage20: ma20,
    relativeVolume20: relativeVolume,
    pricePosition,
    priceText,
    volumeText,
    movingAverageText:
      "5일 평균은 최근 움직임에 빠르게 반응하고, 60일 평균은 더 긴 흐름을 천천히 보여줍니다.",
  };
}

export function safeChartDateTime(
  timestamp: number,
  unit: CandlestickPeriod,
  exchangeTimezone: string | null,
): string {
  const options: Intl.DateTimeFormatOptions =
    unit === "MINUTE"
      ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
      : unit === "YEAR"
        ? { year: "numeric" }
        : unit === "MONTH"
          ? { year: "numeric", month: "long" }
          : { year: "numeric", month: "short", day: "numeric" };
  if (exchangeTimezone) options.timeZone = exchangeTimezone;
  try {
    return new Intl.DateTimeFormat("ko-KR", options).format(
      new Date(timestamp * 1_000),
    );
  } catch {
    return new Intl.DateTimeFormat("ko-KR", {
      ...options,
      timeZone: "Asia/Seoul",
    }).format(new Date(timestamp * 1_000));
  }
}

export function formatChartPrice(value: number, currency: string | null): string {
  const formatted = new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: currency === "KRW" ? 0 : 2,
  }).format(value);
  return currency === "KRW"
    ? `${formatted}원`
    : currency
      ? `${formatted} ${currency}`
      : formatted;
}

export function formatCompactChartValue(value: number): string {
  return new Intl.NumberFormat("ko-KR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function calculateChartDomain(
  bars: readonly ChartPoint[],
  averageCost: number | null,
  overlay: CandlestickPlanOverlay | null | undefined,
  selectedAverages: ReadonlySet<MovingAverageWindow>,
): [number, number] {
  const values = bars.flatMap((bar) => [bar.low, bar.high]);
  if (averageCost && averageCost > 0) values.push(averageCost);
  if (overlay?.reviewBand) {
    values.push(overlay.reviewBand.low, overlay.reviewBand.high);
  }
  for (const marker of overlay?.markers ?? []) values.push(marker.price);
  for (const window of selectedAverages) {
    const key = `ma${window}` as const;
    for (const bar of bars) {
      const value = bar[key];
      if (value !== null) values.push(value);
    }
  }
  const finite = values.filter((value) => Number.isFinite(value) && value > 0);
  if (finite.length === 0) return [0, 1];
  const low = Math.min(...finite);
  const high = Math.max(...finite);
  const spread = Math.max(high - low, high * 0.015, 1);
  return [Math.max(0, low - spread * 0.1), high + spread * 0.1];
}
