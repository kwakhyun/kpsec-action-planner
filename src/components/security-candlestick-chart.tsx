"use client";

import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
} from "recharts";

import type { IntradayMarketView } from "@/lib/intraday-market";
import type { ChartHistoryView } from "@/lib/chart-history";
import {
  aggregateChartBars,
  CHART_UNIT_ACCESSIBLE_LABELS,
  CHART_UNIT_LABELS,
  MAX_CHART_ZOOM_LEVEL,
  zoomChartBars,
  type ChartUnit,
} from "@/lib/chart-series";

import styles from "./security-candlestick-chart.module.css";

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
  reviewBand?: Readonly<{
    low: number;
    high: number;
    label: string;
  }> | null;
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

export type SecurityCandlestickChartHandle = Readonly<{
  getActivePeriod: () => CandlestickPeriod;
  getObservation: () => SecurityChartObservation;
  getIntradayResolution: () => "1m" | "5m" | null;
}>;

export type SecurityCandlestickChartProps = Readonly<{
  dailyBars: readonly SecurityCandleBar[];
  intraday?: IntradayMarketView | null;
  intradayUnavailableReason?: string | null;
  history?: ChartHistoryView | null;
  historyUnavailableReason?: string | null;
  currency?: string | null;
  exchangeTimezone?: string | null;
  period?: CandlestickPeriod;
  defaultPeriod?: CandlestickPeriod;
  onPeriodChange?: (period: CandlestickPeriod) => void;
  averageCost?: number | null;
  planOverlay?: CandlestickPlanOverlay | null;
  observation?: SecurityChartObservation | null;
  defaultMovingAverages?: readonly MovingAverageWindow[];
  height?: number;
  className?: string;
}>;

type ChartPoint = SecurityCandleBar & {
  candleRange: number;
  ma5: number | null;
  ma20: number | null;
  ma60: number | null;
};

const CHART_UNITS = ["MINUTE", "DAY", "WEEK", "MONTH", "YEAR"] as const;

const MA_COLORS: Record<MovingAverageWindow, string> = {
  5: "#e38100",
  20: "#7b5bd6",
  60: "#0b8f83",
};

const MARKER_COLORS = {
  primary: "#dfaa00",
  warning: "#e04444",
  muted: "#777777",
} as const;

