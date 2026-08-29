import assert from "node:assert/strict";
import test from "node:test";

import type { AgentDecisionExplanation } from "./decision-contracts";
import {
  DecisionExplanationGuardError,
  validateDecisionExplanation,
} from "./generate-decision-explanation";
import { DECISION_EXPLANATION_SYSTEM_PROMPT } from "./decision-prompt";
import { createDecisionFixture } from "./test-fixtures/decision-fixtures";

const DECISION = createDecisionFixture();

const VALID_EXPLANATION: AgentDecisionExplanation = {
  understoodConcern:
    "기회를 놓치는 걱정이 한 시점의 가격 부담보다 더 큰 고민으로 이해했습니다.",
  oneShotBenefit: "남은 수량을 계속 신경 써야 하는 부담을 줄일 수 있습니다.",
  oneShotRisk: "전체 수량이 같은 확인 시점의 가격에 영향을 받습니다.",
  stagedBenefit: "한 가격에 몰리는 부담을 여러 확인 시점으로 나눌 수 있습니다.",
  stagedRisk: "다음 확인 전에 상황이 바뀌면 계획한 수량이 남을 수 있습니다.",
  priorityPlanId: DECISION.preferredPlanId,
  priorityReason:
    "기회를 놓치는 후회를 더 크게 답했으므로 일괄안을 먼저 비교 대상으로 살펴봅니다.",
  nextQuestionKey: "NONE",
};

function assertGuardRejects(candidate: unknown): void {
  assert.throws(
    () => validateDecisionExplanation(candidate, DECISION),
    (error: unknown) => error instanceof DecisionExplanationGuardError,
  );
}

test("semantic validation accepts plain language tied to the core-owned preferred plan", () => {
  assert.deepEqual(
    validateDecisionExplanation(VALID_EXPLANATION, DECISION),
    VALID_EXPLANATION,
  );
});

test("prompt copies the core-owned preferred plan instead of asking AI to re-decide it", () => {
  assert.match(
    DECISION_EXPLANATION_SYSTEM_PROMPT,
    /priorityPlanId에는 verifiedMarketAndPlans\.preferredPlanId 값을 그대로 복사/,
  );
  assert.match(
    DECISION_EXPLANATION_SYSTEM_PROMPT,
    /AI는 이 결정을 재해석하거나 뒤집지 않고/,
  );
  assert.doesNotMatch(
    DECISION_EXPLANATION_SYSTEM_PROMPT,
    /감당 범위보다 최근 고저 변동이 크거나.*분할안을 우선/,
  );
});

test("semantic validation rejects unknown and mismatched plan IDs", () => {
  assertGuardRejects({
    ...VALID_EXPLANATION,
    priorityPlanId: "UNKNOWN_PLAN",
  });

  const mismatchedPlanId = DECISION.plans.find(
    (plan) => plan.id !== DECISION.preferredPlanId,
  )?.id;
  assert.ok(mismatchedPlanId);
  assertGuardRejects({
    ...VALID_EXPLANATION,
    priorityPlanId: mismatchedPlanId,
  });
});

test("semantic validation rejects any Arabic digit in generated prose", () => {
  assertGuardRejects({
    ...VALID_EXPLANATION,
    stagedBenefit: "3회로 나누면 한 가격에 몰리는 부담을 줄일 수 있습니다.",
  });
});

test("semantic validation rejects price predictions and guarantees", () => {
  assertGuardRejects({
    ...VALID_EXPLANATION,
    priorityReason: "이 종목은 반드시 오를 것이므로 일괄안을 선택합니다.",
  });
  assertGuardRejects({
    ...VALID_EXPLANATION,
    priorityReason: "원금 보장이 되므로 안심하고 진행할 수 있습니다.",
  });
});
