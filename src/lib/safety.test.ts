import assert from "node:assert/strict";
import test from "node:test";

import {
  ActionPlanInputSchema,
  type ActionPlan,
  FailureCodeSchema,
  PlanEnvelopeSchema,
} from "@/lib/contracts";
import {
  DEMO_BASELINE,
  DEMO_COUNTERFACTUAL,
  DEMO_MISSING_INFO,
  isSingleHorizonCounterfactual,
} from "@/lib/demo-inputs";
import {
  finalizePlan,
  makeSafetyPause,
  precheckInput,
  semanticGuard,
} from "@/lib/safety";

const safePlan: ActionPlan = {
  status: "READY_FOR_REVIEW",
  currentSituation: {
    intentSummary: "사용자가 입력한 의도를 검토 계획으로 정리합니다.",
    confirmedFacts: [],
  },
  userEvidence: DEMO_BASELINE.userEvidence.map((evidence) => ({
    ...evidence,
    basis: "USER_PROVIDED",
    verification: "NOT_INDEPENDENTLY_VERIFIED",
  })),
  reasons: ["공식 원문과 사용자 메모의 일치 여부를 먼저 확인합니다."],
  uncertainties: ["사용자 메모가 원문 전체의 맥락을 반영하는지 알 수 없습니다."],
  orderedChecks: [
    {
      order: 1,
      check: "공식 원문과 메모 대조",
      why: "사용자 근거는 독립적으로 검증되지 않았습니다.",
      howToVerify: "기준일이 표시된 공식 원문을 직접 확인합니다.",
      doneWhen: "메모와 원문의 일치·불일치가 기록되어 있습니다.",
      evidenceRefs: ["SYNTH-EV-001"],
    },
  ],
  decisionGates: [
    {
      question: "원문과 메모가 일치하는가?",
      passCondition: "주요 주장과 기준일이 원문에서 확인됩니다.",
      onPass: "다음 근거 검토로 이동합니다.",
      onFail: "현재 검토를 멈추고 전제를 수정합니다.",
      evidenceRefs: ["SYNTH-EV-001"],
    },
  ],
  stopConditions: [
    {
      trigger: "공식 원문을 확인할 수 없음",
      reason: "사용자 메모만으로는 검토를 이어갈 수 없습니다.",
      resumeWhen: "기준일이 확인되는 공식 원문을 확보합니다.",
    },
  ],
  counterfactuals: [
    {
      fieldPath: "horizon",
      changedAssumption: "검토 기간",
      from: "YEARS",
      to: "MONTHS",
      impact: "목적과 기간의 충돌을 먼저 다시 확인합니다.",
    },
  ],
  nextQuestions: [],
  finalChoice: {
    prompt: "근거를 더 검토하거나 지금은 멈추세요.",
    options: ["REVIEW_MORE", "ADD_INFORMATION", "PAUSE"],
  },
};

test("demo inputs satisfy the input contract", () => {
  for (const input of [DEMO_BASELINE, DEMO_COUNTERFACTUAL, DEMO_MISSING_INFO]) {
    assert.equal(ActionPlanInputSchema.safeParse(input).success, true);
  }
});

test("counterfactual demo differs only by horizon", () => {
  const base = structuredClone(DEMO_BASELINE);
  const counterfactual = structuredClone(DEMO_COUNTERFACTUAL);
  counterfactual.horizon = base.horizon;
  assert.deepEqual(counterfactual, base);
  assert.equal(DEMO_BASELINE.horizon, "YEARS");
  assert.equal(DEMO_COUNTERFACTUAL.horizon, "MONTHS");
  assert.equal(isSingleHorizonCounterfactual(), true);
});

test("critical missing information is prechecked as a safety pause", () => {
  assert.equal(
    precheckInput(DEMO_MISSING_INFO)?.safetyOverride,
    "MISSING_CRITICAL_INPUT",
  );
});

test("every failure code produces a valid SAFETY_PAUSE envelope", () => {
  for (const failureCode of FailureCodeSchema.options) {
    const envelope = makeSafetyPause({
      mode: failureCode.startsWith("INVALID_") ? "NOT_CALLED" : "LIVE",
      outcome: failureCode.startsWith("INVALID_") ? "SKIPPED" : "FAILURE",
      failureCode,
      message: "안전 검증 테스트",
      safetyOverride: null,
    });
    assert.equal(envelope.plan.status, "SAFETY_PAUSE");
    assert.equal(PlanEnvelopeSchema.safeParse(envelope).success, true);
  }
});

test("semantic guard rejects direction, order, price, prediction, suitability, and guarantee language", () => {
  const forbiddenDrills = [
    "이 조건이면 매수하세요",
    "주문 수량을 정합니다",
    "목표가를 계산합니다",
    "상승 확률을 예측합니다",
    "이 상품은 사용자에게 적합합니다",
    "원금 보장 여부를 약속합니다",
  ];

  for (const check of forbiddenDrills) {
    const unsafePlan: ActionPlan = {
      ...safePlan,
      orderedChecks: [{ ...safePlan.orderedChecks[0], check }],
    };
    assert.ok(semanticGuard(DEMO_BASELINE, unsafePlan), check);
  }

  assert.equal(semanticGuard(DEMO_BASELINE, safePlan), null);
});

