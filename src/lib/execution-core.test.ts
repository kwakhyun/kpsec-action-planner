import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateRegretBudgetExecution,
  ExecutionCoreResultSchema,
  type RegretBudgetExecutionInput,
} from "./execution-core";

const BASE_BUY: RegretBudgetExecutionInput = {
  direction: "BUY",
  budgetKrw: 10_000_000,
  deadline: "THIS_WEEK",
  primaryRegret: "PRICE_MOVE",
  maxLossPercent: 5,
  maxMovePercent: 3,
  lotSize: 1,
  market: {
    latestClose: 72_500,
    volatility20dPct: 2.4,
    rangeLow: 69_000,
    rangeHigh: 75_000,
    relativeVolume: 1.3,
    freshness: {
      status: "FRESH",
      asOf: "2026-07-17T06:30:00.000Z",
      checkedAt: "2026-07-17T06:40:00.000Z",
      maxAgeMinutes: 30,
    },
  },
};

test("삼성전자 1,000만원 BUY는 일괄·2회·3회 안과 정확한 잔액을 계산한다", () => {
  const result = calculateRegretBudgetExecution(BASE_BUY);

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.preferredPlanId, "STAGED_3");
  assert.deepEqual(
    result.plans.map((plan) => plan.id),
    ["ONE_SHOT", "STAGED_2", "STAGED_3"],
  );
  assert.deepEqual(
    result.plans.find((plan) => plan.id === "STAGED_3")?.allocations.map(
      (allocation) => allocation.shares,
    ),
    [46, 46, 45],
  );
  assert.equal(result.plans[0].totalShares, 137);
  assert.equal(result.plans[0].referenceTotalAmountKrw, 9_932_500);
  assert.equal(result.plans[0].unallocatedBudgetKrw, 67_500);
  assert.equal(ExecutionCoreResultSchema.safeParse(result).success, true);
});

