import {
  ActionPlanSchema,
  MISSING_INFORMATION,
  type ActionPlan,
  type ActionPlanInput,
  type FailureCode,
  type PlanEnvelope,
  type RequestedGenerationMode,
  type SafetyOverride,
} from "./contracts";
import { deriveCounterfactualFromSnapshots } from "./counterfactual";

export type SafetyIssue = {
  safetyOverride: SafetyOverride;
  message: string;
};

export type PrecheckResult = SafetyIssue & { reason: string };

export type GeneratedPlanValidation =
  | {
      success: true;
      plan: ActionPlan;
      safetyOverride: SafetyOverride | null;
    }
  | {
      success: false;
      failureCode: "SCHEMA_ERROR" | "SEMANTIC_GUARD";
      safetyOverride: SafetyOverride;
      message: string;
    };

const conflictPattern = /(?:충돌|상충|모순|conflict|contradict)/i;
const forbiddenRequestPattern =
  /(?:추천(?:해|해줘|해주세요|받고)|사도\s*(?:될|되나|돼)|팔아도\s*(?:될|되나|돼)|매수(?:해|할까|해야)|매도(?:해|할까|해야)|몇\s*주(?:를)?|목표가|손절가|진입가|주문\s*(?:가격|수량)|적정\s*가격|상승\s*확률|하락\s*확률|수익(?:률)?\s*(?:예측|보장)|원금\s*보장|오를까|내릴까|적합(?:한지|성)|부적합)/i;

const generatedViolationPatterns: ReadonlyArray<{
  pattern: RegExp;
  label: string;
}> = [
  {
    pattern: /(?:매수|매도|보유).{0,24}(?:추천|권장|진행|실행|하세요|하십시오|해야\s*합니다)/i,
    label: "거래 방향 결론",
  },
  {
    pattern: /(?:추천|권장).{0,24}(?:매수|매도|보유)/i,
    label: "거래 추천",
  },
  {
    pattern: /(?:목표가|손절가|진입가|주문\s*(?:가격|수량)|투자\s*비중)/i,
    label: "가격·수량·비중 제시",
  },
  {
    pattern:
      /(?:\d[\d,]*(?:\.\d+)?\s*(?:원|달러|USD|KRW|shares?)\b|\d[\d,]*(?:\.\d+)?\s*주\s*(?:를|씩|만|매수|매도|주문))/i,
    label: "구체적인 가격 또는 수량",
  },
  {
    pattern:
      /(?:오를\s*(?:것|가능성)|내릴\s*(?:것|가능성)|상승\s*(?:예상|확률)|하락\s*(?:예상|확률)|예상\s*수익|expected\s+return)/i,
    label: "가격 또는 수익 예측",
  },
  {
    pattern: /(?:적합(?:합니다|하다|한\s*투자)|부적합(?:합니다|하다)|투자\s*성향)/i,
    label: "적합성 판정",
  },
  {
    pattern: /(?:원금\s*보장|수익(?:률)?\s*보장|확실한\s*수익|guaranteed\s+return)/i,
    label: "수익 또는 원금 보장",
  },
];

function allInputText(input: ActionPlanInput): string {
  return [
    input.purpose.note,
    ...input.constraints,
    ...input.userEvidence.flatMap((evidence) => [evidence.statement, evidence.sourceLabel]),
  ].join("\n");
}

function allGeneratedText(plan: ActionPlan): string {
  return [
    ...plan.reasons,
    ...plan.uncertainties,
    ...plan.orderedChecks.flatMap((item) => [item.check, item.why, item.howToVerify, item.doneWhen]),
    ...plan.decisionGates.flatMap((item) => [
      item.question,
      item.passCondition,
      item.onPass,
      item.onFail,
    ]),
    ...plan.stopConditions.flatMap((item) => [item.trigger, item.reason, item.resumeWhen]),
    ...plan.counterfactuals.flatMap((item) => [
      item.changedAssumption,
      item.from,
      item.to,
      item.impact,
    ]),
    ...plan.nextQuestions,
    plan.finalChoice.prompt,
  ].join("\n");
}

