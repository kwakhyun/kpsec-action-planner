import { DecisionConversationInputSchema } from "@/lib/decision-contracts";
import {
  computeExecutionDecision,
  type ExecutionCoreSuccess,
} from "@/lib/execution-core";

export const DECISION_INPUT_BASELINE = DecisionConversationInputSchema.parse({
  subjectLabel: "삼성전자",
  symbol: "005930.KS",
  intent: "BUY",
  budgetKrw: 10_000_000,
  holdingQuantity: null,
  deadline: "THIS_WEEK",
  regretPriority: "MISSED_OPPORTUNITY",
  maxAdverseMovePct: 15,
});

export function createDecisionFixture(): ExecutionCoreSuccess {
  const result = computeExecutionDecision({
    direction: DECISION_INPUT_BASELINE.intent,
    budgetKrw: DECISION_INPUT_BASELINE.budgetKrw,
    deadline: DECISION_INPUT_BASELINE.deadline,
    primaryRegret: "MISSED_OPPORTUNITY",
    maxLossPercent: DECISION_INPUT_BASELINE.maxAdverseMovePct,
    maxMovePercent: DECISION_INPUT_BASELINE.maxAdverseMovePct,
    lotSize: 1,
    market: {
      latestClose: 80_000,
      volatility20dPct: 11.4,
      rangeLow: 75_000,
      rangeHigh: 85_000,
      relativeVolume: 1.18,
      freshness: {
        status: "FRESH",
        asOf: "2026-07-17T06:30:00.000Z",
        checkedAt: "2026-07-17T06:30:00.000Z",
        maxAgeMinutes: 10_080,
      },
    },
  });

  if (!result.ok) {
    throw new Error("TEST_DECISION_FIXTURE_FAILURE");
  }

  return result;
}
