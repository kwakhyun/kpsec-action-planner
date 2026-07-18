import type {
  ActionPlanInput,
  FailureCode,
  PlanEnvelope,
  SafetyOverride,
} from "./contracts";

export const INTENT_LABELS: Record<ActionPlanInput["intent"], string> = {
  BUY: "사고 싶어요",
  SELL: "팔고 싶어요",
  UNSURE: "아직 결정하지 못했어요",
};

export const INTENT_SITUATION_LABELS: Record<
  ActionPlanInput["intent"],
  string
> = {
  BUY: "사고 싶은 상황",
  SELL: "팔고 싶은 상황",
  UNSURE: "아직 결정하지 못한 상황",
};

export const PURPOSE_LABELS: Record<
  ActionPlanInput["purpose"]["kind"],
  string
> = {
  LONG_TERM_GROWTH: "장기적인 성장을 기대해요",
  CASH_NEED: "현금이 필요해요",
  RISK_REDUCTION: "위험을 줄이고 싶어요",
  OTHER: "다른 목적이 있어요",
  UNKNOWN: "아직 목적을 정하지 못했어요",
};

export const HORIZON_LABELS: Record<ActionPlanInput["horizon"], string> = {
  DAYS: "며칠",
  WEEKS: "몇 주",
  MONTHS: "몇 달",
  YEARS: "1년 이상",
  UNKNOWN: "아직 모르겠어요",
};

export const URGENCY_LABELS: Record<ActionPlanInput["urgency"], string> = {
  NOW: "지금 바로",
  TODAY: "오늘 안에",
  THIS_WEEK: "이번 주 안에",
  NO_RUSH: "급하지 않아요",
};

export const STATUS_LABELS = {
  READY_FOR_REVIEW: "다음 행동을 살펴볼 준비가 됐어요",
  NEEDS_INFO: "정보가 더 필요해요",
  SAFETY_PAUSE: "잠시 멈추고 확인해 주세요",
} as const;

export const MODE_LABELS = {
  LIVE: "AI로 새로 분석",
  OFFLINE_DEMO: "예시 데이터로 체험",
  NOT_CALLED: "AI를 호출하지 않았어요",
} as const;

export const OUTCOME_LABELS = {
  SUCCESS: "분석 완료",
  FAILURE: "분석하지 못했어요",
  SKIPPED: "분석을 시작하지 않았어요",
} as const;

export const CHOICE_LABELS = {
  REVIEW_MORE: "더 살펴보기",
  ADD_INFORMATION: "정보 추가하기",
  PAUSE: "지금은 멈추기",
} as const;

export const FAILURE_MESSAGES: Record<FailureCode, string> = {
  INVALID_JSON:
    "입력 내용을 읽지 못했습니다. 화면을 새로 고친 뒤 다시 입력해 주세요.",
  INVALID_INPUT:
    "입력 내용을 확인해 주세요. 표시된 항목을 고치면 다시 진행할 수 있습니다.",
  MISSING_CONFIGURATION:
    "AI 분석 설정을 확인할 수 없어 시작하지 않았습니다. 예시 데이터로는 계속 체험할 수 있습니다.",
  TIMEOUT:
    "AI 응답이 늦어 새 계획을 만들지 않았습니다. 잠시 후 다시 시도해 주세요.",
  UPSTREAM_ERROR:
    "외부 AI가 응답하지 않아 새 계획을 만들지 않았습니다. 잠시 후 다시 시도해 주세요.",
  REFUSAL: "AI가 이 요청에 답하지 않아 새 계획을 만들지 않았습니다.",
  INCOMPLETE:
    "AI 답변이 끝까지 완성되지 않아 새 계획을 만들지 않았습니다.",
  PARSE_ERROR:
    "AI 답변을 안전하게 확인할 수 없어 새 계획을 만들지 않았습니다.",
  SCHEMA_ERROR:
    "AI 답변이 필요한 형식과 맞지 않아 새 계획을 만들지 않았습니다.",
  SEMANTIC_GUARD:
    "안전 규칙에 맞지 않는 내용이 있어 새 결론을 만들지 않고 멈췄습니다.",
  CLIENT_NETWORK_ERROR:
    "네트워크에 연결하지 못해 새 계획을 만들지 않았습니다.",
  CLIENT_RESPONSE_ERROR:
    "서버 답변을 안전하게 확인할 수 없어 새 계획을 만들지 않았습니다.",
};

