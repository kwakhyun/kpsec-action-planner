import type {
  ActionPlan,
  ActionPlanInput,
  SafetyOverride,
} from "./contracts";

export type SafetyIssue = {
  safetyOverride: SafetyOverride;
  message: string;
};

export type PrecheckResult = SafetyIssue & { reason: string };

const conflictPattern = /(?:충돌|상충|모순|conflict|contradict)/i;
const forbiddenRequestPattern =
  /(?:추천(?:해|해줘|해주세요|받고)|사도\s*(?:될|되나|돼)|팔아도\s*(?:될|되나|돼)|매수(?:해|할까|해야)|매도(?:해|할까|해야)|몇\s*주(?:를)?|목표가|손절가|진입가|주문\s*(?:가격|수량)|적정\s*가격|상승\s*확률|하락\s*확률|수익(?:률)?\s*(?:예측|보장)|원금\s*보장|오를까|내릴까|적합(?:한지|성)|부적합)/i;

const generatedViolationPatterns: ReadonlyArray<{
  pattern: RegExp;
  label: string;
}> = [
  {
    pattern:
      /(?:매수|매도|보유).{0,24}(?:추천|권장|진행|실행|하세요|하십시오|해야\s*합니다)/i,
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
    pattern:
      /(?:적합(?:합니다|하다|한\s*투자)|부적합(?:합니다|하다)|투자\s*성향)/i,
    label: "적합성 판정",
  },
  {
    pattern:
      /(?:원금\s*보장|수익(?:률)?\s*보장|확실한\s*수익|guaranteed\s+return)/i,
    label: "수익 또는 원금 보장",
  },
];

function allInputText(input: ActionPlanInput): string {
  return [
    input.purpose.note,
    ...input.constraints,
    ...input.userEvidence.flatMap((evidence) => [
      evidence.statement,
      evidence.sourceLabel,
    ]),
  ].join("\n");
}

function allGeneratedText(plan: ActionPlan): string {
  return [
    ...plan.reasons,
    ...plan.uncertainties,
    ...plan.orderedChecks.flatMap((item) => [
      item.check,
      item.why,
      item.howToVerify,
      item.doneWhen,
    ]),
    ...plan.decisionGates.flatMap((item) => [
      item.question,
      item.passCondition,
      item.onPass,
      item.onFail,
    ]),
    ...plan.stopConditions.flatMap((item) => [
      item.trigger,
      item.reason,
      item.resumeWhen,
    ]),
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

export function preflightSafetyOverride(
  input: ActionPlanInput,
): SafetyOverride | null {
  if (input.purpose.kind === "UNKNOWN" || input.horizon === "UNKNOWN") {
    return "MISSING_CRITICAL_INPUT";
  }

  if (
    (input.urgency === "NOW" || input.urgency === "TODAY") &&
    input.userEvidence.length === 0
  ) {
    return "URGENT_WITHOUT_EVIDENCE";
  }

  if (input.constraints.some((constraint) => conflictPattern.test(constraint))) {
    return "CONSTRAINT_CONFLICT";
  }

  if (
    input.userEvidence.some(
      (evidence) =>
        conflictPattern.test(evidence.statement) ||
        conflictPattern.test(evidence.sourceLabel),
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
    ? {
        safetyOverride,
        message: safetyMessage(safetyOverride),
        reason: safetyMessage(safetyOverride),
      }
    : null;
}

export function generatedViolationLabel(plan: ActionPlan): string | null {
  return (
    generatedViolationPatterns.find(({ pattern }) =>
      pattern.test(allGeneratedText(plan)),
    )?.label ?? null
  );
}