function safetyMessage(safetyOverride: SafetyOverride): string {
  switch (safetyOverride) {
    case "MISSING_CRITICAL_INPUT":
      return "결정을 고민하는 이유와 보유 기간을 먼저 알려 주세요.";
    case "URGENT_WITHOUT_EVIDENCE":
      return "결정을 서두르기 전에 참고한 정보를 하나 이상 확인해 주세요.";
    case "SOURCE_CONFLICT":
      return "입력한 정보끼리 내용이 달라 먼저 확인이 필요합니다.";
    case "CONSTRAINT_CONFLICT":
      return "목적·보유 기간·조건이 서로 맞지 않습니다.";
    case "COUNTERFACTUAL_MISMATCH":
      return "비교하려면 조건을 한 가지만 바꿔 주세요.";
    case "ORPHAN_EVIDENCE_REFERENCE":
      return "확인 행동 또는 결정 게이트가 존재하지 않는 근거를 참조했습니다.";
    case "FORBIDDEN_REQUEST":
      return "이 도구는 매수·매도 추천 대신 확인 순서와 중단 조건을 정리합니다.";
    case "FORBIDDEN_CONTENT":
      return "투자 결론으로 오해할 수 있는 내용이 있어 새 결론을 만들지 않고 멈췄습니다.";
    case "STATE_NORMALIZED":
      return "입력한 내용과 결과가 맞도록 안전한 상태로 바꿨습니다.";
  }
}

export function preflightSafetyOverride(input: ActionPlanInput): SafetyOverride | null {
  if (input.purpose.kind === "UNKNOWN" || input.horizon === "UNKNOWN") {
    return "MISSING_CRITICAL_INPUT";
  }

  if ((input.urgency === "NOW" || input.urgency === "TODAY") && input.userEvidence.length === 0) {
    return "URGENT_WITHOUT_EVIDENCE";
  }

  if (input.constraints.some((constraint) => conflictPattern.test(constraint))) {
    return "CONSTRAINT_CONFLICT";
  }

  if (
    input.userEvidence.some(
      (evidence) =>
        conflictPattern.test(evidence.statement) || conflictPattern.test(evidence.sourceLabel),
    )
  ) {
    return "SOURCE_CONFLICT";
  }

  if (forbiddenRequestPattern.test(allInputText(input))) {
    return "FORBIDDEN_REQUEST";
  }

  return null;
}

export function precheckInput(input: ActionPlanInput): PrecheckResult | null {
  const safetyOverride = preflightSafetyOverride(input);
  return safetyOverride
    ? { safetyOverride, message: safetyMessage(safetyOverride), reason: safetyMessage(safetyOverride) }
    : null;
}

function withServerInputFacts(input: ActionPlanInput, plan: ActionPlan): ActionPlan {
  const inputFact = (statement: string) => ({
    statement,
    basis: "USER_PROVIDED" as const,
    verification: "NOT_INDEPENDENTLY_VERIFIED" as const,
  });

  return {
    ...plan,
    currentSituation: {
      intentSummary: `사용자가 ${input.subjectLabel}에 대한 ${input.intent} 의도를 입력했으며 AI 결론이 아닙니다.`,
      confirmedFacts: [
        inputFact(`검토 대상 입력값은 ${input.subjectLabel}입니다.`),
        inputFact(`목적 입력값은 ${input.purpose.kind}입니다.`),
        ...(input.purpose.note.trim()
          ? [inputFact(`목적 설명 입력값: ${input.purpose.note}`)]
          : []),
        inputFact(`기간 입력값은 ${input.horizon}입니다.`),
        inputFact(`긴급도 입력값은 ${input.urgency}입니다.`),
        ...input.constraints.map((constraint) => inputFact(`사용자 제약: ${constraint}`)),
      ],
    },
    userEvidence: input.userEvidence.map((evidence) => ({
      ...evidence,
      basis: "USER_PROVIDED" as const,
      verification: "NOT_INDEPENDENTLY_VERIFIED" as const,
    })),
  };
}