export const SAFETY_MESSAGES: Record<SafetyOverride, string> = {
  MISSING_CRITICAL_INPUT:
    "결정을 고민하는 이유와 보유 기간을 먼저 알려 주세요.",
  URGENT_WITHOUT_EVIDENCE:
    "결정을 서두르기 전에 참고한 정보를 하나 이상 확인해 주세요.",
  SOURCE_CONFLICT:
    "입력한 정보끼리 내용이 달라 먼저 확인이 필요합니다.",
  CONSTRAINT_CONFLICT: "목적·보유 기간·조건이 서로 맞지 않습니다.",
  COUNTERFACTUAL_MISMATCH: "비교하려면 조건을 한 가지만 바꿔 주세요.",
  ORPHAN_EVIDENCE_REFERENCE:
    "확인할 항목이 입력한 참고 정보와 연결되지 않아 멈췄습니다.",
  FORBIDDEN_REQUEST:
    "이 도구는 매수·매도 추천 대신 확인 순서와 중단 조건을 정리합니다.",
  FORBIDDEN_CONTENT:
    "투자 결론으로 오해할 수 있는 내용이 있어 새 결론을 만들지 않고 멈췄습니다.",
  STATE_NORMALIZED:
    "입력한 내용과 결과가 맞도록 안전한 상태로 바꿨습니다.",
};

const TOKEN_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["NOT_INDEPENDENTLY_VERIFIED", "앱에서 따로 확인하지 않음"],
  ["MISSING_INFORMATION", "추가로 확인할 정보"],
  ["LONG_TERM_GROWTH", PURPOSE_LABELS.LONG_TERM_GROWTH],
  ["RISK_REDUCTION", PURPOSE_LABELS.RISK_REDUCTION],
  ["READY_FOR_REVIEW", STATUS_LABELS.READY_FOR_REVIEW],
  ["OFFLINE_DEMO", MODE_LABELS.OFFLINE_DEMO],
  ["USER_PROVIDED", "직접 입력한 정보"],
  ["NOT_CALLED", MODE_LABELS.NOT_CALLED],
  ["CASH_NEED", PURPOSE_LABELS.CASH_NEED],
  ["SAFETY_PAUSE", STATUS_LABELS.SAFETY_PAUSE],
  ["NEEDS_INFO", STATUS_LABELS.NEEDS_INFO],
  ["THIS_WEEK", URGENCY_LABELS.THIS_WEEK],
  ["NO_RUSH", URGENCY_LABELS.NO_RUSH],
  ["UNKNOWN", "아직 모르겠어요"],
  ["UNSURE", INTENT_LABELS.UNSURE],
  ["MONTHS", HORIZON_LABELS.MONTHS],
  ["YEARS", HORIZON_LABELS.YEARS],
  ["WEEKS", HORIZON_LABELS.WEEKS],
  ["TODAY", URGENCY_LABELS.TODAY],
  ["SKIPPED", OUTCOME_LABELS.SKIPPED],
  ["FAILURE", OUTCOME_LABELS.FAILURE],
  ["SUCCESS", OUTCOME_LABELS.SUCCESS],
  ["OTHER", PURPOSE_LABELS.OTHER],
  ["DAYS", HORIZON_LABELS.DAYS],
  ["LIVE", MODE_LABELS.LIVE],
  ["SELL", INTENT_LABELS.SELL],
  ["BUY", INTENT_LABELS.BUY],
  ["NOW", URGENCY_LABELS.NOW],
];

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function evidenceDisplayLabel(
  reference: string,
  evidence: ReadonlyArray<{ id: string }>,
): string {
  if (reference === "MISSING_INFORMATION") return "추가로 확인할 정보";
  const index = evidence.findIndex((item) => item.id === reference);
  return index >= 0 ? `참고 정보 ${index + 1}` : "연결되지 않은 참고 정보";
}

