import { isDeepStrictEqual } from "node:util";

import {
  DecisionConversationInputSchema,
  DecisionEnvelopeSchema,
  type DecisionFailureCode,
} from "../src/lib/decision-contracts";

const LIVE_INPUT = DecisionConversationInputSchema.parse({
  subjectLabel: "삼성전자",
  symbol: "005930.KS",
  intent: "BUY",
  budgetKrw: 10_000_000,
  holdingQuantity: null,
  deadline: "THIS_WEEK",
  regretPriority: "MISSED_OPPORTUNITY",
  maxAdverseMovePct: 15,
});

const CHECK_NAMES = [
  "responseSchema",
  "liveProvenance",
  "generationSuccess",
  "marketTrace",
  "serverReadyForReview",
  "inputSnapshotMatch",
  "deterministicCore",
  "allocationConservation",
  "explanationGuard",
  "offlineFixtureAbsent",
  "forbiddenContentAbsent",
] as const;

type CheckName = (typeof CHECK_NAMES)[number];
type FailureCategory =
  | "MISSING_CONFIGURATION"
  | "AUTHENTICATION"
  | "MODEL_ACCESS"
  | "QUOTA_OR_RATE_LIMIT"
  | "NETWORK"
  | "TIMEOUT"
  | "REFUSAL"
  | "SCHEMA_OR_GUARDRAIL"
  | "DATA_PROVIDER_FAILURE"
  | "DATA_SCHEMA_FAILURE"
  | "DATA_INSUFFICIENT"
  | "DATA_STALE"
  | "CORE_DECISION_FAILURE";

const checks = Object.fromEntries(
  CHECK_NAMES.map((name) => [name, false]),
) as Record<CheckName, boolean>;

function classifyFailure(code: DecisionFailureCode | null): FailureCategory {
  switch (code) {
    case "MISSING_CONFIGURATION":
    case "AUTHENTICATION":
    case "MODEL_ACCESS":
    case "QUOTA_OR_RATE_LIMIT":
    case "NETWORK":
    case "TIMEOUT":
    case "REFUSAL":
    case "DATA_PROVIDER_FAILURE":
    case "DATA_SCHEMA_FAILURE":
    case "DATA_INSUFFICIENT":
    case "DATA_STALE":
    case "CORE_DECISION_FAILURE":
      return code;
    default:
      return "SCHEMA_OR_GUARDRAIL";
  }
}

function explanationText(explanation: {
  understoodConcern: string;
  oneShotBenefit: string;
  oneShotRisk: string;
  stagedBenefit: string;
  stagedRisk: string;
  priorityReason: string;
}): string {
  return [
    explanation.understoodConcern,
    explanation.oneShotBenefit,
    explanation.oneShotRisk,
    explanation.stagedBenefit,
    explanation.stagedRisk,
    explanation.priorityReason,
  ].join("\n");
}

function report(options: {
  readiness: "LIVE_READY" | "LIVE_BLOCKED";
  model: string;
  provenance: string;
  finalStatus: string;
  marketStatus: string;
  failure: FailureCategory | null;
  typedRequestCount: 0 | 1;
}) {
  console.log(
    JSON.stringify({
      ...options,
      checks,
    }),
  );
}