export function semanticGuard(_input: ActionPlanInput, plan: ActionPlan): SafetyIssue | null {
  const allowedEvidenceRefs = new Set([
    ..._input.userEvidence.map((evidence) => evidence.id),
    MISSING_INFORMATION,
  ]);
  const evidenceRefs = [
    ...plan.orderedChecks.flatMap((item) => item.evidenceRefs),
    ...plan.decisionGates.flatMap((item) => item.evidenceRefs),
  ];
  if (evidenceRefs.some((reference) => !allowedEvidenceRefs.has(reference))) {
    return {
      safetyOverride: "ORPHAN_EVIDENCE_REFERENCE",
      message: "확인 행동 또는 결정 게이트가 존재하지 않는 evidence ID를 참조했습니다.",
    };
  }

  const violation = generatedViolationPatterns.find(({ pattern }) =>
    pattern.test(allGeneratedText(plan)),
  );
  if (violation) {
    return {
      safetyOverride: "FORBIDDEN_CONTENT",
      message: `생성 결과에 허용되지 않은 ${violation.label} 내용이 포함됐습니다.`,
    };
  }

  if (plan.nextQuestions.length > 3) {
    return {
      safetyOverride: "FORBIDDEN_CONTENT",
      message: "다음 질문은 최대 3개까지만 허용됩니다.",
    };
  }

  if (
    plan.status === "READY_FOR_REVIEW" &&
    (plan.orderedChecks.length === 0 ||
      plan.decisionGates.length === 0 ||
      plan.stopConditions.length === 0)
  ) {
    return {
      safetyOverride: "FORBIDDEN_CONTENT",
      message: "검토 준비 상태에 필요한 행동·게이트·중단 조건이 완성되지 않았습니다.",
    };
  }

  if (plan.status === "NEEDS_INFO" && plan.nextQuestions.length === 0) {
    return {
      safetyOverride: "FORBIDDEN_CONTENT",
      message: "정보 부족 상태에 필요한 다음 질문이 없습니다.",
    };
  }

  if (plan.stopConditions.length === 0) {
    return {
      safetyOverride: "FORBIDDEN_CONTENT",
      message: "모든 상태에는 최소 한 개의 중단 조건이 필요합니다.",
    };
  }

  if (plan.counterfactuals.length !== 1) {
    return {
      safetyOverride: "FORBIDDEN_CONTENT",
      message: "반사실 변화는 정확히 한 개여야 합니다.",
    };
  }

  if (plan.orderedChecks.some((item, index) => item.order !== index + 1)) {
    return {
      safetyOverride: "FORBIDDEN_CONTENT",
      message: "확인 행동의 순서 번호가 연속적이지 않습니다.",
    };
  }

  if (new Set(plan.finalChoice.options).size !== plan.finalChoice.options.length) {
    return {
      safetyOverride: "FORBIDDEN_CONTENT",
      message: "사용자 최종 선택지에는 중복 값이 없어야 합니다.",
    };
  }

  if (
    plan.status === "SAFETY_PAUSE" &&
    !plan.finalChoice.options.includes("PAUSE")
  ) {
    return {
      safetyOverride: "FORBIDDEN_CONTENT",
      message: "안전 일시정지 상태에는 중단 선택지가 필요합니다.",
    };
  }

  const generatedFields = [
    ...plan.reasons,
    ...plan.uncertainties,
    ...plan.orderedChecks.flatMap((item) => [item.check, item.why, item.howToVerify, item.doneWhen]),
    ...plan.decisionGates.flatMap((item) => [item.question, item.passCondition, item.onPass, item.onFail]),
    ...plan.stopConditions.flatMap((item) => [item.trigger, item.reason, item.resumeWhen]),
    ...plan.counterfactuals.flatMap((item) => [item.changedAssumption, item.from, item.to, item.impact]),
    ...plan.nextQuestions,
    plan.finalChoice.prompt,
  ];
  if (generatedFields.some((value) => value.trim().length === 0)) {
    return {
      safetyOverride: "FORBIDDEN_CONTENT",
      message: "생성 결과의 필수 설명 필드가 비어 있습니다.",
    };
  }

  return null;
}

