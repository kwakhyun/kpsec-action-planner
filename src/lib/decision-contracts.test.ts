import assert from "node:assert/strict";
import test from "node:test";

import { DecisionConversationInputSchema } from "./decision-contracts";

const SHARED_INPUT = {
  subjectLabel: "삼성전자",
  symbol: "005930.KS",
  deadline: "THIS_WEEK" as const,
  regretPriority: "MISSED_OPPORTUNITY" as const,
  maxAdverseMovePct: 5,
};

test("BUY exposure requires a budget and excludes a holding quantity", () => {
  const valid = DecisionConversationInputSchema.safeParse({
    ...SHARED_INPUT,
    intent: "BUY",
    budgetKrw: 10_000_000,
    holdingQuantity: null,
  });
  const missingBudget = DecisionConversationInputSchema.safeParse({
    ...SHARED_INPUT,
    intent: "BUY",
    budgetKrw: null,
    holdingQuantity: null,
  });
  const crossedExposure = DecisionConversationInputSchema.safeParse({
    ...SHARED_INPUT,
    intent: "BUY",
    budgetKrw: 10_000_000,
    holdingQuantity: 20,
  });

  assert.equal(valid.success, true);
  assert.equal(missingBudget.success, false);
  assert.equal(crossedExposure.success, false);
  if (missingBudget.success || crossedExposure.success) return;
  assert.deepEqual(missingBudget.error.issues[0].path, ["budgetKrw"]);
  assert.deepEqual(crossedExposure.error.issues[0].path, ["holdingQuantity"]);
});

test("SELL exposure requires a holding quantity and excludes a budget", () => {
  const valid = DecisionConversationInputSchema.safeParse({
    ...SHARED_INPUT,
    intent: "SELL",
    budgetKrw: null,
    holdingQuantity: 125,
  });
  const missingHolding = DecisionConversationInputSchema.safeParse({
    ...SHARED_INPUT,
    intent: "SELL",
    budgetKrw: null,
    holdingQuantity: null,
  });
  const crossedExposure = DecisionConversationInputSchema.safeParse({
    ...SHARED_INPUT,
    intent: "SELL",
    budgetKrw: 1_000_000,
    holdingQuantity: 125,
  });

  assert.equal(valid.success, true);
  assert.equal(missingHolding.success, false);
  assert.equal(crossedExposure.success, false);
  if (missingHolding.success || crossedExposure.success) return;
  assert.deepEqual(missingHolding.error.issues[0].path, ["holdingQuantity"]);
  assert.deepEqual(crossedExposure.error.issues[0].path, ["budgetKrw"]);
});

test("감당 범위 50%는 허용하고 초과값은 한국어로 안내한다", () => {
  const accepted = DecisionConversationInputSchema.safeParse({
    ...SHARED_INPUT,
    intent: "SELL",
    budgetKrw: null,
    holdingQuantity: 125,
    maxAdverseMovePct: 50,
  });
  const rejected = DecisionConversationInputSchema.safeParse({
    ...SHARED_INPUT,
    intent: "SELL",
    budgetKrw: null,
    holdingQuantity: 125,
    maxAdverseMovePct: 50.5,
  });

  assert.equal(accepted.success, true);
  assert.equal(rejected.success, false);
  if (rejected.success) return;
  assert.equal(
    rejected.error.issues[0]?.message,
    "감당 범위는 50% 이하로 입력해 주세요.",
  );
  assert.doesNotMatch(rejected.error.issues[0]?.message ?? "", /Too big|expected/);
});