test("baseline is LIVE review-ready and the one-field counterfactual is LIVE safety pause", () => {
  const baseline = finalizePlan(DEMO_BASELINE, safePlan);
  assert.equal(baseline.generation.outcome, "SUCCESS");
  assert.equal(baseline.plan.status, "READY_FOR_REVIEW");
  assert.equal(baseline.safetyOverride, null);

  const counterfactual = finalizePlan(DEMO_COUNTERFACTUAL, safePlan);
  assert.equal(counterfactual.generation.outcome, "SUCCESS");
  assert.equal(counterfactual.plan.status, "SAFETY_PAUSE");
  assert.equal(counterfactual.safetyOverride, "CONSTRAINT_CONFLICT");
});

test("server replaces model-authored current facts and evidence with exact input data", () => {
  const candidate: ActionPlan = {
    ...safePlan,
    currentSituation: {
      intentSummary: "신뢰하지 않을 모델 작성 요약",
      confirmedFacts: [],
    },
    userEvidence: [],
  };
  const result = finalizePlan(DEMO_BASELINE, candidate);

  assert.equal(result.generation.outcome, "SUCCESS");
  assert.match(result.plan.currentSituation.intentSummary, /BUY/);
  assert.deepEqual(
    result.plan.userEvidence.map(({ id, statement, sourceLabel, observedAt }) => ({
      id,
      statement,
      sourceLabel,
      observedAt,
    })),
    DEMO_BASELINE.userEvidence,
  );
});

test("state invariants reject incomplete READY, NEEDS_INFO, and SAFETY_PAUSE plans", () => {
  assert.equal(semanticGuard(DEMO_BASELINE, safePlan), null);

  const validNeeds: ActionPlan = {
    ...safePlan,
    status: "NEEDS_INFO",
    nextQuestions: ["공식 원문의 기준일을 확인했나요?"],
  };
  assert.equal(semanticGuard(DEMO_BASELINE, validNeeds), null);

  const validPause: ActionPlan = { ...safePlan, status: "SAFETY_PAUSE" };
  assert.equal(semanticGuard(DEMO_BASELINE, validPause), null);

  const invalidReady: ActionPlan = { ...safePlan, orderedChecks: [] };
  assert.ok(semanticGuard(DEMO_BASELINE, invalidReady));

  const invalidNeeds: ActionPlan = {
    ...safePlan,
    status: "NEEDS_INFO",
    nextQuestions: [],
  };
  assert.ok(semanticGuard(DEMO_BASELINE, invalidNeeds));

  const invalidPause: ActionPlan = {
    ...safePlan,
    status: "SAFETY_PAUSE",
    stopConditions: [],
  };
  assert.ok(semanticGuard(DEMO_BASELINE, invalidPause));
});

test("orphan evidence references fail closed", () => {
  const orphanPlan: ActionPlan = {
    ...safePlan,
    orderedChecks: [
      {
        ...safePlan.orderedChecks[0],
        evidenceRefs: ["SYNTH-EV-DOES-NOT-EXIST"],
      },
    ],
  };

  const envelope = finalizePlan(DEMO_BASELINE, orphanPlan);
  assert.equal(envelope.generation.outcome, "FAILURE");
  assert.equal(envelope.plan.status, "SAFETY_PAUSE");
  assert.equal(envelope.safetyOverride, "ORPHAN_EVIDENCE_REFERENCE");
});

test("comparison replaces model counterfactual with the exact snapshot delta", () => {
  const modelNarrative: ActionPlan = {
    ...safePlan,
    counterfactuals: [
      {
        fieldPath: "intent",
        changedAssumption: "모델이 추정한 다른 전제",
        from: "추정 전",
        to: "추정 후",
        impact: "모델이 작성한 영향",
      },
    ],
  };

  const envelope = finalizePlan(DEMO_COUNTERFACTUAL, modelNarrative, {
    baselineInput: DEMO_BASELINE,
  });
  assert.equal(envelope.generation.outcome, "SUCCESS");
  assert.equal(envelope.plan.status, "SAFETY_PAUSE");
  assert.equal(envelope.safetyOverride, "CONSTRAINT_CONFLICT");
  assert.deepEqual(envelope.plan.counterfactuals[0], {
    fieldPath: "horizon",
    changedAssumption: "검토 기간",
    from: "YEARS",
    to: "MONTHS",
    impact:
      "실제 입력 snapshot의 horizon이 YEARS에서 MONTHS(으)로 바뀌어 목적과 기간의 일치 여부를 다시 확인해야 합니다.",
  });
});

test("zero or multiple comparison changes fail closed", () => {
  const noChange = finalizePlan(DEMO_BASELINE, safePlan, {
    baselineInput: structuredClone(DEMO_BASELINE),
  });
  assert.equal(noChange.generation.outcome, "FAILURE");
  assert.equal(noChange.plan.status, "SAFETY_PAUSE");
  assert.equal(noChange.safetyOverride, "COUNTERFACTUAL_MISMATCH");

  const twoChanges = structuredClone(DEMO_COUNTERFACTUAL);
  twoChanges.urgency = "TODAY";
  const multiple = finalizePlan(twoChanges, safePlan, {
    baselineInput: DEMO_BASELINE,
  });
  assert.equal(multiple.generation.outcome, "FAILURE");
  assert.equal(multiple.plan.status, "SAFETY_PAUSE");
  assert.equal(multiple.safetyOverride, "COUNTERFACTUAL_MISMATCH");
});
