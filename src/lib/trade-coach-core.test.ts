import assert from "node:assert/strict";
import test from "node:test";

import { calculateTradeCoach } from "./trade-coach-core";
import { createMarketView } from "./market-view";

const bars = Array.from({ length: 62 }, (_, index) => {
  const close = 76_950 + index * 50;
  return {
    timestamp: Date.parse("2026-05-18T06:30:00.000Z") / 1_000 + index * 86_400,
    open: close - 100,
    high: close + 300,
    low: close - 300,
    close,
    volume: 1_000_000 + index * 10_000,
  };
});

const market = createMarketView({
  symbol: "005930.KS",
  bars,
  metrics: {
    latestPrice: 80_000,
    volatility20dPct: 18,
    range20d: { low: 77_000, high: 81_000, percent: 5 },
    relativeVolume20d: 1.1,
  },
  provider: "Yahoo Finance",
  sourceUrl:
    "https://query1.finance.yahoo.com/v8/finance/chart/005930.KS?range=3mo&interval=1d",
  fetchedAt: "2026-07-18T06:40:00.000Z",
  asOf: "2026-07-18T06:30:00.000Z",
  range: "3mo",
  interval: "1d",
  delayNotice: "공개 데이터는 지연될 수 있으며 실시간 호가가 아닙니다.",
  synthetic: false,
  currency: "KRW",
  exchange: "KSC",
  exchangeTimezone: "Asia/Seoul",
});

const POSITION_INPUT = {
  concern: "HOLDING_ANXIETY" as const,
  subjectLabel: "삼성전자",
  symbol: "005930.KS",
  budgetKrw: null,
  averageCostKrw: 100_000,
  holdingQuantity: 100,
  horizon: "MONTHS" as const,
  deadline: "NO_RUSH" as const,
  maxLossPercent: 8,
  profitCriterionPercent: 10,
  sellPlanPreference: "STAGED" as const,
  regretPriority: "PRICE_RISK" as const,
  orderStylePreference: "PRICE_CONTROL" as const,
  selectedChartInterval: "ONE_MINUTE" as const,
  market,
};

test("보유 후 평가손익과 사용자 손실·이익 재확인선을 결정론적으로 계산한다", () => {
  const result = calculateTradeCoach(POSITION_INPUT);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.position, {
    referenceAverageCostKrw: 100_000,
    currentPriceKrw: 80_000,
    quantity: 100,
    investedAmountKrw: 10_000_000,
    currentValuationKrw: 8_000_000,
    profitLossAmountKrw: -2_000_000,
    profitLossPercent: -20,
    direction: "LOSS",
    meaning:
      "현재 평가손익은 사용자가 입력한 평균 매수가와 공개 데이터의 최근 가격으로만 계산했습니다.",
  });
  assert.equal(result.reviewLines.loss?.reviewPriceKrw, 92_000);
  assert.equal(result.reviewLines.loss?.profitLossAmountAtReviewKrw, -800_000);
  assert.equal(result.reviewLines.profit?.reviewPriceKrw, 110_000);
  assert.equal(result.reviewLines.profit?.profitLossAmountAtReviewKrw, 1_000_000);
});

test("전량·두 번·세 번 비교가 수량을 보존하고 사용자 분할 선호를 반영한다", () => {
  const result = calculateTradeCoach(POSITION_INPUT);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(
    result.execution.core.plans.map((plan) => plan.id),
    ["ONE_SHOT", "STAGED_2", "STAGED_3"],
  );
  assert.equal(result.execution.preferredPlanId, "STAGED_3");
  for (const plan of result.execution.core.plans) {
    assert.equal(
      plan.allocations.reduce((sum, allocation) => sum + allocation.shares, 0),
      100,
    );
  }
});

test("시장가·지정가 코치는 호가·최적가·슬리피지·체결 확률을 만들지 않는다", () => {
  const result = calculateTradeCoach(POSITION_INPUT);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.orderStyle.preferredReviewStyle, "LIMIT_FIRST");
  assert.equal(result.orderStyle.orderBookStatus, "NO_ORDER_BOOK");
  assert.equal(result.orderStyle.limitPriceKrw, null);
  assert.equal(result.orderStyle.estimatedSlippagePercent, null);
  assert.equal(result.orderStyle.fillProbabilityPercent, null);
  assert.match(result.orderStyle.limitation, /실시간 호가를 확인하지 않았습니다/);
});

test("분봉과 장기 계획의 불일치는 관찰 행동만 설명하고 세 선택을 강제하지 않는다", () => {
  const result = calculateTradeCoach(POSITION_INPUT);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.timeAxis.mismatchDetected, true);
  assert.match(result.timeAxis.observation, /몇 달 보유할 계획.*1분 움직임/);
  assert.doesNotMatch(result.timeAxis.observation, /불안|충동|공포|성급/);
  assert.deepEqual(
    result.timeAxis.actions.map((action) => action.key),
    ["WIDEN_TO_DAILY", "REVIEW_ORIGINAL_PLAN", "KEEP_CURRENT_CHART"],
  );
  assert.equal(result.timeAxis.forcedChange, false);
  assert.match(result.timeAxis.limitation, /강제로 바꾸지 않습니다/);
});
