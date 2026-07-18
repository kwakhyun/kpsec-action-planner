import type { ActionPlanInput } from "@/lib/contracts";

export const DEMO_NOTICE =
  "회사명과 참고 정보는 모두 화면 체험을 위해 만든 가상 내용이며 실제 투자정보가 아닙니다.";

export const DEMO_BASELINE: ActionPlanInput = {
  subjectLabel: "가상 A사",
  intent: "BUY",
  purpose: {
    kind: "LONG_TERM_GROWTH",
    note: "가상 A사의 사업을 장기간 관찰하는 검토 연습",
  },
  horizon: "YEARS",
  urgency: "NO_RUSH",
  constraints: [
    "생활비와 비상자금은 사용하지 않음",
    "차입이나 레버리지를 사용하지 않음",
  ],
  userEvidence: [
    {
      id: "SYNTH-EV-001",
      statement:
        "가상 A사의 최근 사업보고서에서 핵심 사업 설명과 주요 위험 항목을 읽었다는 사용자 메모",
      sourceLabel: "가상 A사 사업보고서 — 데모 자료",
      observedAt: "2026-07-01",
    },
    {
      id: "SYNTH-EV-002",
      statement:
        "장기 관찰 이유와 반대 근거를 각각 한 문장으로 작성했다는 사용자 메모",
      sourceLabel: "사용자 작성 데모 메모",
      observedAt: "2026-07-17",
    },
  ],
};

export const DEMO_COUNTERFACTUAL: ActionPlanInput = {
  ...DEMO_BASELINE,
  purpose: { ...DEMO_BASELINE.purpose },
  constraints: [...DEMO_BASELINE.constraints],
  userEvidence: DEMO_BASELINE.userEvidence.map((item) => ({ ...item })),
  horizon: "MONTHS",
};

export const DEMO_MISSING_INFO: ActionPlanInput = {
  subjectLabel: "가상 검토 대상 미정",
  intent: "SELL",
  purpose: { kind: "UNKNOWN", note: "" },
  horizon: "UNKNOWN",
  urgency: "NOW",
  constraints: [],
  userEvidence: [],
};

export const DEMO_INPUTS = {
  baseline: DEMO_BASELINE,
  counterfactual: DEMO_COUNTERFACTUAL,
  missing: DEMO_MISSING_INFO,
  insufficient: DEMO_MISSING_INFO,
} as const;

export function isSingleHorizonCounterfactual(
  baseline: ActionPlanInput = DEMO_BASELINE,
  counterfactual: ActionPlanInput = DEMO_COUNTERFACTUAL,
): boolean {
  const { horizon: baselineHorizon, ...baselineRest } = baseline;
  const { horizon: counterfactualHorizon, ...counterfactualRest } = counterfactual;

  return (
    baselineHorizon === "YEARS" &&
    counterfactualHorizon === "MONTHS" &&
    JSON.stringify(baselineRest) === JSON.stringify(counterfactualRest)
  );
}
