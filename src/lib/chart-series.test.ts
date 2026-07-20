import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateChartBars,
  CHART_UNIT_LABELS,
  MAX_CHART_ZOOM_LEVEL,
  zoomChartBars,
  type ChartSeriesBar,
} from "./chart-series";

function bar(date: string, close: number, volume = 100): ChartSeriesBar {
  const timestamp = Math.floor(new Date(`${date}T03:00:00.000Z`).getTime() / 1_000);
  return {
    timestamp,
    open: close - 2,
    high: close + 4,
    low: close - 5,
    close,
    volume,
  };
}

test("차트 단위는 분·일·주·월·년을 정확히 노출한다", () => {
  assert.deepEqual(CHART_UNIT_LABELS, {
    MINUTE: "분",
    DAY: "일",
    WEEK: "주",
    MONTH: "월",
    YEAR: "년",
  });
});

test("검증된 일봉을 주·월·년 OHLCV로 결정론적으로 묶는다", () => {
  const source = [
    bar("2025-12-29", 100, 10),
    bar("2025-12-30", 110, 20),
    bar("2026-01-02", 105, 30),
    bar("2026-02-02", 120, 40),
  ];

  const weekly = aggregateChartBars(source, "WEEK", "Asia/Seoul");
  assert.equal(weekly.length, 2);
  assert.deepEqual(weekly[0], {
    timestamp: source[0].timestamp,
    open: 98,
    high: 114,
    low: 95,
    close: 105,
    volume: 60,
  });

  const monthly = aggregateChartBars(source, "MONTH", "Asia/Seoul");
  assert.equal(monthly.length, 3);
  assert.equal(monthly[0].open, 98);
  assert.equal(monthly[0].close, 110);
  assert.equal(monthly[0].volume, 30);

  const yearly = aggregateChartBars(source, "YEAR", "Asia/Seoul");
  assert.equal(yearly.length, 2);
  assert.equal(yearly[1].open, 103);
  assert.equal(yearly[1].close, 120);
  assert.equal(yearly[1].volume, 70);
});

test("확대는 최신 봉을 중심으로 줄이고 전체 보기로 원복할 수 있다", () => {
  const source = Array.from({ length: 100 }, (_, index) =>
    bar(`2026-04-${String((index % 28) + 1).padStart(2, "0")}`, 100 + index),
  ).map((item, index) => ({ ...item, timestamp: item.timestamp + index * 86_400 }));

  assert.equal(zoomChartBars(source, 0).length, 100);
  assert.equal(zoomChartBars(source, 1).length, 60);
  assert.equal(zoomChartBars(source, MAX_CHART_ZOOM_LEVEL).length, 20);
  assert.equal(zoomChartBars(source, MAX_CHART_ZOOM_LEVEL).at(-1)?.close, 199);
  assert.deepEqual(zoomChartBars(source, 0), source);
});