export function normalizeFinalState(
  input: ActionPlanInput,
  plan: ActionPlan,
): { plan: ActionPlan; safetyOverride: SafetyOverride | null } {
  const preflight = preflightSafetyOverride(input);
  if (preflight) {
    return {
      plan: { ...plan, status: "SAFETY_PAUSE" },
      safetyOverride: preflight,
    };
  }

  if (
    input.purpose.kind === "LONG_TERM_GROWTH" &&
    (input.horizon === "DAYS" || input.horizon === "WEEKS" || input.horizon === "MONTHS")
  ) {
    return {
      plan: {
        ...plan,
        status: "SAFETY_PAUSE",
        finalChoice: {
          prompt: "장기적인 기대와 짧은 보유 기간이 맞지 않는 이유를 먼저 확인합니다.",
          options: ["ADD_INFORMATION", "PAUSE"],
        },
      },
      safetyOverride: "CONSTRAINT_CONFLICT",
    };
  }

  if (plan.status === "READY_FOR_REVIEW" && input.userEvidence.length === 0) {
    return {
      plan: { ...plan, status: "NEEDS_INFO" },
      safetyOverride: "STATE_NORMALIZED",
    };
  }

  return { plan, safetyOverride: null };
}

export function validateGeneratedPlan(
  input: ActionPlanInput,
  candidate: unknown,
  baselineInput?: ActionPlanInput,
): GeneratedPlanValidation {
  const parsed = ActionPlanSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      success: false,
      failureCode: "SCHEMA_ERROR",
      safetyOverride: "FORBIDDEN_CONTENT",
      message: "생성 결과가 Action Plan 계약을 충족하지 못했습니다.",
    };
  }

  let serverPlan = withServerInputFacts(input, parsed.data);
  if (baselineInput) {
    const comparison = deriveCounterfactualFromSnapshots(baselineInput, input);
    if (!comparison.comparable) {
      return {
        success: false,
        failureCode: "SEMANTIC_GUARD",
        safetyOverride: "COUNTERFACTUAL_MISMATCH",
        message: "기준 입력과 비교 입력은 정확히 한 필드만 달라야 합니다.",
      };
    }
    serverPlan = {
      ...serverPlan,
      counterfactuals: [comparison.counterfactual],
    };
  }
  const violation = semanticGuard(input, serverPlan);
  if (violation) {
    return {
      success: false,
      failureCode: "SEMANTIC_GUARD",
      safetyOverride: violation.safetyOverride,
      message: violation.message,
    };
  }

  const normalized = normalizeFinalState(input, serverPlan);
  return {
    success: true,
    plan: normalized.plan,
    safetyOverride: normalized.safetyOverride,
  };
}

function makeSafetyPausePlan(message: string, input?: ActionPlanInput): ActionPlan {
  const fallbackPlan: ActionPlan = {
    status: "SAFETY_PAUSE",
    currentSituation: {
      intentSummary: message,
      confirmedFacts: (input?.userEvidence ?? []).map((evidence) => ({
        statement: evidence.statement,
        basis: "USER_PROVIDED" as const,
        verification: "NOT_INDEPENDENTLY_VERIFIED" as const,
      })),
    },
    userEvidence: (input?.userEvidence ?? []).map((evidence) => ({
      ...evidence,
      basis: "USER_PROVIDED" as const,
      verification: "NOT_INDEPENDENTLY_VERIFIED" as const,
    })),
    reasons: ["확인되지 않은 내용을 보완하기 전에는 검토 절차를 계속하지 않습니다."],
    uncertainties: ["검토를 계속하는 데 필요한 정보 또는 생성 결과의 무결성"],
    orderedChecks: [],
    decisionGates: [],
    stopConditions: [
      {
        trigger: "필수 정보나 안전 검증 결과가 확인되지 않음",
        reason: "검토 가능한 계획 계약을 충족하지 못했습니다.",
        resumeWhen: "누락 정보와 근거 출처를 확인하고 새 요청을 제출했을 때",
      },
    ],
    counterfactuals: [
      {
        fieldPath: "purpose.kind",
        changedAssumption: "누락되거나 검증되지 않은 정보가 확인됨",
        from: "확인되지 않음",
        to: "출처와 기준일이 확인됨",
        impact: "새 요청에서 검토 계획을 다시 만들 수 있습니다.",
      },
    ],
    nextQuestions: ["목적, 기간, 제약과 근거 출처를 모두 확인했나요?"],
    finalChoice: {
      prompt: "정보를 확인하기 전까지 검토를 멈춥니다.",
      options: ["PAUSE"],
    },
  };

  return input ? withServerInputFacts(input, fallbackPlan) : fallbackPlan;
}

