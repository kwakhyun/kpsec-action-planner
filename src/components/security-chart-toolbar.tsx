import {
  CHART_UNIT_ACCESSIBLE_LABELS,
  CHART_UNIT_LABELS,
  MAX_CHART_ZOOM_LEVEL,
} from "@/lib/chart-series";

import styles from "./security-candlestick-chart.module.css";
import {
  CHART_UNITS,
  type CandlestickPeriod,
  type MovingAverageWindow,
} from "./security-chart-model";

type SecurityChartToolbarProps = Readonly<{
  activePeriod: CandlestickPeriod;
  unitAvailable: Readonly<Record<CandlestickPeriod, boolean>>;
  unitUnavailableReason: (period: CandlestickPeriod) => string;
  averageSourceCount: number;
  averageWindowUnit: string;
  selectedAverages: ReadonlySet<MovingAverageWindow>;
  zoomLevel: number;
  zoomSummary: string;
  visibleBarCount: number;
  onPeriodSelect: (period: CandlestickPeriod) => void;
  onAverageToggle: (window: MovingAverageWindow) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}>;

export function SecurityChartToolbar({
  activePeriod,
  unitAvailable,
  unitUnavailableReason,
  averageSourceCount,
  averageWindowUnit,
  selectedAverages,
  zoomLevel,
  zoomSummary,
  visibleBarCount,
  onPeriodSelect,
  onAverageToggle,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: SecurityChartToolbarProps) {
  return (
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
            title={
              !unitAvailable[period]
                ? unitUnavailableReason(period)
                : undefined
            }
            onClick={() => onPeriodSelect(period)}
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
              aria-pressed={selectedAverages.has(window)}
              title={
                averageSourceCount < window
                  ? `${window}${averageWindowUnit} 평균을 계산할 데이터가 충분하지 않습니다.`
                  : undefined
              }
              onClick={() => onAverageToggle(window)}
            >
              {window}
              {averageWindowUnit}
            </button>
          ))}
        </div>
        <div
          className={styles.zoomControls}
          role="group"
          aria-label="차트 확대 조절"
        >
          <span aria-live="polite">{zoomSummary}</span>
          <button
            type="button"
            className={styles.zoomButton}
            disabled={
              zoomLevel >= MAX_CHART_ZOOM_LEVEL || visibleBarCount <= 2
            }
            onClick={onZoomIn}
          >
            확대
          </button>
          <button
            type="button"
            className={styles.zoomButton}
            disabled={zoomLevel === 0}
            onClick={onZoomOut}
          >
            축소
          </button>
          <button
            type="button"
            className={styles.zoomButton}
            disabled={zoomLevel === 0}
            onClick={onZoomReset}
          >
            전체
          </button>
        </div>
      </div>
    </div>
  );
}