export function humanizePlanText(
  value: string,
  evidence: ReadonlyArray<{ id: string }> = [],
): string {
  let result = value;

  evidence.forEach((item, index) => {
    result = result.replace(
      new RegExp(escaped(item.id), "g"),
      `참고 정보 ${index + 1}`,
    );
  });

  TOKEN_LABELS.forEach(([token, label]) => {
    result = result.replace(new RegExp(escaped(token), "g"), label);
  });

  return result
    .replace(/사고 싶어요 의도를/g, `${INTENT_SITUATION_LABELS.BUY}을`)
    .replace(/팔고 싶어요 의도를/g, `${INTENT_SITUATION_LABELS.SELL}을`)
    .replace(/아직 결정하지 못했어요 의도를/g, `${INTENT_SITUATION_LABELS.UNSURE}을`)
    .replace(/사고 싶어요 의도가/g, `${INTENT_SITUATION_LABELS.BUY}이`)
    .replace(/팔고 싶어요 의도가/g, `${INTENT_SITUATION_LABELS.SELL}이`)
    .replace(/아직 결정하지 못했어요 의도가/g, `${INTENT_SITUATION_LABELS.UNSURE}이`)
    .replace(/사고 싶어요 의도/g, INTENT_SITUATION_LABELS.BUY)
    .replace(/팔고 싶어요 의도/g, INTENT_SITUATION_LABELS.SELL)
    .replace(/아직 결정하지 못했어요 의도/g, INTENT_SITUATION_LABELS.UNSURE)
    .replace(/Action Plan Card/gi, "다음 행동 정리")
    .replace(/Responses API/gi, "외부 AI")
    .replace(/\bfixture\b/gi, "준비된 예시")
    .replace(/\bpreset\b/gi, "준비된 예시")
    .replace(/\bsnapshot\b/gi, "입력한 내용")
    .replace(/\bdelta\b/gi, "바뀐 내용")
    .replace(/\bfail closed\b/gi, "새 결론을 만들지 않고 멈춤")
    .replace(/\bschema\b/gi, "필요한 형식")
    .replace(/\bversion\b/gi, "버전")
    .replace(/evidence ID/gi, "참고 정보 연결")
    .replace(/근거 ID/g, "참고 정보 연결")
    .replace(/결정 게이트/g, "진행 전에 확인할 조건")
    .replace(/검토 기간/g, "보유 기간")
    .replace(/사용자 제약/g, "사용자가 정한 조건")
    .replace(/검토 계획/g, "다음 행동")
    .replace(/반사실/g, "조건 하나 바꿔 보기")
    .replace(/합성/g, "가상")
    .replace(/기준일/g, "확인한 날짜")
    .replace(/날짜과/g, "날짜와")
    .replace(/날짜을/g, "날짜를")
    .replace(/1년 이상를/g, "1년 이상을")
    .replace(/몇 달를/g, "몇 달을");
}

export function fieldPathLabel(
  fieldPath: string,
  evidence: ReadonlyArray<{ id: string }> = [],
): string {
  const direct: Record<string, string> = {
    subjectLabel: "종목이나 상품",
    intent: "고민 중인 결정",
    "purpose.kind": "가장 큰 이유",
    "purpose.note": "이유에 대한 설명",
    horizon: "보유 기간",
    urgency: "결정 시점",
    "generation.outcome": "분석 결과",
    "fixture.contract": "준비된 예시의 확인 상태",
  };
  if (direct[fieldPath]) return direct[fieldPath];

  const constraint = /^constraints\[(\d+)]$/.exec(fieldPath);
  if (constraint) return `꼭 지키고 싶은 조건 ${Number(constraint[1]) + 1}`;

  const evidenceField = /^userEvidence\[(\d+)]\.(.+)$/.exec(fieldPath);
  if (evidenceField) {
    const index = Number(evidenceField[1]);
    const field = evidenceField[2];
    const label = evidence[index]
      ? evidenceDisplayLabel(evidence[index].id, evidence)
      : `참고 정보 ${index + 1}`;
    const suffix: Record<string, string> = {
      statement: "내용",
      sourceLabel: "확인한 곳",
      observedAt: "확인한 날짜",
      id: "연결 번호",
    };
    return `${label}의 ${suffix[field] ?? "입력값"}`;
  }

  return "바뀐 입력 항목";
}

export function generationSummary(
  generation: PlanEnvelope["generation"],
): string {
  if (generation.mode === "OFFLINE_DEMO" && generation.outcome === "SUCCESS") {
    return "예시 데이터 분석을 마쳤습니다.";
  }
  if (generation.mode === "LIVE" && generation.outcome === "SUCCESS") {
    return "AI로 새 분석을 마쳤습니다.";
  }
  if (generation.mode === "LIVE" && generation.outcome === "FAILURE") {
    return "AI 분석에 실패해 새 계획을 만들지 않았습니다.";
  }
  return "필수 내용을 확인하기 전이라 분석을 시작하지 않았습니다.";
}
