import type { CSSProperties } from "react";

import styles from "./security-candlestick-chart.module.css";
import {
  formatChartPrice,
  MA_COLORS,
  type CandlestickPlanOverlay,
  type MovingAverageWindow,
  type SecurityChartObservation,
} from "./security-chart-model";

type SecurityChartDetailsProps = Readonly<{
  selectedAverages: ReadonlySet<MovingAverageWindow>;
  isIntraday: boolean;
  averageWindowUnit: string;
  averageCost: number | null;
  currency: string | null;
  planOverlay: CandlestickPlanOverlay | null | undefined;
  observation: SecurityChartObservation;
}>;

function legendStyle(color: string): CSSProperties {
  return { "--legend-color": color } as CSSProperties;
}

export function SecurityChartDetails({
  selectedAverages,
  isIntraday,
  averageWindowUnit,
  averageCost,
  currency,
  planOverlay,
  observation,
}: SecurityChartDetailsProps) {
  return (
    <>
      <div className={styles.legend} aria-label="차트 범례">
        <span className={styles.legendItem}>
          <i className={styles.legendSwatch} style={legendStyle("#d92d45")} />
          ↑ 오른 구간
        </span>
        <span className={styles.legendItem}>
          <i className={styles.legendSwatch} style={legendStyle("#175cd3")} />
          ↓ 내린 구간
        </span>
        <span className={styles.legendItem}>
          <i className={styles.legendSwatch} style={legendStyle("#b7b7b7")} />
          거래량
        </span>
        {[...selectedAverages]
          .sort((left, right) => left - right)
          .map((window) => (
            <span key={window} className={styles.legendItem}>
              <i
                className={styles.legendLine}
                style={legendStyle(MA_COLORS[window])}
              />
              {isIntraday
                ? `하루 단위 ${window}일 평균`
                : `${window}${averageWindowUnit} 평균`}
            </span>
          ))}
        {averageCost && averageCost > 0 ? (
          <span className={styles.legendItem}>
            <i className={styles.legendLine} style={legendStyle("#667085")} />
            내가 입력한 평균 매수가 {formatChartPrice(averageCost, currency)}
          </span>
        ) : null}
        {planOverlay?.reviewBand ? (
          <span className={styles.legendItem}>
            <i className={styles.legendSwatch} style={legendStyle("#155eef")} />
            {planOverlay.reviewBand.label}{" "}
            {formatChartPrice(planOverlay.reviewBand.low, currency)}–
            {formatChartPrice(planOverlay.reviewBand.high, currency)}
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
            서버가 검증한 과거 공개 데이터의 관찰이며, 미래 흐름이나
            매수·매도 시점을 뜻하지 않습니다.
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
                <small>
                  {stage.shareLabel} · {stage.weightPct.toFixed(0)}%
                </small>
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
