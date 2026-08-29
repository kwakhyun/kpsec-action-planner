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
} from "recharts";

import styles from "./security-candlestick-chart.module.css";
import {
  formatCompactChartValue,
  MA_COLORS,
  MARKER_COLORS,
  safeChartDateTime,
  type CandlestickPeriod,
  type CandlestickPlanOverlay,
  type ChartPoint,
  type MovingAverageWindow,
} from "./security-chart-model";
import { CandleTooltip, CandlestickShape } from "./security-chart-primitives";

type SecurityChartCanvasProps = Readonly<{
  bars: readonly ChartPoint[];
  height: number;
  isIntraday: boolean;
  domain: readonly [number, number];
  maxVolume: number;
  activePeriod: CandlestickPeriod;
  exchangeTimezone: string | null;
  currency: string | null;
  averageCost: number | null;
  planOverlay: CandlestickPlanOverlay | null | undefined;
  selectedAverages: ReadonlySet<MovingAverageWindow>;
  averageWindowUnit: string;
}>;

export function SecurityChartCanvas({
  bars,
  height,
  isIntraday,
  domain,
  maxVolume,
  activePeriod,
  exchangeTimezone,
  currency,
  averageCost,
  planOverlay,
  selectedAverages,
  averageWindowUnit,
}: SecurityChartCanvasProps) {
  if (bars.length < 2) {
    return (
      <div className={styles.empty} role="status">
        선택한 기간에 안전하게 표시할 가격 데이터가 충분하지 않습니다.
      </div>
    );
  }

  return (
    <div className={styles.canvas} style={{ height }} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={bars}
          margin={{ top: 20, right: 14, bottom: 8, left: 2 }}
          barCategoryGap={isIntraday ? "8%" : "20%"}
        >
          <CartesianGrid
            vertical={false}
            stroke="#e4e7ec"
            strokeDasharray="3 5"
          />
          <XAxis
            dataKey="timestamp"
            tickFormatter={(value) =>
              safeChartDateTime(
                Number(value),
                activePeriod,
                exchangeTimezone,
              )
            }
            tickLine={false}
            axisLine={false}
            minTickGap={isIntraday ? 42 : 34}
            tick={{ fill: "#98a2b3", fontSize: 10 }}
          />
          <YAxis
            yAxisId="price"
            orientation="right"
            domain={[...domain]}
            tickFormatter={formatCompactChartValue}
            tickLine={false}
            axisLine={false}
            width={62}
            tick={{ fill: "#98a2b3", fontSize: 10 }}
          />
          <YAxis yAxisId="volume" domain={[0, maxVolume * 4.2]} hide />
          <Tooltip
            cursor={{ stroke: "#98a2b3", strokeDasharray: "4 4" }}
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
            {bars.map((bar) => (
              <Cell
                key={`volume-${bar.timestamp}`}
                fill={bar.close >= bar.open ? "#d92d45" : "#175cd3"}
                fillOpacity={0.2}
              />
            ))}
          </Bar>

          {planOverlay?.reviewBand ? (
            <ReferenceArea
              yAxisId="price"
              y1={planOverlay.reviewBand.low}
              y2={planOverlay.reviewBand.high}
              fill="#155eef"
              fillOpacity={0.1}
              stroke="#84adff"
              strokeOpacity={0.55}
              strokeDasharray="5 5"
              ifOverflow="extendDomain"
            />
          ) : null}

          {averageCost && averageCost > 0 ? (
            <ReferenceLine
              yAxisId="price"
              y={averageCost}
              stroke="#667085"
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
            shape={(props) => <CandlestickShape {...props} />}
            isAnimationActive={false}
          />

          {([5, 20, 60] as const).map((window) =>
            selectedAverages.has(window) ? (
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
  );
}
