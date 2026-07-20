import {
  DecisionConversationInputSchema,
  DecisionEnvelopeSchema,
  type AgentDecisionExplanation,
  type DecisionConversationInput,
  type DecisionEnvelope,
  type DecisionMarketSnapshot,
} from "./decision-contracts";
import {
  computeExecutionDecision,
  type ExecutionCoreSuccess,
} from "./execution-core";

export const DECISION_DEMO_VERSION = "3.0.0" as const;

export const DECISION_DEMO_BASELINE: DecisionConversationInput =
  DecisionConversationInputSchema.parse({
    subjectLabel: "삼성전자",
    symbol: "005930.KS",
    intent: "BUY",
    budgetKrw: 10_000_000,
    holdingQuantity: null,
    deadline: "THIS_WEEK",
    regretPriority: "MISSED_OPPORTUNITY",
    maxAdverseMovePct: 15,
  });

export const DECISION_DEMO_TOLERANCE_CHANGE: DecisionConversationInput =
  DecisionConversationInputSchema.parse({
    ...DECISION_DEMO_BASELINE,
    maxAdverseMovePct: 4,
  });

const SYNTHETIC_MARKET: DecisionMarketSnapshot = {
  symbol: "005930.KS",
  provider: "SYNTHETIC OHLCV FIXTURE",
  sourceUrl: null,
  fetchedAt: "2026-07-17T06:30:00.000Z",
  asOf: "2026-07-17T06:30:00.000Z",
  range: "고정 합성 최근 구간",
  interval: "합성 일별 데이터",
  delayNotice:
    "화면 체험용 합성 데이터이며 Yahoo Finance 조회 결과나 실제 투자정보가 아닙니다.",
  synthetic: true,
  currency: "KRW",
  exchange: "SYNTHETIC",
  metrics: {
    latestPrice: 80_000,
    volatility20dPct: 11.4,
    range20d: {
      high: 85_000,
      low: 75_000,
      percent: 12.5,
    },
    relativeVolume20d: 1.18,
  },
};

function coreFor(input: DecisionConversationInput): ExecutionCoreSuccess {
  const result = computeExecutionDecision({
    direction: input.intent,
    ...(input.intent === "BUY"
      ? { budgetKrw: input.budgetKrw }
      : { holdingQuantity: input.holdingQuantity }),
    deadline: input.deadline,
    primaryRegret:
      input.regretPriority === "PRICE_RISK"
        ? "PRICE_MOVE"
        : "MISSED_OPPORTUNITY",
    maxLossPercent: input.maxAdverseMovePct,
    maxMovePercent: input.maxAdverseMovePct,
    lotSize: 1,
    market: {
      latestClose: SYNTHETIC_MARKET.metrics.latestPrice,
      volatility20dPct: SYNTHETIC_MARKET.metrics.volatility20dPct,
      rangeLow: SYNTHETIC_MARKET.metrics.range20d.low,
      rangeHigh: SYNTHETIC_MARKET.metrics.range20d.high,
      relativeVolume: SYNTHETIC_MARKET.metrics.relativeVolume20d,
      freshness: {
        status: "FRESH",
        asOf: SYNTHETIC_MARKET.asOf,
        checkedAt: SYNTHETIC_MARKET.fetchedAt,
        maxAgeMinutes: 10_080,
      },
    },
  });

  if (!result.ok) {
    throw new Error("OFFLINE_DECISION_CORE_FAILURE");
  }
  return result;
}

function fixedExplanation(decision: ExecutionCoreSuccess): AgentDecisionExplanation {
  return {
    understoodConcern:
      "나누어 확인하는 동안 기회를 놓칠 걱정이 더 큰 매수 고민으로 이해했습니다.",
    oneShotBenefit:
      "계획한 수량을 남겨 두는 부담을 줄일 수 있습니다.",
    oneShotRisk:
      "전체 수량이 한 시점의 확인 가격에 영향을 받습니다.",
    stagedBenefit:
      "한 가격에 몰리는 부담을 여러 확인 시점으로 나눌 수 있습니다.",
    stagedRisk:
      "다음 확인 전 가격이 움직이면 계획한 수량을 모두 검토하지 못할 수 있습니다.",
    priorityPlanId: decision.preferredPlanId,
    priorityReason:
      "기다리는 동안 가격이 올라 기회를 놓치는 상황을 더 걱정한다고 답했습니다. 그래서 한 번에 확인하는 방법을 먼저 보여드립니다. 최근 가격 움직임이나 감당 범위가 달라지면 계획도 다시 계산합니다.",
    nextQuestionKey: "NONE",
  };
}

function successEnvelope(
  input: DecisionConversationInput,
  fixtureId: string,
): DecisionEnvelope {
  const decision = coreFor(input);
  return DecisionEnvelopeSchema.parse({
    status: "READY_FOR_REVIEW",
    generation: {
      requestedMode: "OFFLINE_DEMO",
      mode: "OFFLINE_DEMO",
      outcome: "SUCCESS",
      failureCode: null,
      fixtureId,
      fixtureVersion: DECISION_DEMO_VERSION,
      model: null,
    },
    market: {
      mode: "SYNTHETIC_FIXTURE",
      outcome: "SUCCESS",
      failureCode: null,
      snapshot: SYNTHETIC_MARKET,
    },
    inputSnapshot: input,
    decision,
    explanation: fixedExplanation(decision),
    failureMessage: null,
  });
}

export type DecisionDemoScenario =
  | "BASELINE"
  | "TOLERANCE_CHANGE"
  | "DATA_FAILURE";

export function runOfflineDecisionDemo(
  scenario: DecisionDemoScenario,
): DecisionEnvelope {
  if (scenario === "BASELINE") {
    return structuredClone(
      successEnvelope(
        DECISION_DEMO_BASELINE,
        "REGRET_BUDGET_SAMSUNG_BASELINE",
      ),
    );
  }
  if (scenario === "TOLERANCE_CHANGE") {
    return structuredClone(
      successEnvelope(
        DECISION_DEMO_TOLERANCE_CHANGE,
        "REGRET_BUDGET_SAMSUNG_TOLERANCE_CHANGE",
      ),
    );
  }

  return DecisionEnvelopeSchema.parse({
    status: "SAFETY_PAUSE",
    generation: {
      requestedMode: "OFFLINE_DEMO",
      mode: "NOT_CALLED",
      outcome: "SKIPPED",
      failureCode: "DATA_PROVIDER_FAILURE",
      fixtureId: "REGRET_BUDGET_MARKET_FAILURE",
      fixtureVersion: DECISION_DEMO_VERSION,
      model: null,
    },
    market: {
      mode: "SYNTHETIC_FIXTURE",
      outcome: "FAILURE",
      failureCode: "DATA_PROVIDER_FAILURE",
      snapshot: null,
    },
    inputSnapshot: DECISION_DEMO_BASELINE,
    decision: null,
    explanation: null,
    failureMessage:
      "시장 데이터를 확인하지 못해 수량과 우선 검토안을 만들지 않았습니다. 준비된 성공 결과로 바꾸지 않습니다.",
  });
}

export function isRegisteredDecisionDemoInput(
  input: DecisionConversationInput,
): boolean {
  return (
    JSON.stringify(input) === JSON.stringify(DECISION_DEMO_BASELINE) ||
    JSON.stringify(input) === JSON.stringify(DECISION_DEMO_TOLERANCE_CHANGE)
  );
}
