"use client";

import { forwardRef, useImperativeHandle, useMemo, useState } from "react";

import type { IntradayMarketView } from "@/lib/intraday-market";
import type { ChartHistoryView } from "@/lib/chart-history";
import {
  aggregateChartBars,
  CHART_UNIT_LABELS,
  MAX_CHART_ZOOM_LEVEL,
  zoomChartBars,
} from "@/lib/chart-series";

import styles from "./security-candlestick-chart.module.css";

import {
  buildSecurityChartObservation,
  calculateChartDomain,
  normalizeChartBars,
  withMovingAverages,
  type CandlestickPeriod,
  type CandlestickPlanOverlay,
  type ChartPoint,
  type MovingAverageWindow,
  type SecurityCandleBar,
  type SecurityChartObservation,
} from "./security-chart-model";
import { SecurityChartCanvas } from "./security-chart-canvas";
import { SecurityChartDetails } from "./security-chart-details";
import { SecurityChartToolbar } from "./security-chart-toolbar";

export type {
  CandlestickPeriod,
  CandlestickPlanOverlay,
  MovingAverageWindow,
  SecurityCandleBar,
  SecurityChartObservation,
} from "./security-chart-model";

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

  const normalizedDaily = useMemo(
    () => normalizeChartBars(dailyBars),
    [dailyBars],
  );
  const normalizedHistory = useMemo(
    () => normalizeChartBars(history?.bars ?? normalizedDaily),
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
      return withMovingAverages(normalizeChartBars(intraday.bars)).map(
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
      calculateChartDomain(
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
      <SecurityChartToolbar
        activePeriod={activePeriod}
        unitAvailable={unitAvailable}
        unitUnavailableReason={unitUnavailableReason}
        averageSourceCount={averageSourceCount}
        averageWindowUnit={averageWindowUnit}
        selectedAverages={availableSelectedAverages}
        zoomLevel={zoomLevel}
        zoomSummary={zoomSummary}
        visibleBarCount={visibleBars.length}
        onPeriodSelect={selectPeriod}
        onAverageToggle={toggleAverage}
        onZoomIn={() =>
          setZoomLevel((current) =>
            Math.min(MAX_CHART_ZOOM_LEVEL, current + 1),
          )
        }
        onZoomOut={() =>
          setZoomLevel((current) => Math.max(0, current - 1))
        }
        onZoomReset={() => setZoomLevel(0)}
      />

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

      <SecurityChartCanvas
        bars={visibleBars}
        height={height}
        isIntraday={isIntraday}
        domain={domain}
        maxVolume={maxVolume}
        activePeriod={activePeriod}
        exchangeTimezone={exchangeTimezone}
        currency={currency}
        averageCost={averageCost}
        planOverlay={planOverlay}
        selectedAverages={availableSelectedAverages}
        averageWindowUnit={averageWindowUnit}
      />
      <SecurityChartDetails
        selectedAverages={availableSelectedAverages}
        isIntraday={isIntraday}
        averageWindowUnit={averageWindowUnit}
        averageCost={averageCost}
        currency={currency}
        planOverlay={planOverlay}
        observation={observation}
      />
    </section>
  );
});