test("놓칠 위험을 더 걱정하면 동일한 숫자에서도 일괄안을 우선한다", () => {
  const result = calculateRegretBudgetExecution({
    ...BASE_BUY,
    primaryRegret: "MISSED_OPPORTUNITY",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.preferredPlanId, "ONE_SHOT");
  assert.ok(
    result.rationaleKeys.includes("MISSED_OPPORTUNITY_REGRET"),
  );
});

test("연환산 20일 변동성이 100%를 넘어도 검증된 관측값이면 계산한다", () => {
  const result = calculateRegretBudgetExecution({
    ...BASE_BUY,
    primaryRegret: "MISSED_OPPORTUNITY",
    market: {
      ...BASE_BUY.market,
      volatility20dPct: 106.4,
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.signals.volatilityAboveLossTolerance, true);
  assert.equal(result.preferredPlanId, "ONE_SHOT");
});

test("감당 범위를 바꾸면 총수량은 유지하면서 우선 분할 횟수만 바뀐다", () => {
  const wideTolerance = calculateRegretBudgetExecution({
    ...BASE_BUY,
    maxLossPercent: 15,
    maxMovePercent: 15,
  });
  const narrowTolerance = calculateRegretBudgetExecution({
    ...BASE_BUY,
    maxLossPercent: 2,
    maxMovePercent: 2,
  });

  assert.equal(wideTolerance.ok, true);
  assert.equal(narrowTolerance.ok, true);
  if (!wideTolerance.ok || !narrowTolerance.ok) return;

  assert.equal(wideTolerance.preferredPlanId, "STAGED_2");
  assert.equal(narrowTolerance.preferredPlanId, "STAGED_3");
  assert.deepEqual(
    wideTolerance.plans.map((plan) => plan.totalShares),
    narrowTolerance.plans.map((plan) => plan.totalShares),
  );
  assert.notEqual(
    wideTolerance.plans[0].reviewLine.lowerReviewPriceKrw,
    narrowTolerance.plans[0].reviewLine.lowerReviewPriceKrw,
  );
});

test("놓칠 위험 사용자도 감당 범위를 낮추면 선행 비중과 중단선이 함께 낮아진다", () => {
  const wideTolerance = calculateRegretBudgetExecution({
    ...BASE_BUY,
    primaryRegret: "MISSED_OPPORTUNITY",
    maxLossPercent: 15,
    maxMovePercent: 15,
  });
  const narrowTolerance = calculateRegretBudgetExecution({
    ...BASE_BUY,
    primaryRegret: "MISSED_OPPORTUNITY",
    maxLossPercent: 2,
    maxMovePercent: 2,
  });

  assert.equal(wideTolerance.ok, true);
  assert.equal(narrowTolerance.ok, true);
  if (!wideTolerance.ok || !narrowTolerance.ok) return;

  const wideThree = wideTolerance.plans.find((plan) => plan.id === "STAGED_3");
  const narrowThree = narrowTolerance.plans.find(
    (plan) => plan.id === "STAGED_3",
  );
  assert.deepEqual(
    wideThree?.allocations.map((allocation) => allocation.shares),
    [69, 41, 27],
  );
  assert.deepEqual(
    narrowThree?.allocations.map((allocation) => allocation.shares),
    [55, 48, 34],
  );
  assert.ok(
    (wideThree?.reviewLine.lowerReviewPriceKrw ?? 0) <
      (narrowThree?.reviewLine.lowerReviewPriceKrw ?? 0),
  );
});

test("SELL은 보유수량을 보존하고 각 안의 기준금액을 코어가 소유한다", () => {
  const result = calculateRegretBudgetExecution({
    direction: "SELL",
    holdingQuantity: 125,
    deadline: "TODAY",
    primaryRegret: "PRICE_MOVE",
    maxLossPercent: 5,
    maxMovePercent: 4,
    lotSize: 1,
    market: BASE_BUY.market,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.preferredPlanId, "STAGED_2");
  for (const plan of result.plans) {
    assert.equal(plan.totalShares, 125);
    assert.equal(plan.referenceTotalAmountKrw, 9_062_500);
    assert.equal(plan.remainingHoldingQuantity, 0);
  }
  assert.deepEqual(
    result.plans.find((plan) => plan.id === "STAGED_3")?.allocations.map(
      (allocation) => allocation.shares,
    ),
    [42, 42, 41],
  );
});

test("거래단위 반올림과 나머지를 모든 대안에서 정확히 보존한다", () => {
  const result = calculateRegretBudgetExecution({
    ...BASE_BUY,
    lotSize: 10,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  for (const plan of result.plans) {
    assert.equal(plan.totalShares, 130);
    assert.equal(
      plan.allocations.reduce((sum, allocation) => sum + allocation.shares, 0),
      130,
    );
    assert.equal(
      plan.allocations.reduce((sum, allocation) => sum + allocation.amountKrw, 0),
      9_425_000,
    );
    assert.equal(plan.unallocatedBudgetKrw, 575_000);
  }
});

test("노후 데이터는 계산 결과 없이 MARKET_DATA_STALE로 멈춘다", () => {
  const result = calculateRegretBudgetExecution({
    ...BASE_BUY,
    market: {
      ...BASE_BUY.market,
      freshness: {
        ...BASE_BUY.market.freshness,
        checkedAt: "2026-07-17T08:00:00.000Z",
      },
    },
  });

  assert.deepEqual(result, {
    ok: false,
    status: "SAFETY_PAUSE",
    failureCode: "MARKET_DATA_STALE",
    reasons: [
      {
        path: "market.freshness",
        message: "시장 데이터가 허용된 최신성 범위를 벗어났습니다.",
      },
    ],
  });
});

test("분할 비교가 불가능한 예산은 안전하게 멈춘다", () => {
  const result = calculateRegretBudgetExecution({
    ...BASE_BUY,
    budgetKrw: 100_000,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, "SAFETY_PAUSE");
  assert.equal(result.failureCode, "INSUFFICIENT_EXECUTABLE_QUANTITY");
});

test("모순된 가격 범위는 Zod 입력 검증에서 fail closed한다", () => {
  const result = calculateRegretBudgetExecution({
    ...BASE_BUY,
    market: {
      ...BASE_BUY.market,
      latestClose: 80_000,
    },
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, "SAFETY_PAUSE");
  assert.equal(result.failureCode, "INVALID_INPUT");
  assert.equal(result.reasons[0].path, "market.latestClose");
});
