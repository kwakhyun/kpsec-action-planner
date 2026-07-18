"use client";

import { useId, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type SecurityChartPeriod = "1D" | "1W" | "1M" | "3M";

export type SecurityChartBar = Readonly<{
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}>;

export type SecurityChartReferenceBand = Readonly<{
  low: number;
  high: number;
  label: string;
}>;

export type SecurityChartPlanMarker = Readonly<{
  id: string;
  price: number;
  label: string;
  tone?: "primary" | "warning" | "muted";
}>;

export type SecurityChartPlanStage = Readonly<{
  id: string;
  label: string;
  shareLabel: string;
  weightPct: number;
}>;

export type SecurityChartPlanOverlay = Readonly<{
  referenceBand?: SecurityChartReferenceBand | null;
  markers?: readonly SecurityChartPlanMarker[];
  stages?: readonly SecurityChartPlanStage[];
}>;

export type SecurityPriceChartProps = Readonly<{
  bars: readonly SecurityChartBar[];
  currency?: string | null;
  period?: SecurityChartPeriod;
  defaultPeriod?: SecurityChartPeriod;
  availablePeriods?: readonly SecurityChartPeriod[];
  planOverlay?: SecurityChartPlanOverlay | null;
  height?: number;
  className?: string;
  ariaLabel?: string;
  onPeriodChange?: (period: SecurityChartPeriod) => void;
}>;

const PERIOD_LABELS: Record<SecurityChartPeriod, string> = {
  "1D": "1일",
  "1W": "1주",
  "1M": "1개월",
  "3M": "3개월",
};

const PERIOD_WINDOW_SECONDS: Record<SecurityChartPeriod, number> = {
  "1D": 0,
  "1W": 7 * 24 * 60 * 60,
  "1M": 31 * 24 * 60 * 60,
  "3M": 93 * 24 * 60 * 60,
};

const MARKER_COLORS: Record<
  NonNullable<SecurityChartPlanMarker["tone"]>,
  string
> = {
  primary: "var(--chart-plan-primary, #f5b000)",
  warning: "var(--chart-plan-warning, #e85d75)",
  muted: "var(--chart-plan-muted, #7b8798)",
};

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Seoul",
  }).format(new Date(timestamp * 1_000));
}

function formatPrice(value: number, currency: string | null): string {
  const maximumFractionDigits = currency === "KRW" ? 0 : 2;
  const formatted = new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits,
  }).format(value);

  if (currency === "KRW") return `${formatted}원`;
  if (currency) return `${formatted} ${currency}`;
  return formatted;
}