function normalizeBars(
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

function withMovingAverages(
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
  const bars = normalizeBars(sourceBars);
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

function safeDateTime(
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

function formatPrice(value: number, currency: string | null): string {
  const formatted = new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: currency === "KRW" ? 0 : 2,
  }).format(value);
  return currency === "KRW"
    ? `${formatted}원`
    : currency
      ? `${formatted} ${currency}`
      : formatted;
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat("ko-KR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function CandlestickShape(props: BarShapeProps) {
  const point = props.payload as ChartPoint | undefined;
  if (!point || !Number.isFinite(props.x) || !Number.isFinite(props.y)) {
    return <g />;
  }

  const top = props.y;
  const bottom = props.y + Math.max(props.height, 1);
  const priceSpan = Math.max(point.high - point.low, Number.EPSILON);
  const yForPrice = (price: number) =>
    top + ((point.high - price) / priceSpan) * (bottom - top);
  const openY = yForPrice(point.open);
  const closeY = yForPrice(point.close);
  const isUp = point.close > point.open;
  const isDown = point.close < point.open;
  const color = isUp ? "#e04444" : isDown ? "#2d64c8" : "#8a8a8a";
  const center = props.x + props.width / 2;
  const bodyWidth = Math.max(Math.min(props.width * 0.7, 10), 2);
  const bodyTop = Math.min(openY, closeY);
  const bodyHeight = Math.max(Math.abs(closeY - openY), 1.5);

  return (
    <g>
      <line
        x1={center}
        x2={center}
        y1={top}
        y2={bottom}
        stroke={color}
        strokeWidth={1.2}
      />
      <rect
        x={center - bodyWidth / 2}
        y={bodyTop}
        width={bodyWidth}
        height={bodyHeight}
        rx={1}
        fill={color}
      />
    </g>
  );
}

type CandleTooltipProps = {
  active?: boolean;
  payload?: readonly Readonly<{ payload?: unknown }>[];
  currency: string | null;
  exchangeTimezone: string | null;
  unit: CandlestickPeriod;
};

function CandleTooltip({
  active,
  payload,
  currency,
  exchangeTimezone,
  unit,
}: CandleTooltipProps) {
  const point = payload?.find((item) => item.payload)?.payload as
    | ChartPoint
    | undefined;
  if (!active || !point) return null;

  return (
    <div className={styles.tooltip}>
      <strong>
        {safeDateTime(point.timestamp, unit, exchangeTimezone)}
      </strong>
      <div className={styles.tooltipGrid}>
        <span>시작 {formatPrice(point.open, currency)}</span>
        <span>높음 {formatPrice(point.high, currency)}</span>
        <span>낮음 {formatPrice(point.low, currency)}</span>
        <span>마감 {formatPrice(point.close, currency)}</span>
      </div>
      <span className={styles.tooltipVolume}>
        거래량 {new Intl.NumberFormat("ko-KR").format(point.volume)}주
      </span>
    </div>
  );
}

function chartDomain(
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

export const SecurityCandlestickChart = forwardRef<
  SecurityCandlestickChartHandle,
  SecurityCandlestickChartProps
>(function SecurityCandlestickChart(
  {
    dailyBars,
    intraday = null,
    intradayUnavailableReason = null,
    history = null,
    historyUnavailableReason = null,
    currency = null,
    exchangeTimezone = null,
    period: controlledPeriod,
    defaultPeriod = "DAY",
    onPeriodChange,
    averageCost = null,
    planOverlay,
    observation: serverObservation = null,
    defaultMovingAverages = [5, 20],
    height = 420,
    className,
  },
  ref,
) {
  const intradayAvailable = (intraday?.bars.length ?? 0) >= 12;
  const [selectedAverages, setSelectedAverages] = useState<
    ReadonlySet<MovingAverageWindow>
  >(() => new Set(defaultMovingAverages));
  const [zoomLevel, setZoomLevel] = useState(0);

  const normalizedDaily = useMemo(() => normalizeBars(dailyBars), [dailyBars]);
  const normalizedHistory = useMemo(
    () => normalizeBars(history?.bars ?? normalizedDaily),
    [history, normalizedDaily],
  );
  const dailyPoints = useMemo(
    () => withMovingAverages(normalizedDaily),
    [normalizedDaily],
  );
  const calendarPoints = useMemo(
    () => ({
      WEEK: withMovingAverages(
        aggregateChartBars(normalizedHistory, "WEEK", exchangeTimezone),
      ),
      MONTH: withMovingAverages(
        aggregateChartBars(normalizedHistory, "MONTH", exchangeTimezone),
      ),
      YEAR: withMovingAverages(
        aggregateChartBars(normalizedHistory, "YEAR", exchangeTimezone),
      ),
    }),
    [exchangeTimezone, normalizedHistory],
  );
  const unitAvailable: Record<CandlestickPeriod, boolean> = {
    MINUTE: intradayAvailable,
    DAY: dailyPoints.length >= 2,
    WEEK: calendarPoints.WEEK.length >= 2,
    MONTH: calendarPoints.MONTH.length >= 2,
    YEAR: calendarPoints.YEAR.length >= 2 && history !== null,
  };
  const safeDefaultPeriod = unitAvailable[defaultPeriod]
    ? defaultPeriod
    : "DAY";
  const [uncontrolledPeriod, setUncontrolledPeriod] =
    useState<CandlestickPeriod>(safeDefaultPeriod);
  const requestedPeriod = controlledPeriod ?? uncontrolledPeriod;
  const activePeriod = unitAvailable[requestedPeriod]
    ? requestedPeriod
    : "DAY";
  const fallbackObservation = useMemo(
    () => buildSecurityChartObservation(normalizedDaily),
    [normalizedDaily],
  );
  const observation = serverObservation ?? fallbackObservation;
  const latestDailyAverages = dailyPoints.at(-1);

  const unitBars = useMemo(() => {
    if (activePeriod === "MINUTE") {
      if (!intraday) return dailyPoints;
      return withMovingAverages(normalizeBars(intraday.bars)).map(
        (bar): ChartPoint => ({
          ...bar,
          ma5: latestDailyAverages?.ma5 ?? null,
          ma20: latestDailyAverages?.ma20 ?? null,
          ma60: latestDailyAverages?.ma60 ?? null,
        }),
      );
    }
    if (activePeriod === "DAY") return dailyPoints;
    if (activePeriod === "WEEK") return calendarPoints.WEEK;
    if (activePeriod === "MONTH") return calendarPoints.MONTH;
    return calendarPoints.YEAR;
  }, [activePeriod, calendarPoints, dailyPoints, intraday, latestDailyAverages]);
  const visibleBars = useMemo(
    () => zoomChartBars(unitBars, zoomLevel),
    [unitBars, zoomLevel],
  );
  const averageSourceCount =
    activePeriod === "MINUTE" ? dailyPoints.length : unitBars.length;
  const availableSelectedAverages = useMemo(
    () =>
      new Set(
        [...selectedAverages].filter((window) => averageSourceCount >= window),
      ),
    [averageSourceCount, selectedAverages],
  );

  const domain = useMemo(
    () =>
      chartDomain(
        visibleBars,
        averageCost,
        planOverlay,
        availableSelectedAverages,
      ),
    [averageCost, availableSelectedAverages, planOverlay, visibleBars],
  );
  const maxVolume = Math.max(...visibleBars.map((bar) => bar.volume), 1);
  const isIntraday = activePeriod === "MINUTE";
  const averageWindowUnit =
    activePeriod === "MINUTE" || activePeriod === "DAY"
        ? "일"
        : activePeriod === "WEEK"
          ? "주"
          : activePeriod === "MONTH"
            ? "개월"
            : "년";

  useImperativeHandle(
    ref,
    () => ({
      getActivePeriod: () => activePeriod,
      getObservation: () => observation,
      getIntradayResolution: () => intraday?.provenance.interval ?? null,
    }),
    [activePeriod, intraday, observation],
  );

  function selectPeriod(nextPeriod: CandlestickPeriod) {
    if (!unitAvailable[nextPeriod]) return;
    if (controlledPeriod === undefined) setUncontrolledPeriod(nextPeriod);
    setZoomLevel(0);
    onPeriodChange?.(nextPeriod);
  }

  function toggleAverage(window: MovingAverageWindow) {
    if (averageSourceCount < window) return;
    setSelectedAverages((current) => {
      const next = new Set(current);
      if (next.has(window)) next.delete(window);
      else next.add(window);
      return next;
    });
  }

  const rootClassName = [styles.root, className].filter(Boolean).join(" ");
  const intradayResolutionLabel =
    intraday?.provenance.interval === "1m" ? "1분 단위" : "5분 단위";
  const intradayDelayNotice = intraday?.provenance.delayNotice.replace(
    "실시간 호가가 아닙니다.",
    "지금 주문 가능한 가격을 보여주는 데이터가 아닙니다.",
  );
  const accessibilitySummary = `${CHART_UNIT_LABELS[activePeriod]} 단위 공개 데이터 ${visibleBars.length}개를 표시합니다. ${observation.priceText} ${observation.volumeText}`;
  const zoomSummary =
    zoomLevel === 0 ? "전체 구간" : `최근 ${visibleBars.length}개 가격 막대`;
  const unitUnavailableReason = (unit: CandlestickPeriod) => {
    if (unit === "MINUTE") {
      return (
        intradayUnavailableReason ??
        "충분한 1분·5분 공개 데이터가 확인되지 않았습니다."
      );
    }
    if (unit === "YEAR") {
      return (
        historyUnavailableReason ??
        "년 단위로 표시할 장기 공개 데이터를 확인하고 있습니다."
      );
    }
    return "선택한 단위로 묶을 공개 데이터가 충분하지 않습니다.";
  };

  return (
    <section className={rootClassName} aria-label="공개 데이터 기반 가격 차트">
      <div className={styles.toolbar}>
        <div className={styles.periods} role="group" aria-label="차트 단위 선택">
          {CHART_UNITS.map((period) => (
            <button
              key={period}
              type="button"
              className={styles.periodButton}
              disabled={!unitAvailable[period]}
              aria-pressed={activePeriod === period}
              aria-label={CHART_UNIT_ACCESSIBLE_LABELS[period]}
              title={!unitAvailable[period] ? unitUnavailableReason(period) : undefined}
              onClick={() => selectPeriod(period)}
            >
              {CHART_UNIT_LABELS[period]}
            </button>
          ))}
        </div>

        <div className={styles.toolbarGroup}>
          <div
            className={styles.averageToggles}
            role="group"
            aria-label="가격 평균선 선택"
          >
            <span>가격 평균선</span>
            {([5, 20, 60] as const).map((window) => (
              <button
                key={window}
                type="button"
                className={styles.averageButton}
                disabled={averageSourceCount < window}
                aria-pressed={availableSelectedAverages.has(window)}
                title={
                  averageSourceCount < window
                    ? `${window}${averageWindowUnit} 평균을 계산할 데이터가 충분하지 않습니다.`
                    : undefined
                }
                onClick={() => toggleAverage(window)}
              >
                {window}{averageWindowUnit}
              </button>
            ))}
          </div>
          <div className={styles.zoomControls} role="group" aria-label="차트 확대 조절">
            <span aria-live="polite">{zoomSummary}</span>
            <button
              type="button"
              className={styles.zoomButton}
              disabled={zoomLevel >= MAX_CHART_ZOOM_LEVEL || visibleBars.length <= 2}
              onClick={() =>
                setZoomLevel((current) =>
                  Math.min(MAX_CHART_ZOOM_LEVEL, current + 1),
                )
              }
            >
              확대
            </button>
            <button
              type="button"
              className={styles.zoomButton}
              disabled={zoomLevel === 0}
              onClick={() => setZoomLevel((current) => Math.max(0, current - 1))}
            >
              축소
            </button>
            <button
              type="button"
              className={styles.zoomButton}
              disabled={zoomLevel === 0}
              onClick={() => setZoomLevel(0)}
            >
              전체
            </button>
          </div>
        </div>
      </div>

      <p className={styles.availability}>
        {isIntraday && intraday
          ? `${intradayResolutionLabel} 공개 데이터 · ${intraday.provenance.sampleCount}개 · ${intradayDelayNotice}`
          : activePeriod === "DAY"
            ? `최근 3개월 하루 단위 공개 데이터 · ${dailyPoints.length}개 · 실행안 계산에 사용한 데이터와 같습니다.`
            : `${history ? "최근 5년" : "최근 3개월"} 하루 단위 가격을 ${CHART_UNIT_LABELS[activePeriod]} 단위로 묶었습니다 · ${unitBars.length}개 가격 막대${history ? " · 긴 기간 차트는 보기 전용이며 실행안 계산을 바꾸지 않습니다." : ""}`}
      </p>
      {!intradayAvailable || !history ? (
        <p className={styles.availabilityNote}>
          {!intradayAvailable
            ? `분 단위 비활성화 · ${intradayUnavailableReason ?? "충분한 분 단위 가격 데이터가 확인되지 않았습니다."}`
            : null}
          {!history
            ? `${!intradayAvailable ? " " : ""}년 단위 비활성화 · ${historyUnavailableReason ?? "장기 공개 데이터를 확인하고 있습니다."}`
            : null}
        </p>
      ) : null}
      <p className={styles.srOnly} aria-live="polite">
        {accessibilitySummary}
      </p>

      {visibleBars.length < 2 ? (
        <div className={styles.empty} role="status">
          선택한 기간에 안전하게 표시할 가격 데이터가 충분하지 않습니다.
        </div>
      ) : (
        <div className={styles.canvas} style={{ height }} aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={visibleBars}
              margin={{ top: 20, right: 14, bottom: 8, left: 2 }}
              barCategoryGap={isIntraday ? "8%" : "20%"}
            >
              <CartesianGrid
                vertical={false}
                stroke="#ededed"
                strokeDasharray="3 5"
              />
              <XAxis
                dataKey="timestamp"
                tickFormatter={(value) =>
                  safeDateTime(Number(value), activePeriod, exchangeTimezone)
                }
                tickLine={false}
                axisLine={false}
                minTickGap={isIntraday ? 42 : 34}
                tick={{ fill: "#858585", fontSize: 11 }}
              />
              <YAxis
                yAxisId="price"
                orientation="right"
                domain={domain}
                tickFormatter={formatCompact}
                tickLine={false}
                axisLine={false}
                width={62}
                tick={{ fill: "#858585", fontSize: 11 }}
              />
              <YAxis
                yAxisId="volume"
                domain={[0, maxVolume * 4.2]}
                hide
              />
              <Tooltip
                cursor={{ stroke: "#adadad", strokeDasharray: "4 4" }}
                content={(props) => (
                  <CandleTooltip
                    active={props.active}
                    payload={props.payload}
                    currency={currency}
                    exchangeTimezone={exchangeTimezone}
                    unit={activePeriod}
                  />
                )}
                isAnimationActive={false}
              />

              <Bar
                yAxisId="volume"
                dataKey="volume"
                name="거래량"
                maxBarSize={isIntraday ? 6 : 12}
                isAnimationActive={false}
              >
                {visibleBars.map((bar) => (
                  <Cell
                    key={`volume-${bar.timestamp}`}
                    fill={bar.close >= bar.open ? "#e04444" : "#2d64c8"}
                    fillOpacity={0.2}
                  />
                ))}
              </Bar>

              {planOverlay?.reviewBand ? (
                <ReferenceArea
                  yAxisId="price"
                  y1={planOverlay.reviewBand.low}
                  y2={planOverlay.reviewBand.high}
                  fill="#f2c400"
                  fillOpacity={0.1}
                  stroke="#d2a900"
                  strokeOpacity={0.55}
                  strokeDasharray="5 5"
                  ifOverflow="extendDomain"
                />
              ) : null}

              {averageCost && averageCost > 0 ? (
                <ReferenceLine
                  yAxisId="price"
                  y={averageCost}
                  stroke="#555"
                  strokeWidth={1.4}
                  strokeDasharray="3 4"
                  ifOverflow="extendDomain"
                />
              ) : null}

              {(planOverlay?.markers ?? []).map((marker) => (
                <ReferenceLine
                  key={marker.id}
                  yAxisId="price"
                  y={marker.price}
                  stroke={MARKER_COLORS[marker.tone ?? "primary"]}
                  strokeWidth={1.4}
                  strokeDasharray="6 5"
                  ifOverflow="extendDomain"
                />
              ))}

              <Bar
                yAxisId="price"
                dataKey="low"
                stackId="candle"
                fill="transparent"
                fillOpacity={0}
                legendType="none"
                tooltipType="none"
                isAnimationActive={false}
              />
              <Bar
                yAxisId="price"
                dataKey="candleRange"
                stackId="candle"
                name="가격"
                shape={(props: BarShapeProps) => (
                  <CandlestickShape {...props} />
                )}
                isAnimationActive={false}
              />

              {([5, 20, 60] as const).map((window) =>
                availableSelectedAverages.has(window) ? (
                  <Line
                    key={window}
                    yAxisId="price"
                    type="monotone"
                    dataKey={`ma${window}`}
                    name={`${window}${averageWindowUnit} 평균`}
                    stroke={MA_COLORS[window]}
                    strokeWidth={1.6}
                    dot={false}
                    activeDot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ) : null,
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className={styles.legend} aria-label="차트 범례">
        <span className={styles.legendItem}>
          <i className={styles.legendSwatch} style={{ "--legend-color": "#e04444" } as React.CSSProperties} />
          ↑ 오른 구간
        </span>
        <span className={styles.legendItem}>
          <i className={styles.legendSwatch} style={{ "--legend-color": "#2d64c8" } as React.CSSProperties} />
          ↓ 내린 구간
        </span>
        <span className={styles.legendItem}>
          <i className={styles.legendSwatch} style={{ "--legend-color": "#b7b7b7" } as React.CSSProperties} />
          거래량
        </span>
        {[...availableSelectedAverages].sort((left, right) => left - right).map((window) => (
          <span key={window} className={styles.legendItem}>
            <i className={styles.legendLine} style={{ "--legend-color": MA_COLORS[window] } as React.CSSProperties} />
            {isIntraday
              ? `하루 단위 ${window}일 평균`
              : `${window}${averageWindowUnit} 평균`}
          </span>
        ))}
        {averageCost && averageCost > 0 ? (
          <span className={styles.legendItem}>
            <i className={styles.legendLine} style={{ "--legend-color": "#555" } as React.CSSProperties} />
            내가 입력한 평균 매수가 {formatPrice(averageCost, currency)}
          </span>
        ) : null}
        {planOverlay?.reviewBand ? (
          <span className={styles.legendItem}>
            <i className={styles.legendSwatch} style={{ "--legend-color": "#f2c400" } as React.CSSProperties} />
            {planOverlay.reviewBand.label} {formatPrice(planOverlay.reviewBand.low, currency)}–{formatPrice(planOverlay.reviewBand.high, currency)}
          </span>
        ) : null}
      </div>

      <details className={styles.observation}>
        <summary>가격 평균선·거래량, 이게 무슨 뜻인가요?</summary>
        <div className={styles.observationBody}>
          <ul>
            <li>{observation.priceText}</li>
            <li>{observation.volumeText}</li>
            <li>{observation.movingAverageText}</li>
          </ul>
          <p>
            서버가 검증한 과거 공개 데이터의 관찰이며, 미래 흐름이나 매수·매도 시점을 뜻하지 않습니다.
          </p>
        </div>
      </details>

      {planOverlay?.stages?.length ? (
        <div className={styles.stagePlan}>
          <div className={styles.stageHeader}>
            <strong>회차별 검토 비중</strong>
            <span>시점 예측이 아닌 계획 표시</span>
          </div>
          <div className={styles.stageTrack} aria-label="회차별 계획 비중">
            {planOverlay.stages.map((stage) => (
              <span
                key={stage.id}
                style={{ flexGrow: Math.max(stage.weightPct, 1) }}
              >
                <strong>{stage.label}</strong>
                <small>{stage.shareLabel} · {stage.weightPct.toFixed(0)}%</small>
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
});
