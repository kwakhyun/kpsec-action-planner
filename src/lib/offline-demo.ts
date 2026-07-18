import {
  ActionPlanInputSchema,
  type ActionPlan,
  type ActionPlanInput,
  type PlanEnvelope,
} from "./contracts";
import {
  DEMO_BASELINE,
  DEMO_COUNTERFACTUAL,
  DEMO_MISSING_INFO,
} from "./demo-inputs";
import { finalizePlan, makeSafetyPause, precheckInput } from "./safety";

export const OFFLINE_DEMO_VERSION = "2.0.0" as const;

export const OFFLINE_DEMO_FIXTURE_IDS = [
  "ACTION_PLANNER_BASELINE",
  "ACTION_PLANNER_COUNTERFACTUAL",
  "ACTION_PLANNER_MISSING_INFO",
] as const;

export type OfflineDemoFixtureId =
  (typeof OFFLINE_DEMO_FIXTURE_IDS)[number];

export type OfflineDemoResult = {
  input: ActionPlanInput;
  envelope: PlanEnvelope;
};

const baselineCandidate: ActionPlan = {
  status: "READY_FOR_REVIEW",
  currentSituation: {
    intentSummary: "합성 입력의 검토 순서를 구성합니다.",
    confirmedFacts: [],
  },
  userEvidence: [],
  reasons: [
    "사용자가 적은 합성 근거를 공식 원문과 구분해 확인해야 검토 가능한 상태가 됩니다.",
    "장기 목적, 기간과 제약이 서로 일치하는지 먼저 확인해야 합니다.",
  ],
  uncertainties: [
    "합성 근거의 내용은 독립적으로 검증되지 않았습니다.",
    "현재 메모가 반대 근거와 자료 전체의 맥락을 충분히 반영하는지 알 수 없습니다.",
  ],
  orderedChecks: [
    {
      order: 1,
      check: "가상 사업 자료의 원문과 작성 날짜 확인",
      why: "사용자 메모와 출처 원문을 분리해 검토하기 위해서입니다.",
      howToVerify: "참고 정보 1의 가상 원문과 사용자 메모를 나란히 대조합니다.",
      doneWhen: "핵심 설명, 위험 항목과 기준일의 일치 여부를 기록했습니다.",
      evidenceRefs: ["SYNTH-EV-001"],
    },
    {
      order: 2,
      check: "장기 관찰 이유와 반대 근거의 분리 확인",
      why: "한 방향의 이유만 남아 있는지 확인하기 위해서입니다.",
      howToVerify: "참고 정보 2의 메모에서 이유와 반대 내용을 각각 찾습니다.",
      doneWhen: "두 항목이 서로 다른 문장으로 기록되어 있습니다.",
      evidenceRefs: ["SYNTH-EV-002"],
    },
    {
      order: 3,
      check: "목적·기간·제약의 일치 여부 확인",
      why: "입력 전제 사이의 충돌을 검토 전에 발견하기 위해서입니다.",
      howToVerify: "장기적인 성장 기대, 1년 이상의 보유 기간과 두 조건을 한눈에 대조합니다.",
      doneWhen: "충돌 없음 또는 보완할 정보가 명시되어 있습니다.",
      evidenceRefs: ["SYNTH-EV-001", "SYNTH-EV-002"],
    },
  ],
  decisionGates: [
    {
      question: "합성 원문, 반대 근거와 장기 목적의 일치 여부를 모두 확인했나요?",
      passCondition: "각 항목의 출처, 기준일과 일치 여부가 분리 기록되어 있습니다.",
      onPass: "사람이 상세 카드를 다시 검토합니다.",
      onFail: "부족하거나 충돌하는 정보를 보완할 때까지 검토를 멈춥니다.",
      evidenceRefs: ["SYNTH-EV-001", "SYNTH-EV-002"],
    },
  ],
  stopConditions: [
    {
      trigger: "합성 원문을 찾지 못하거나 사용자 메모와 내용이 충돌함",
      reason: "독립 확인되지 않은 전제만으로 계획 검토를 계속하지 않기 위해서입니다.",
      resumeWhen: "출처와 기준일을 확인하고 충돌 내용을 별도로 기록했을 때",
    },
  ],
  counterfactuals: [
    {
      fieldPath: "horizon",
      changedAssumption: "보유 기간",
      from: "YEARS",
      to: "MONTHS",
      impact: "고정 합성 가정으로 기간이 짧아지면 장기 목적과의 일치 여부를 다시 확인합니다.",
    },
  ],
  nextQuestions: [
    "합성 원문의 기준일과 사용자 메모의 작성일을 구분해 확인했나요?",
    "반대 근거가 실제로 별도 문장으로 남아 있나요?",
  ],
  finalChoice: {
    prompt: "상세 근거를 더 검토하거나 정보를 보완하거나 지금은 멈춥니다.",
    options: ["REVIEW_MORE", "ADD_INFORMATION", "PAUSE"],
  },
};

