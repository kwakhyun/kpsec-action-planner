import assert from "node:assert/strict";
import test from "node:test";

import OpenAI from "openai";

import {
  AdversarialReviewRequestSchema,
  type AdversarialReviewRequest,
  type AdversarialReviewResult,
} from "./adversarial-review-contracts";
import { calculateRegretBudgetExecution } from "./execution-core";
import {
  AdversarialReviewGenerationError,
  normalizeAdversarialError,
  validateAdversarialReview,
  validateParsedAdversarialResponse,
} from "./generate-adversarial-review";

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
    rangeLow: 75_000,
    rangeHigh: 85_000,
    relativeVolume: 1.1,
    freshness: {
      status: "FRESH",
      asOf: "2026-07-17T06:30:00.000Z",
      checkedAt: "2026-07-17T06:40:00.000Z",
      maxAgeMinutes: 30,
    },
  },
});

if (!core.ok) throw new Error("TEST_CORE_FAILURE");

const REQUEST: AdversarialReviewRequest =
  AdversarialReviewRequestSchema.parse({
    mode: "LIVE",
    subjectLabel: "공개 시연 종목",
    symbol: "005930.KS",
    userInput: {
      concernMode: "PRE_BUY",
      intent: "BUY",
      constraints: [
        { key: "DEADLINE", label: "실행기한", value: "THIS_WEEK" },
        { key: "LOSS_TOLERANCE", label: "감당 범위", value: 8 },
      ],
    },
    facts: [
      {
        id: "MARKET_LATEST_PRICE",
        label: "최근 확인 가격",
        observation: "검증된 최근 가격",
        sourceLabel: "Yahoo Finance 공개 데이터",
      },
      {
        id: "MARKET_RANGE_20D",
        label: "최근 고저 범위",
        observation: "검증된 최근 고저 범위",
        sourceLabel: "Yahoo Finance 공개 데이터",
      },
    ],
    currentPlan: core,
    dataContext: {
      asOf: "2026-07-17T06:30:00.000Z",
      fetchedAt: "2026-07-17T06:40:00.000Z",
      limitations: ["실시간 호가를 확인하지 않았습니다."],
    },
    missingInformation: ["실시간 호가와 체결 가능성"],
    allowedQuestionKeys: [
      "CONFIRM_REGRET_PRIORITY",
      "CONFIRM_LOSS_TOLERANCE",
    ],
  });

const VALID_RESULT: AdversarialReviewResult = {
  counterarguments: [
    {
      argument: "최근 관측 범위 밖에서는 같은 계획을 그대로 적용하기 어렵습니다.",
      factIds: ["MARKET_RANGE_20D"],
    },
  ],
  unverifiedAssumption: "사용자가 같은 실행기한을 유지한다는 가정입니다.",
  questionKey: "CONFIRM_LOSS_TOLERANCE",
  question: "감당 범위를 지금보다 줄여서 다시 비교할까요?",
  whatWouldChangePlan: "답이 달라지면 결정 코어가 회차별 비중을 다시 계산합니다.",
};

function assertReviewError(
  run: () => unknown,
  code: AdversarialReviewGenerationError["code"],
) {
  assert.throws(
    run,
    (error: unknown) =>
      error instanceof AdversarialReviewGenerationError && error.code === code,
  );
}

test("검증된 fact ID만 참조하는 반대 의견을 허용한다", () => {
  assert.deepEqual(validateAdversarialReview(VALID_RESULT, REQUEST), VALID_RESULT);
});

test("orphan·중복 fact ID는 결과 없는 의미 검증 실패다", () => {
  assertReviewError(
    () =>
      validateAdversarialReview(
        {
          ...VALID_RESULT,
          counterarguments: [
            { argument: "확인하지 않은 근거입니다.", factIds: ["ORPHAN_FACT"] },
          ],
        },
        REQUEST,
      ),
    "SEMANTIC_GUARD",
  );
  assertReviewError(
    () =>
      validateAdversarialReview(
        {
          ...VALID_RESULT,
          counterarguments: [
            {
              argument: "같은 근거를 중복 참조했습니다.",
              factIds: ["MARKET_RANGE_20D", "MARKET_RANGE_20D"],
            },
          ],
        },
        REQUEST,
      ),
    "SEMANTIC_GUARD",
  );
  assert.equal(
    AdversarialReviewRequestSchema.safeParse({
      ...REQUEST,
      facts: [REQUEST.facts[0], REQUEST.facts[0]],
    }).success,
    false,
  );
});

test("새 수치·날짜·가격 예측 문구는 모두 거부한다", () => {
  for (const argument of [
    "가격이 5퍼센트 움직일 수 있습니다.",
    "2026년에 조건이 달라질 수 있습니다.",
    "곧 반등할 가능성이 큽니다.",
  ]) {
    assertReviewError(
      () =>
        validateAdversarialReview(
          {
            ...VALID_RESULT,
            counterarguments: [
              { argument, factIds: ["MARKET_LATEST_PRICE"] },
            ],
          },
          REQUEST,
        ),
      "SEMANTIC_GUARD",
    );
  }
});

test("refusal·incomplete·parse·schema 오류는 결과를 만들지 않는다", () => {
  assertReviewError(
    () =>
      validateParsedAdversarialResponse(
        {
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "refusal", refusal: "cannot answer" }],
            },
          ],
          outputParsed: null,
        },
        REQUEST,
      ),
    "REFUSAL",
  );
  assertReviewError(
    () =>
      validateParsedAdversarialResponse(
        { status: "incomplete", output: [], outputParsed: VALID_RESULT },
        REQUEST,
      ),
    "INCOMPLETE",
  );
  assertReviewError(
    () =>
      validateParsedAdversarialResponse(
        { status: "completed", output: [], outputParsed: null },
        REQUEST,
      ),
    "PARSE_ERROR",
  );
  assertReviewError(
    () =>
      validateParsedAdversarialResponse(
        { status: "completed", output: [], outputParsed: { counterarguments: [] } },
        REQUEST,
      ),
    "SCHEMA_ERROR",
  );
});

test("SDK timeout은 provider 본문 없이 TIMEOUT으로 정규화한다", () => {
  const error = normalizeAdversarialError(
    new OpenAI.APIConnectionTimeoutError({ message: "provider detail" }),
  );
  assert.equal(error.code, "TIMEOUT");
  assert.equal(error.message, "TIMEOUT");
});
