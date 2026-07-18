import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

import {
  AdversarialReviewEnvelopeSchema,
  AdversarialReviewRequestSchema,
  type AdversarialFailureCode,
} from "../src/lib/adversarial-review-contracts";
import { calculateRegretBudgetExecution } from "../src/lib/execution-core";

const CHECK_NAMES = [
  "storeFalseConfigured",
  "responseSchema",
  "liveProvenance",
  "generationSuccess",
  "structuredResult",
  "validFactReferences",
  "inputSnapshotMatch",
  "noNewNumericDateOrPrediction",
  "noFixtureFallback",
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
  | "SCHEMA_OR_GUARDRAIL";

const checks = Object.fromEntries(
  CHECK_NAMES.map((name) => [name, false]),
) as Record<CheckName, boolean>;

const core = calculateRegretBudgetExecution({
  direction: "BUY",
  budgetKrw: 10_000_000,
  deadline: "THIS_WEEK",
  primaryRegret: "PRICE_MOVE",
  maxLossPercent: 8,
  maxMovePercent: 8,
  lotSize: 1,
  market: {
    latestClose: 80_000,
    volatility20dPct: 18,
    rangeLow: 77_000,
    rangeHigh: 81_000,
    relativeVolume: 1.1,
    freshness: {
      status: "FRESH",
      asOf: "2026-07-17T06:30:00.000Z",
      checkedAt: "2026-07-17T06:40:00.000Z",
      maxAgeMinutes: 30,
    },
  },
});

if (!core.ok) throw new Error("SMOKE_CORE_FAILURE");

const LIVE_INPUT = AdversarialReviewRequestSchema.parse({
  mode: "LIVE",
  subjectLabel: "공개 시연 종목",
  symbol: "005930.KS",
  userInput: {
    concernMode: "PRE_BUY",
    intent: "BUY",
    constraints: [
      { key: "DEADLINE", label: "실행기한", value: "THIS_WEEK" },
      { key: "LOSS_TOLERANCE", label: "감당 가능한 손실 범위", value: 8 },
      { key: "BUDGET", label: "매수 예산", value: 10_000_000 },
      { key: "SELECTED_PLAN", label: "선택 실행안", value: core.preferredPlanId },
    ],
  },
  facts: [
    {
      id: "MARKET_LATEST_PRICE",
      label: "최근 확인 가격",
      observation: "공개 시연 입력에서 검증한 최근 가격입니다.",
      sourceLabel: "Yahoo Finance 공개 데이터 기반 비식별 시연 입력",
    },
    {
      id: "MARKET_VOLATILITY_20D",
      label: "최근 변동성",
      observation: "공개 시연 입력에서 검증한 최근 변동성입니다.",
      sourceLabel: "Yahoo Finance 공개 데이터 기반 비식별 시연 입력",
    },
    {
      id: "MARKET_RANGE_20D",
      label: "최근 고저 범위",
      observation: "공개 시연 입력에서 검증한 최근 고저 범위입니다.",
      sourceLabel: "Yahoo Finance 공개 데이터 기반 비식별 시연 입력",
    },
  ],
  currentPlan: core,
  dataContext: {
    asOf: "2026-07-17T06:30:00.000Z",
    fetchedAt: "2026-07-17T06:40:00.000Z",
    limitations: [
      "실시간 호가와 주문 잔량을 확인하지 않았습니다.",
      "미래 가격이나 수익을 예측하지 않습니다.",
    ],
  },
  missingInformation: ["실시간 호가와 체결 가능성"],
  allowedQuestionKeys: [
    "CONFIRM_REGRET_PRIORITY",
    "CONFIRM_DEADLINE",
    "CONFIRM_LOSS_TOLERANCE",
    "CONFIRM_ORDER_PRIORITY",
  ],
});

function classifyFailure(code: AdversarialFailureCode | null): FailureCategory {
  switch (code) {
    case "MISSING_CONFIGURATION":
    case "AUTHENTICATION":
    case "MODEL_ACCESS":
    case "QUOTA_OR_RATE_LIMIT":
    case "NETWORK":
    case "TIMEOUT":
    case "REFUSAL":
      return code;
    default:
      return "SCHEMA_OR_GUARDRAIL";
  }
}

function report(options: {
  readiness: "LIVE_READY" | "LIVE_BLOCKED";
  model: string;
  provenance: string;
  finalStatus: string;
  failure: FailureCategory | null;
  typedRequestCount: 0 | 1;
}) {
  console.log(JSON.stringify({ ...options, checks }));
}

function prose(result: {
  counterarguments: Array<{ argument: string }>;
  unverifiedAssumption: string;
  question: string;
  whatWouldChangePlan: string;
}): string {
  return [
    ...result.counterarguments.map((item) => item.argument),
    result.unverifiedAssumption,
    result.question,
    result.whatWouldChangePlan,
  ].join("\n");
}

async function main() {
  if (process.env.RUN_LIVE_SMOKE !== "1") {
    report({
      readiness: "LIVE_BLOCKED",
      model: "NOT_RETURNED",
      provenance: "NOT_CALLED/SKIPPED",
      finalStatus: "SAFETY_PAUSE",
      failure: "MISSING_CONFIGURATION",
      typedRequestCount: 0,
    });
    process.exitCode = 1;
    return;
  }

  const generatorSource = readFileSync(
    new URL("../src/lib/generate-adversarial-review.ts", import.meta.url),
    "utf8",
  );
  checks.storeFalseConfigured = /\bstore:\s*false\b/.test(generatorSource);
  if (!checks.storeFalseConfigured) {
    report({
      readiness: "LIVE_BLOCKED",
      model: "NOT_RETURNED",
      provenance: "NOT_CALLED/SKIPPED",
      finalStatus: "SAFETY_PAUSE",
      failure: "SCHEMA_OR_GUARDRAIL",
      typedRequestCount: 0,
    });
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.LIVE_SMOKE_BASE_URL ?? "http://127.0.0.1:3300";
  let response: Response;
  try {
    // This is deliberately the only typed request: no retry and no fixture fallback.
    response = await fetch(new URL("/api/adversarial-review", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(LIVE_INPUT),
      signal: AbortSignal.timeout(45_000),
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
      failure,
      typedRequestCount: 1,
    });
    process.exitCode = 1;
    return;
  }

  const headerModel = response.headers.get("X-Adversarial-Review-Model");
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    report({
      readiness: "LIVE_BLOCKED",
      model: headerModel ?? "NOT_RETURNED",
      provenance: "LIVE/FAILURE",
      finalStatus: "SAFETY_PAUSE",
      failure: "SCHEMA_OR_GUARDRAIL",
      typedRequestCount: 1,
    });
    process.exitCode = 1;
    return;
  }

  const parsed = AdversarialReviewEnvelopeSchema.safeParse(payload);
  checks.responseSchema = parsed.success;
  if (!parsed.success) {
    report({
      readiness: "LIVE_BLOCKED",
      model: headerModel ?? "NOT_RETURNED",
      provenance: "LIVE/FAILURE",
      finalStatus: "SAFETY_PAUSE",
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
  checks.structuredResult =
    response.ok &&
    envelope.status === "READY_FOR_REVIEW" &&
    envelope.result !== null;
  checks.inputSnapshotMatch = isDeepStrictEqual(
    envelope.inputSnapshot,
    LIVE_INPUT,
  );
  checks.noFixtureFallback =
    envelope.generation.mode === "LIVE" &&
    !JSON.stringify(envelope).includes("OFFLINE_DEMO") &&
    !JSON.stringify(envelope).includes("fixture");

  if (envelope.result) {
    const factIds = new Set(LIVE_INPUT.facts.map((fact) => fact.id));
    checks.validFactReferences = envelope.result.counterarguments.every(
      (item) =>
        new Set(item.factIds).size === item.factIds.length &&
        item.factIds.every((id) => factIds.has(id)),
    );
    const outputText = prose(envelope.result);
    checks.noNewNumericDateOrPrediction =
      !/[0-9０-９]|%|％/.test(outputText) &&
      !/(?:상승\s*신호|하락\s*신호|매수\s*적기|매도\s*적기|곧\s*(?:오르|내리|반등)|반드시\s*(?:오르|내리|이익)|수익(?:률)?\s*(?:예측|보장)|매수하세요|매도하세요|주문하세요)/.test(
        outputText,
      );
  }

  const success = Object.values(checks).every(Boolean);
  report({
    readiness: success ? "LIVE_READY" : "LIVE_BLOCKED",
    model,
    provenance: `${envelope.generation.mode}/${envelope.generation.outcome}`,
    finalStatus: envelope.status,
    failure: success
      ? null
      : classifyFailure(envelope.generation.failureCode),
    typedRequestCount: 1,
  });
  if (!success) process.exitCode = 1;
}

void main();
