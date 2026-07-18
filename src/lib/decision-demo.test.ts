import assert from "node:assert/strict";
import test from "node:test";

import {
  DECISION_DEMO_BASELINE,
  DECISION_DEMO_TOLERANCE_CHANGE,
  DECISION_DEMO_VERSION,
  runOfflineDecisionDemo,
} from "./decision-demo";

test("offline baseline is deterministic and carries explicit synthetic provenance", () => {
  const first = runOfflineDecisionDemo("BASELINE");
  const second = runOfflineDecisionDemo("BASELINE");

  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.equal(first.status, "READY_FOR_REVIEW");
  assert.deepEqual(first.inputSnapshot, DECISION_DEMO_BASELINE);
  assert.deepEqual(first.generation, {
    requestedMode: "OFFLINE_DEMO",
    mode: "OFFLINE_DEMO",
    outcome: "SUCCESS",
    failureCode: null,
    fixtureId: "REGRET_BUDGET_SAMSUNG_BASELINE",
    fixtureVersion: DECISION_DEMO_VERSION,
    model: null,
  });
  assert.equal(first.market.mode, "SYNTHETIC_FIXTURE");
  assert.equal(first.market.outcome, "SUCCESS");
  assert.equal(first.market.snapshot?.synthetic, true);
  assert.equal(first.market.snapshot?.sourceUrl, null);
  assert.match(first.market.snapshot?.delayNotice ?? "", /합성 데이터/);
});

test("tolerance fixture changes only tolerance input and deterministically changes allocation and review line", () => {
  const baseline = runOfflineDecisionDemo("BASELINE");
  const changed = runOfflineDecisionDemo("TOLERANCE_CHANGE");

  const changedInputKeys = Object.keys(DECISION_DEMO_BASELINE).filter(
    (key) =>
      DECISION_DEMO_BASELINE[
        key as keyof typeof DECISION_DEMO_BASELINE
      ] !==
      DECISION_DEMO_TOLERANCE_CHANGE[
        key as keyof typeof DECISION_DEMO_TOLERANCE_CHANGE
      ],
  );

  assert.deepEqual(changedInputKeys, ["maxAdverseMovePct"]);
  assert.equal(changed.inputSnapshot?.maxAdverseMovePct, 4);
  assert.equal(changed.generation.fixtureVersion, DECISION_DEMO_VERSION);
  assert.equal(
    changed.generation.fixtureId,
    "REGRET_BUDGET_SAMSUNG_TOLERANCE_CHANGE",
  );
  assert.ok(baseline.decision);
  assert.ok(changed.decision);

  const baselineStaged = baseline.decision?.plans.find(
    (plan) => plan.id === "STAGED_3",
  );
  const changedStaged = changed.decision?.plans.find(
    (plan) => plan.id === "STAGED_3",
  );
  assert.notDeepEqual(
    baselineStaged?.allocations.map((allocation) => allocation.shares),
    changedStaged?.allocations.map((allocation) => allocation.shares),
  );
  assert.notEqual(
    baselineStaged?.reviewLine.lowerReviewPriceKrw,
    changedStaged?.reviewLine.lowerReviewPriceKrw,
  );
});

test("offline data failure creates neither a decision nor an AI explanation", () => {
  const result = runOfflineDecisionDemo("DATA_FAILURE");

  assert.equal(result.status, "SAFETY_PAUSE");
  assert.equal(result.market.outcome, "FAILURE");
  assert.equal(result.market.failureCode, "DATA_PROVIDER_FAILURE");
  assert.equal(result.market.snapshot, null);
  assert.equal(result.generation.mode, "NOT_CALLED");
  assert.equal(result.generation.outcome, "SKIPPED");
  assert.equal(result.generation.failureCode, "DATA_PROVIDER_FAILURE");
  assert.equal(result.decision, null);
  assert.equal(result.explanation, null);
});