async function main() {
  if (process.env.RUN_LIVE_SMOKE !== "1") {
    report({
      readiness: "LIVE_BLOCKED",
      model: "NOT_RETURNED",
      provenance: "NOT_CALLED/SKIPPED",
      finalStatus: "SAFETY_PAUSE",
      marketStatus: "NOT_CALLED/SKIPPED",
      failure: "MISSING_CONFIGURATION",
      typedRequestCount: 0,
    });
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.LIVE_SMOKE_BASE_URL ?? "http://127.0.0.1:3300";
  let response: Response;
  try {
    // Deliberately the only request in this harness: no retry or fallback.
    response = await fetch(new URL("/api/decision", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "LIVE", input: LIVE_INPUT }),
      signal: AbortSignal.timeout(65_000),
    });
  } catch (error: unknown) {
    const failure =
      error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError")
        ? "TIMEOUT"
        : "NETWORK";
    report({
      readiness: "LIVE_BLOCKED",
      model: "NOT_RETURNED",
      provenance: "LIVE/FAILURE",
      finalStatus: "SAFETY_PAUSE",
      marketStatus: "UNKNOWN",
      failure,
      typedRequestCount: 1,
    });
    process.exitCode = 1;
    return;
  }

  const headerModel = response.headers.get("X-Decision-Companion-Model");
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    report({
      readiness: "LIVE_BLOCKED",
      model: headerModel ?? "NOT_RETURNED",
      provenance: "LIVE/FAILURE",
      finalStatus: "SAFETY_PAUSE",
      marketStatus: "UNKNOWN",
      failure: "SCHEMA_OR_GUARDRAIL",
      typedRequestCount: 1,
    });
    process.exitCode = 1;
    return;
  }

  const parsed = DecisionEnvelopeSchema.safeParse(payload);
  checks.responseSchema = parsed.success;
  if (!parsed.success) {
    report({
      readiness: "LIVE_BLOCKED",
      model: headerModel ?? "NOT_RETURNED",
      provenance: "LIVE/FAILURE",
      finalStatus: "SAFETY_PAUSE",
      marketStatus: "UNKNOWN",
      failure: "SCHEMA_OR_GUARDRAIL",
      typedRequestCount: 1,
    });
    process.exitCode = 1;
    return;
  }

  const envelope = parsed.data;
  const model = envelope.generation.model ?? headerModel ?? "NOT_RETURNED";
  checks.liveProvenance =
    envelope.generation.requestedMode === "LIVE" &&
    envelope.generation.mode === "LIVE";
  checks.generationSuccess = envelope.generation.outcome === "SUCCESS";
  checks.serverReadyForReview =
    envelope.status === "READY_FOR_REVIEW" &&
    envelope.decision?.status === "READY_FOR_REVIEW";
  checks.inputSnapshotMatch = isDeepStrictEqual(
    envelope.inputSnapshot,
    LIVE_INPUT,
  );
  checks.deterministicCore =
    envelope.decision?.selectedBy === "DETERMINISTIC_CORE" &&
    envelope.decision.limits.predictsFuturePrice === false &&
    envelope.decision.limits.executesOrder === false &&
    envelope.decision.limits.selectsSecurity === false;
  checks.allocationConservation =
    envelope.decision?.plans.every(
      (plan) =>
        plan.allocations.reduce((sum, allocation) => sum + allocation.shares, 0) ===
        plan.totalShares,
    ) ?? false;
  checks.explanationGuard = Boolean(
    envelope.explanation &&
      envelope.decision &&
      envelope.explanation.priorityPlanId === envelope.decision.preferredPlanId,
  );
  checks.offlineFixtureAbsent =
    envelope.generation.fixtureId === null &&
    envelope.generation.fixtureVersion === null &&
    envelope.market.snapshot?.synthetic === false;

  if (envelope.market.snapshot) {
    let sourceHost = "";
    try {
      sourceHost = envelope.market.snapshot.sourceUrl
        ? new URL(envelope.market.snapshot.sourceUrl).hostname
        : "";
    } catch {
      sourceHost = "";
    }
    checks.marketTrace =
      envelope.market.mode === "YAHOO_LIVE" &&
      envelope.market.outcome === "SUCCESS" &&
      envelope.market.snapshot.provider === "Yahoo Finance" &&
      sourceHost === "query1.finance.yahoo.com" &&
      Date.parse(envelope.market.snapshot.asOf) <=
        Date.parse(envelope.market.snapshot.fetchedAt) &&
      envelope.market.snapshot.metrics.relativeVolume20d !== null;
  }

  if (envelope.explanation) {
    const text = explanationText(envelope.explanation);
    checks.forbiddenContentAbsent =
      !/[0-9０-９]/.test(text) &&
      !/\b(?:BUY|SELL|ONE_SHOT|STAGED_[23]|PRICE_RISK|MISSED_OPPORTUNITY)\b/.test(
        text,
      ) &&
      !/(?:반드시\s*(?:오르|오를|내리|내릴|이익)|확실한\s*수익|원금\s*보장|수익(?:률)?\s*(?:예측|보장)|상승할\s*것|하락할\s*것|매수하세요|매도하세요|주문하세요)/.test(
        text,
      );
  }

  const success = response.ok && Object.values(checks).every(Boolean);
  if (success) {
    report({
      readiness: "LIVE_READY",
      model,
      provenance: "LIVE/SUCCESS",
      finalStatus: envelope.status,
      marketStatus: "YAHOO_LIVE/SUCCESS",
      failure: null,
      typedRequestCount: 1,
    });
    return;
  }

  report({
    readiness: "LIVE_BLOCKED",
    model,
    provenance: `${envelope.generation.mode}/${envelope.generation.outcome}`,
    finalStatus: envelope.status,
    marketStatus: `${envelope.market.mode}/${envelope.market.outcome}`,
    failure: classifyFailure(envelope.generation.failureCode),
    typedRequestCount: 1,
  });
  process.exitCode = 1;
}

void main();