function formatCompactPrice(value: number): string {
  return new Intl.NumberFormat("ko-KR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatVolume(value: number): string {
  return `${new Intl.NumberFormat("ko-KR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)}주`;
}

function sortedUniqueBars(
  bars: readonly SecurityChartBar[],
): SecurityChartBar[] {
  const byTimestamp = new Map<number, SecurityChartBar>();

  for (const bar of bars) {
    if (!byTimestamp.has(bar.timestamp)) {
      byTimestamp.set(bar.timestamp, bar);
    }
  }

  return [...byTimestamp.values()].sort(
    (left, right) => left.timestamp - right.timestamp,
  );
}

function barsForPeriod(
  bars: readonly SecurityChartBar[],
  period: SecurityChartPeriod,
): SecurityChartBar[] {
  const latestTimestamp = bars.at(-1)?.timestamp;
  if (latestTimestamp === undefined) return [];

  if (period === "1D") {
    return bars.slice(-1);
  }

  const cutoff = latestTimestamp - PERIOD_WINDOW_SECONDS[period];
  return bars.filter((bar) => bar.timestamp >= cutoff);
}

function markerColor(marker: SecurityChartPlanMarker): string {
  return MARKER_COLORS[marker.tone ?? "primary"];
}

function priceDomain(
  bars: readonly SecurityChartBar[],
  overlay: SecurityChartPlanOverlay | null | undefined,
): readonly [number, number] {
  const values = bars.flatMap((bar) => [bar.low, bar.high]);
  const band = overlay?.referenceBand;
  if (band) values.push(band.low, band.high);
  for (const marker of overlay?.markers ?? []) values.push(marker.price);

  const finitePositiveValues = values.filter(
    (value) => Number.isFinite(value) && value > 0,
  );
  if (finitePositiveValues.length === 0) return [0, 1];

  const low = Math.min(...finitePositiveValues);
  const high = Math.max(...finitePositiveValues);
  const spread = Math.max(high - low, high * 0.02, 1);
  const padding = spread * 0.12;
  return [Math.max(0, low - padding), high + padding];
}

function accessibilitySummary(
  bars: readonly SecurityChartBar[],
  period: SecurityChartPeriod,
  currency: string | null,
  overlay: SecurityChartPlanOverlay | null | undefined,
): string {
  const first = bars[0];
  const latest = bars.at(-1);
  if (!first || !latest) {
    return `${PERIOD_LABELS[period]} 동안 표시할 공개 가격 데이터가 없습니다.`;
  }

  const low = Math.min(...bars.map((bar) => bar.low));
  const high = Math.max(...bars.map((bar) => bar.high));
  const changePct = ((latest.close - first.close) / first.close) * 100;
  const direction = changePct > 0 ? "올랐고" : changePct < 0 ? "내렸고" : "같고";
  const band = overlay?.referenceBand;
  const bandSummary = band
    ? ` 재확인 구간은 ${formatPrice(band.low, currency)}부터 ${formatPrice(band.high, currency)}입니다.`
    : "";

  return [
    `${PERIOD_LABELS[period]} 공개 데이터 ${bars.length}개 거래일을 표시합니다.`,
    `처음 종가보다 ${Math.abs(changePct).toFixed(1)}% ${direction}, 최근 종가는 ${formatPrice(latest.close, currency)}입니다.`,
    `표시 구간의 낮은 가격은 ${formatPrice(low, currency)}, 높은 가격은 ${formatPrice(high, currency)}입니다.${bandSummary}`,
  ].join(" ");
}

export function SecurityPriceChart({
  bars,
  currency = null,
  period: controlledPeriod,
  defaultPeriod = "3M",
  availablePeriods = ["1D", "1W", "1M", "3M"],
  planOverlay,
  height = 340,
  className,
  ariaLabel = "공개 데이터 기준 가격 차트",
  onPeriodChange,
}: SecurityPriceChartProps) {
  const reactId = useId();
  const gradientId = `security-price-gradient-${reactId.replaceAll(":", "")}`;
  const [uncontrolledPeriod, setUncontrolledPeriod] =
    useState<SecurityChartPeriod>(defaultPeriod);
  const activePeriod = controlledPeriod ?? uncontrolledPeriod;

  const normalizedBars = useMemo(() => sortedUniqueBars(bars), [bars]);
  const visibleBars = useMemo(
    () => barsForPeriod(normalizedBars, activePeriod),
    [activePeriod, normalizedBars],
  );
  const domain = useMemo(
    () => priceDomain(visibleBars, planOverlay),
    [planOverlay, visibleBars],
  );
  const summary = useMemo(
    () => accessibilitySummary(visibleBars, activePeriod, currency, planOverlay),
    [activePeriod, currency, planOverlay, visibleBars],
  );
  const latest = visibleBars.at(-1);
  const markerList = planOverlay?.markers ?? [];
  const rootClassName = ["security-chart", className]
    .filter(Boolean)
    .join(" ");

  function selectPeriod(nextPeriod: SecurityChartPeriod) {
    if (controlledPeriod === undefined) setUncontrolledPeriod(nextPeriod);
    onPeriodChange?.(nextPeriod);
  }

  return (
    <section className={rootClassName} aria-label={ariaLabel}>
      <div className="security-chart__toolbar">
        <div className="security-chart__latest" aria-hidden="true">
          <span>공개 데이터 기준</span>
          <strong>
            {latest ? formatPrice(latest.close, currency) : "가격 확인 불가"}
          </strong>
        </div>

        <div
          className="security-chart__periods"
          role="group"
          aria-label="차트 기간 선택"
        >
          {availablePeriods.map((period) => (
            <button
              key={period}
              type="button"
              className="security-chart__period-button"
              aria-pressed={activePeriod === period}
              onClick={() => selectPeriod(period)}
            >
              {PERIOD_LABELS[period]}
            </button>
          ))}
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {summary}
      </p>

      {visibleBars.length === 0 ? (
        <div className="security-chart__empty" role="status">
          선택한 기간에 표시할 공개 가격 데이터가 없습니다.
        </div>
      ) : (
        <>
          <div
            className="security-chart__canvas"
            style={{ width: "100%", height }}
            aria-hidden="true"
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={visibleBars}
                margin={{ top: 18, right: 14, bottom: 4, left: 0 }}
              >
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor="var(--chart-price, #f5b000)"
                      stopOpacity={0.32}
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--chart-price, #f5b000)"
                      stopOpacity={0.02}
                    />
                  </linearGradient>
                </defs>

                <CartesianGrid
                  stroke="var(--chart-grid, rgba(126, 142, 160, 0.18))"
                  strokeDasharray="3 5"
                  vertical={false}
                />
                <XAxis
                  dataKey="timestamp"
                  tickFormatter={formatDate}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={34}
                  tick={{
                    fill: "var(--chart-muted, #8492a6)",
                    fontSize: 12,
                  }}
                />
                <YAxis
                  orientation="right"
                  domain={[domain[0], domain[1]]}
                  tickFormatter={formatCompactPrice}
                  tickLine={false}
                  axisLine={false}
                  width={62}
                  tick={{
                    fill: "var(--chart-muted, #8492a6)",
                    fontSize: 12,
                  }}
                />
                <Tooltip
                  cursor={{
                    stroke: "var(--chart-cursor, rgba(126, 142, 160, 0.72))",
                    strokeDasharray: "4 4",
                  }}
                  contentStyle={{
                    border: "1px solid var(--chart-tooltip-border, rgba(126, 142, 160, 0.24))",
                    borderRadius: 12,
                    background: "var(--chart-tooltip-bg, #111827)",
                    color: "var(--chart-tooltip-text, #f8fafc)",
                    boxShadow: "0 12px 34px rgba(15, 23, 42, 0.18)",
                  }}
                  labelFormatter={(label) => formatDate(Number(label))}
                  formatter={(value, name, item) => {
                    if (name === "close") {
                      const numericValue = Number(value);
                      const payload = item.payload as SecurityChartBar | undefined;
                      return [
                        `${formatPrice(numericValue, currency)} · 거래량 ${formatVolume(payload?.volume ?? 0)}`,
                        "종가",
                      ];
                    }
                    return [String(value), String(name)];
                  }}
                />

                {planOverlay?.referenceBand ? (
                  <ReferenceArea
                    y1={planOverlay.referenceBand.low}
                    y2={planOverlay.referenceBand.high}
                    fill="var(--chart-reference-band, #f5b000)"
                    fillOpacity={0.09}
                    stroke="var(--chart-reference-band-border, #f5b000)"
                    strokeOpacity={0.44}
                    strokeDasharray="5 5"
                    ifOverflow="extendDomain"
                  />
                ) : null}

                {markerList.map((marker) => (
                  <ReferenceLine
                    key={marker.id}
                    y={marker.price}
                    stroke={markerColor(marker)}
                    strokeWidth={1.5}
                    strokeDasharray="6 5"
                    ifOverflow="extendDomain"
                  />
                ))}

                <Area
                  type="monotone"
                  dataKey="close"
                  name="종가"
                  stroke="var(--chart-price, #f5b000)"
                  strokeWidth={2.5}
                  fill={`url(#${gradientId})`}
                  dot={visibleBars.length === 1 ? { r: 4 } : false}
                  activeDot={{ r: 5, strokeWidth: 2 }}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {planOverlay?.referenceBand || markerList.length > 0 ? (
            <div className="security-chart__legend" aria-label="계획 표시 설명">
              {planOverlay?.referenceBand ? (
                <span className="security-chart__legend-item security-chart__legend-item--band">
                  <i aria-hidden="true" />
                  {planOverlay.referenceBand.label}: {formatPrice(
                    planOverlay.referenceBand.low,
                    currency,
                  )}–{formatPrice(planOverlay.referenceBand.high, currency)}
                </span>
              ) : null}
              {markerList.map((marker) => (
                <span
                  key={marker.id}
                  className={`security-chart__legend-item security-chart__legend-item--${marker.tone ?? "primary"}`}
                >
                  <i aria-hidden="true" />
                  {marker.label}: {formatPrice(marker.price, currency)}
                </span>
              ))}
            </div>
          ) : null}

          {planOverlay?.stages?.length ? (
            <div className="security-chart__stage-plan">
              <span>회차별 검토 비중 · 시간 예측 아님</span>
              <div className="security-chart__stage-track" aria-label="선택한 계획의 회차별 검토 비중">
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
        </>
      )}
    </section>
  );
}
