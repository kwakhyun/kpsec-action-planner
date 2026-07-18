import assert from "node:assert/strict";
import test from "node:test";

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import { ActionPlanSchema, type ActionPlan } from "./contracts";
import {
  normalizeRequestError,
  PlanGenerationError,
  requireGenerationConfiguration,
  validateParsedGenerationResponse,
} from "./generate-plan";

const validPlan: ActionPlan = {
  status: "READY_FOR_REVIEW",
  currentSituation: {
    intentSummary: "사용자가 입력한 의도를 검토 계획으로 구조화합니다.",
    confirmedFacts: [
      {
        statement: "가상 근거 원문을 확인했습니다.",
        basis: "USER_PROVIDED",
        verification: "NOT_INDEPENDENTLY_VERIFIED",
      },
    ],
  },
  userEvidence: [
    {
      id: "EVID-TEST-001",
      statement: "가상 근거 원문을 확인했습니다.",
      sourceLabel: "가상 자료",
      observedAt: null,
      basis: "USER_PROVIDED",
      verification: "NOT_INDEPENDENTLY_VERIFIED",
    },
  ],
  reasons: ["결론보다 근거 확인 순서를 먼저 점검합니다."],
  uncertainties: ["사용자 근거는 독립적으로 검증되지 않았습니다."],
  orderedChecks: [
    {
      order: 1,
      check: "가상 근거의 원문과 기준일 확인",
      why: "사용자가 적은 주장과 원문을 구분하기 위해서입니다.",
      howToVerify: "사용자가 제공한 출처 라벨과 원문을 대조합니다.",
      doneWhen: "주장, 출처, 기준일을 각각 구분해 기록했습니다.",
      evidenceRefs: ["EVID-TEST-001"],
    },
  ],
  decisionGates: [
    {
      question: "필수 근거의 원문과 기준일이 확인됐나요?",
      passCondition: "두 항목을 모두 대조했습니다.",
      onPass: "남은 불확실성을 다시 검토합니다.",
      onFail: "검토를 멈추고 정보를 보완합니다.",
      evidenceRefs: ["EVID-TEST-001"],
    },
  ],
  stopConditions: [
    {
      trigger: "근거 원문 또는 기준일을 확인하지 못함",
      reason: "확인되지 않은 주장으로 검토를 이어가지 않기 위해서입니다.",
      resumeWhen: "원문과 기준일을 확인했습니다.",
    },
  ],
  counterfactuals: [
    {
      fieldPath: "horizon",
      changedAssumption: "검토 기간",
      from: "장기",
      to: "단기",
      impact: "목적과 기간의 충돌을 다시 확인해야 합니다.",
    },
  ],
  nextQuestions: ["근거의 원문을 직접 확인했나요?"],
  finalChoice: {
    prompt: "사용자가 다음 검토 행동을 선택합니다.",
    options: ["REVIEW_MORE", "ADD_INFORMATION", "PAUSE"],
  },
};

test("the installed OpenAI SDK converts the card Zod schema to strict Structured Outputs", () => {
  const format = zodTextFormat(ActionPlanSchema, "action_plan");

  assert.equal(format.type, "json_schema");
  assert.equal(format.name, "action_plan");
  assert.equal(format.strict, true);
});

function assertPlanError(
  run: () => unknown,
  expectedCode: PlanGenerationError["code"],
) {
  assert.throws(
    run,
    (error: unknown) =>
      error instanceof PlanGenerationError && error.code === expectedCode,
  );
}

test("missing OpenAI configuration fails closed before a request", () => {
  assertPlanError(
    () => requireGenerationConfiguration({}),
    "MISSING_CONFIGURATION",
  );
  assertPlanError(
    () => requireGenerationConfiguration({ OPENAI_API_KEY: "test-key" }),
    "MISSING_CONFIGURATION",
  );
});

test("completed refusal is classified before parsed-null", () => {
  assertPlanError(
    () =>
      validateParsedGenerationResponse({
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "refusal", refusal: "not available" }],
          },
        ],
        outputParsed: null,
      }),
    "REFUSAL",
  );
});

test("incomplete response is never treated as a card", () => {
  assertPlanError(
    () =>
      validateParsedGenerationResponse({
        status: "incomplete",
        output: [],
        outputParsed: validPlan,
      }),
    "INCOMPLETE",
  );
});

test("missing parsed output is a parse failure", () => {
  assertPlanError(
    () =>
      validateParsedGenerationResponse({
        status: "completed",
        output: [],
        outputParsed: null,
      }),
    "PARSE_ERROR",
  );
});

test("schema-invalid parsed output is discarded", () => {
  assertPlanError(
    () =>
      validateParsedGenerationResponse({
        status: "completed",
        output: [],
        outputParsed: { status: "READY_FOR_REVIEW" },
      }),
    "SCHEMA_ERROR",
  );
});

test("SDK timeout is normalized without exposing its message", () => {
  const error = normalizeRequestError(
    new OpenAI.APIConnectionTimeoutError({ message: "provider detail" }),
  );

  assert.equal(error.code, "TIMEOUT");
  assert.equal(error.message, "TIMEOUT");
});

test("SDK parser failures map to deterministic local categories", () => {
  assert.equal(normalizeRequestError(new SyntaxError("raw body")).code, "PARSE_ERROR");

  const zodResult = z.object({ value: z.string() }).safeParse({ value: 1 });
  assert.equal(zodResult.success, false);
  if (!zodResult.success) {
    assert.equal(normalizeRequestError(zodResult.error).code, "SCHEMA_ERROR");
  }
});