export function makeSafetyPause(options: {
  mode: "LIVE" | "NOT_CALLED";
  outcome: "FAILURE" | "SKIPPED";
  failureCode: FailureCode | null;
  message: string;
  safetyOverride: SafetyOverride | null;
  input?: ActionPlanInput;
  requestedMode?: RequestedGenerationMode;
  fixtureId?: string;
  fixtureVersion?: string;
}): PlanEnvelope {
  const requestedMode = options.requestedMode ?? "LIVE";
  const generation: PlanEnvelope["generation"] = requestedMode === "OFFLINE_DEMO"
    ? {
        requestedMode,
        mode: "NOT_CALLED",
        outcome: "SKIPPED",
        failureCode: options.failureCode,
        fixtureId: options.fixtureId ?? "UNSPECIFIED_OFFLINE_FIXTURE",
        fixtureVersion: options.fixtureVersion ?? "2.0.0",
      }
    : options.mode === "NOT_CALLED"
      ? {
          requestedMode,
          mode: "NOT_CALLED",
          outcome: "SKIPPED",
          failureCode: options.failureCode,
          fixtureId: null,
          fixtureVersion: null,
        }
      : {
          requestedMode,
          mode: "LIVE",
          outcome: "FAILURE",
          failureCode: options.failureCode ?? "SEMANTIC_GUARD",
          fixtureId: null,
          fixtureVersion: null,
        };

  return {
    generation,
    safetyOverride: options.safetyOverride,
    plan: makeSafetyPausePlan(options.message, options.input),
  };
}

export const makeSafetyPauseEnvelope = makeSafetyPause;

export function makeSuccessEnvelope(
  plan: ActionPlan,
  safetyOverride: SafetyOverride | null = null,
  provenance: {
    requestedMode?: RequestedGenerationMode;
    fixtureId?: string;
    fixtureVersion?: string;
  } = {},
): PlanEnvelope {
  const requestedMode = provenance.requestedMode ?? "LIVE";
  return {
    generation: requestedMode === "OFFLINE_DEMO"
      ? {
          requestedMode,
          mode: "OFFLINE_DEMO",
          outcome: "SUCCESS",
          failureCode: null,
          fixtureId: provenance.fixtureId ?? "UNSPECIFIED_OFFLINE_FIXTURE",
          fixtureVersion: provenance.fixtureVersion ?? "2.0.0",
        }
      : {
          requestedMode,
          mode: "LIVE",
          outcome: "SUCCESS",
          failureCode: null,
          fixtureId: null,
          fixtureVersion: null,
        },
    safetyOverride,
    plan,
  };
}

export type FinalizePlanOptions = {
  requestedMode?: RequestedGenerationMode;
  fixtureId?: string;
  fixtureVersion?: string;
  baselineInput?: ActionPlanInput;
};

export function finalizePlan(
  input: ActionPlanInput,
  candidate: unknown,
  options: FinalizePlanOptions = {},
): PlanEnvelope {
  const requestedMode = options.requestedMode ?? "LIVE";
  const validation = validateGeneratedPlan(input, candidate, options.baselineInput);
  if (!validation.success) {
    return makeSafetyPause({
      mode: requestedMode === "LIVE" ? "LIVE" : "NOT_CALLED",
      outcome: requestedMode === "LIVE" ? "FAILURE" : "SKIPPED",
      failureCode: validation.failureCode,
      message: validation.message,
      safetyOverride: validation.safetyOverride,
      input,
      requestedMode,
      fixtureId: options.fixtureId,
      fixtureVersion: options.fixtureVersion,
    });
  }

  return makeSuccessEnvelope(validation.plan, validation.safetyOverride, {
    requestedMode,
    fixtureId: options.fixtureId,
    fixtureVersion: options.fixtureVersion,
  });
}
