import {
  DecisionEnvelopeSchema,
  type DecisionConversationInput,
  type DecisionEnvelope,
} from "./decision-contracts";
import {
  computeExecutionDecision,
  type ExecutionCoreSuccess,
  type ExecutionPlan,
} from "./execution-core";
import type { MarketView } from "./market-view";

export function buildExecutionFromMarket(
  input: DecisionConversationInput,
  market: MarketView,
): ExecutionCoreSuccess | null {
  if (
    market.provenance.currency !== "KRW" ||
    market.metrics.relativeVolume20d === null
  ) {
    return null;
  }

  const result = computeExecutionDecision({
    direction: input.intent,
    ...(input.intent === "BUY"
      ? { budgetKrw: input.budgetKrw ?? 0 }
      : { holdingQuantity: input.holdingQuantity ?? 0 }),
    deadline: input.deadline,
    primaryRegret:
      input.regretPriority === "PRICE_RISK"
        ? "PRICE_MOVE"
        : "MISSED_OPPORTUNITY",
    maxLossPercent: input.maxAdverseMovePct,
    maxMovePercent: input.maxAdverseMovePct,
    lotSize: 1,
    market: {
      latestClose: Math.round(market.quote.latestPrice),
      volatility20dPct: market.metrics.volatility20dPct,
      rangeLow: Math.round(market.metrics.range20d.low),
      rangeHigh: Math.round(market.metrics.range20d.high),
      relativeVolume: market.metrics.relativeVolume20d,
      freshness: {
        status: "FRESH",
        asOf: market.provenance.asOf,
        checkedAt: market.provenance.fetchedAt,
        maxAgeMinutes: 10_080,
      },
    },
  });

  return result.ok ? result : null;
}

export function localCoreEnvelope(
  input: DecisionConversationInput,
  market: MarketView,
  decision: ExecutionCoreSuccess,
): DecisionEnvelope {
  return DecisionEnvelopeSchema.parse({
    status: "READY_FOR_REVIEW",
    generation: {
      requestedMode: "LIVE",
      mode: "NOT_CALLED",
      outcome: "SKIPPED",
      failureCode: null,
      fixtureId: null,
      fixtureVersion: null,
      model: null,
    },
    market: {
      mode: "YAHOO_LIVE",
      outcome: "SUCCESS",
      failureCode: null,
      snapshot: {
        symbol: market.symbol,
        provider: market.provenance.provider,
        sourceUrl: market.provenance.sourceUrl,
        fetchedAt: market.provenance.fetchedAt,
        asOf: market.provenance.asOf,
        range: market.provenance.range,
        interval: market.provenance.interval,
        delayNotice: market.provenance.delayNotice,
        synthetic: false,
        currency: market.provenance.currency,
        exchange: market.provenance.exchange,
        metrics: market.metrics,
      },
    },
    inputSnapshot: input,
    decision,
    explanation: null,
    failureMessage: null,
  });
}

export function preferredPlan(
  decision: ExecutionCoreSuccess | null,
): ExecutionPlan | null {
  if (!decision) return null;
  return (
    decision.plans.find((plan) => plan.id === decision.preferredPlanId) ?? null
  );
}

export function stagedPlan(
  decision: ExecutionCoreSuccess | null,
): ExecutionPlan | null {
  if (!decision) return null;
  return (
    decision.plans.find((plan) => plan.id === "STAGED_3") ??
    decision.plans.find((plan) => plan.id === "STAGED_2") ??
    null
  );
}

export function planLabel(planId: ExecutionPlan["id"]): string {
  if (planId === "ONE_SHOT") return "한 번에 확인하는 계획";
  if (planId === "STAGED_2") return "두 번으로 나누는 계획";
  return "세 번으로 나누는 계획";
}
