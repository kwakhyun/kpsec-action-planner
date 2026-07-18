import assert from "node:assert/strict";
import test from "node:test";

import { PlanEnvelopeSchema } from "./contracts";
import {
  DEMO_BASELINE,
  DEMO_COUNTERFACTUAL,
  DEMO_MISSING_INFO,
} from "./demo-inputs";
import {
  getOfflineDemoFixture,
  OFFLINE_DEMO_FIXTURE_IDS,
  OFFLINE_DEMO_VERSION,
  runOfflineDemo,
} from "./offline-demo";

test("offline fixture registry is fixed at version 2.0.0", () => {
  assert.equal(OFFLINE_DEMO_VERSION, "2.0.0");
  assert.deepEqual(OFFLINE_DEMO_FIXTURE_IDS, [
    "ACTION_PLANNER_BASELINE",
    "ACTION_PLANNER_COUNTERFACTUAL",
    "ACTION_PLANNER_MISSING_INFO",
  ]);
  assert.deepEqual(
    getOfflineDemoFixture("ACTION_PLANNER_BASELINE")?.input,
    DEMO_BASELINE,
  );
  assert.equal(getOfflineDemoFixture("NOT_REGISTERED"), null);
});

test("baseline offline fixture is review-ready with exact provenance", () => {
  const result = runOfflineDemo("ACTION_PLANNER_BASELINE", DEMO_BASELINE);

  assert.equal(result.envelope.plan.status, "READY_FOR_REVIEW");
  assert.deepEqual(result.envelope.generation, {
    requestedMode: "OFFLINE_DEMO",
    mode: "OFFLINE_DEMO",
    outcome: "SUCCESS",
    failureCode: null,
    fixtureId: "ACTION_PLANNER_BASELINE",
    fixtureVersion: "2.0.0",
  });
  assert.equal(result.envelope.safetyOverride, null);
  assert.equal(PlanEnvelopeSchema.safeParse(result.envelope).success, true);
});

test("counterfactual offline fixture uses the exact horizon delta and pauses", () => {
  const result = runOfflineDemo(
    "ACTION_PLANNER_COUNTERFACTUAL",
    DEMO_COUNTERFACTUAL,
    DEMO_BASELINE,
  );

  assert.equal(result.envelope.generation.mode, "OFFLINE_DEMO");
  assert.equal(result.envelope.generation.outcome, "SUCCESS");
  assert.equal(result.envelope.plan.status, "SAFETY_PAUSE");
  assert.equal(result.envelope.safetyOverride, "CONSTRAINT_CONFLICT");
  assert.equal(result.envelope.plan.counterfactuals[0].fieldPath, "horizon");
  assert.equal(result.envelope.plan.counterfactuals[0].from, "YEARS");
  assert.equal(result.envelope.plan.counterfactuals[0].to, "MONTHS");
  assert.equal(PlanEnvelopeSchema.safeParse(result.envelope).success, true);
});

test("missing-info offline fixture is not called and remains traceable", () => {
  const result = runOfflineDemo(
    "ACTION_PLANNER_MISSING_INFO",
    DEMO_MISSING_INFO,
  );

  assert.equal(result.envelope.plan.status, "SAFETY_PAUSE");
  assert.deepEqual(result.envelope.generation, {
    requestedMode: "OFFLINE_DEMO",
    mode: "NOT_CALLED",
    outcome: "SKIPPED",
    failureCode: null,
    fixtureId: "ACTION_PLANNER_MISSING_INFO",
    fixtureVersion: "2.0.0",
  });
  assert.equal(result.envelope.safetyOverride, "MISSING_CRITICAL_INPUT");
  assert.equal(PlanEnvelopeSchema.safeParse(result.envelope).success, true);
});

test("offline results are deterministic deep copies and perform no fetch", () => {
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    fetchCalls += 1;
    throw new Error("offline demo must not fetch");
  }) as typeof fetch;

  try {
    const first = runOfflineDemo("ACTION_PLANNER_BASELINE");
    const second = runOfflineDemo("ACTION_PLANNER_BASELINE");
    assert.deepEqual(first, second);
    assert.notEqual(first, second);
    assert.equal(fetchCalls, 0);

    first.input.subjectLabel = "호출자가 변경한 값";
    assert.equal(
      runOfflineDemo("ACTION_PLANNER_BASELINE").input.subjectLabel,
      DEMO_BASELINE.subjectLabel,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unknown ID and unregistered input fail closed without fixture guessing", () => {
  const unknownId = runOfflineDemo("USER_CONTROLLED_ID", DEMO_BASELINE);
  assert.equal(unknownId.envelope.plan.status, "SAFETY_PAUSE");
  assert.equal(unknownId.envelope.generation.mode, "NOT_CALLED");
  assert.equal(unknownId.envelope.generation.outcome, "SKIPPED");
  assert.equal(
    unknownId.envelope.generation.fixtureId,
    "UNREGISTERED_OFFLINE_FIXTURE",
  );

  const changedInput = structuredClone(DEMO_BASELINE);
  changedInput.subjectLabel = "등록되지 않은 입력";
  const mismatch = runOfflineDemo("ACTION_PLANNER_BASELINE", changedInput);
  assert.equal(mismatch.envelope.plan.status, "SAFETY_PAUSE");
  assert.equal(mismatch.envelope.generation.mode, "NOT_CALLED");
  assert.equal(mismatch.envelope.generation.fixtureId, "UNREGISTERED_OFFLINE_FIXTURE");
  assert.equal(PlanEnvelopeSchema.safeParse(mismatch.envelope).success, true);
});

test("counterfactual rejects a baseline other than the registered snapshot", () => {
  const wrongBaseline = structuredClone(DEMO_BASELINE);
  wrongBaseline.urgency = "TODAY";
  const result = runOfflineDemo(
    "ACTION_PLANNER_COUNTERFACTUAL",
    DEMO_COUNTERFACTUAL,
    wrongBaseline,
  );

  assert.equal(result.envelope.plan.status, "SAFETY_PAUSE");
  assert.equal(result.envelope.generation.mode, "NOT_CALLED");
  assert.equal(result.envelope.generation.fixtureId, "UNREGISTERED_OFFLINE_FIXTURE");
});
