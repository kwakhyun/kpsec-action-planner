import type { BarShapeProps } from "recharts";

import {
  formatChartPrice,
  safeChartDateTime,
  type CandlestickPeriod,
  type ChartPoint,
} from "./security-chart-model";
import styles from "./security-candlestick-chart.module.css";

export function CandlestickShape(props: BarShapeProps) {
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
  const color = isUp ? "#d92d45" : isDown ? "#175cd3" : "#98a2b3";
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

type CandleTooltipProps = Readonly<{
  active?: boolean;
  payload?: readonly Readonly<{ payload?: unknown }>[];
  currency: string | null;
  exchangeTimezone: string | null;
  unit: CandlestickPeriod;
}>;

export function CandleTooltip({
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
        {safeChartDateTime(point.timestamp, unit, exchangeTimezone)}
      </strong>
      <div className={styles.tooltipGrid}>
        <span>시작 {formatChartPrice(point.open, currency)}</span>
        <span>높음 {formatChartPrice(point.high, currency)}</span>
        <span>낮음 {formatChartPrice(point.low, currency)}</span>
        <span>마감 {formatChartPrice(point.close, currency)}</span>
      </div>
      <span className={styles.tooltipVolume}>
        거래량 {new Intl.NumberFormat("ko-KR").format(point.volume)}주
      </span>
    </div>
  );
}