const inputsByFixture: Record<OfflineDemoFixtureId, ActionPlanInput> = {
  ACTION_PLANNER_BASELINE: DEMO_BASELINE,
  ACTION_PLANNER_COUNTERFACTUAL: DEMO_COUNTERFACTUAL,
  ACTION_PLANNER_MISSING_INFO: DEMO_MISSING_INFO,
};

function cloneInput(input: ActionPlanInput): ActionPlanInput {
  return structuredClone(input);
}

function exactInputMatch(left: ActionPlanInput, right: ActionPlanInput): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isFixtureId(value: string): value is OfflineDemoFixtureId {
  return (OFFLINE_DEMO_FIXTURE_IDS as readonly string[]).includes(value);
}

function unregisteredResult(
  _fixtureId: string,
  submittedInput?: unknown,
): OfflineDemoResult {
  const parsedInput = ActionPlanInputSchema.safeParse(submittedInput);
  const input = parsedInput.success ? parsedInput.data : cloneInput(DEMO_MISSING_INFO);

  return {
    input: cloneInput(input),
    envelope: makeSafetyPause({
      requestedMode: "OFFLINE_DEMO",
      mode: "NOT_CALLED",
      outcome: "SKIPPED",
      failureCode: "INVALID_INPUT",
      message: "준비된 예시와 입력 내용이 달라 분석을 시작하지 않았습니다.",
      safetyOverride: "STATE_NORMALIZED",
      input,
      fixtureId: "UNREGISTERED_OFFLINE_FIXTURE",
      fixtureVersion: OFFLINE_DEMO_VERSION,
    }),
  };
}

export function getOfflineDemoFixture(
  fixtureId: string,
): { id: OfflineDemoFixtureId; version: typeof OFFLINE_DEMO_VERSION; input: ActionPlanInput } | null {
  if (!isFixtureId(fixtureId)) return null;
  return {
    id: fixtureId,
    version: OFFLINE_DEMO_VERSION,
    input: cloneInput(inputsByFixture[fixtureId]),
  };
}

export function runOfflineDemo(
  fixtureId: string,
  submittedInput?: unknown,
  submittedBaselineInput?: unknown,
): OfflineDemoResult {
  if (!isFixtureId(fixtureId)) {
    return unregisteredResult(fixtureId, submittedInput);
  }

  const fixtureInput = inputsByFixture[fixtureId];
  if (submittedInput !== undefined) {
    const parsedInput = ActionPlanInputSchema.safeParse(submittedInput);
    if (!parsedInput.success || !exactInputMatch(parsedInput.data, fixtureInput)) {
      return unregisteredResult(fixtureId, submittedInput);
    }
  }

  const input = cloneInput(fixtureInput);
  if (fixtureId === "ACTION_PLANNER_MISSING_INFO") {
    const preflight = precheckInput(input);
    return {
      input,
      envelope: makeSafetyPause({
        requestedMode: "OFFLINE_DEMO",
        mode: "NOT_CALLED",
        outcome: "SKIPPED",
        failureCode: null,
        message: preflight?.message ?? "필수 정보가 부족해 검토를 시작하지 않습니다.",
        safetyOverride: preflight?.safetyOverride ?? "MISSING_CRITICAL_INPUT",
        input,
        fixtureId,
        fixtureVersion: OFFLINE_DEMO_VERSION,
      }),
    };
  }

  let baselineInput: ActionPlanInput | undefined;
  if (fixtureId === "ACTION_PLANNER_COUNTERFACTUAL") {
    baselineInput = cloneInput(DEMO_BASELINE);
    if (submittedBaselineInput !== undefined) {
      const parsedBaseline = ActionPlanInputSchema.safeParse(submittedBaselineInput);
      if (
        !parsedBaseline.success ||
        !exactInputMatch(parsedBaseline.data, DEMO_BASELINE)
      ) {
        return unregisteredResult(fixtureId, submittedInput ?? input);
      }
      baselineInput = parsedBaseline.data;
    }
  }

  return {
    input,
    envelope: finalizePlan(input, structuredClone(baselineCandidate), {
      requestedMode: "OFFLINE_DEMO",
      fixtureId,
      fixtureVersion: OFFLINE_DEMO_VERSION,
      baselineInput,
    }),
  };
}
