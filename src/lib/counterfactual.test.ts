import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveCounterfactualFromSnapshots,
  diffInputSnapshots,
  isExactlyOneFieldDifferent,
} from "./counterfactual";
import {
  DEMO_BASELINE,
  DEMO_COUNTERFACTUAL,
} from "./test-fixtures/action-plan-inputs";

test("pure input diff finds the exact horizon leaf and snapshot values", () => {
  assert.deepEqual(diffInputSnapshots(DEMO_BASELINE, DEMO_COUNTERFACTUAL), [
    { fieldPath: "horizon", from: "YEARS", to: "MONTHS" },
  ]);
  assert.equal(
    isExactlyOneFieldDifferent(DEMO_BASELINE, DEMO_COUNTERFACTUAL),
    true,
  );
});

test("counterfactual delta is deterministic and derived from snapshots", () => {
  const first = deriveCounterfactualFromSnapshots(
    structuredClone(DEMO_BASELINE),
    structuredClone(DEMO_COUNTERFACTUAL),
  );
  const second = deriveCounterfactualFromSnapshots(
    structuredClone(DEMO_BASELINE),
    structuredClone(DEMO_COUNTERFACTUAL),
  );

  assert.deepEqual(first, second);
  assert.equal(first.comparable, true);
  if (first.comparable) {
    assert.equal(first.counterfactual.fieldPath, "horizon");
    assert.equal(first.counterfactual.from, "YEARS");
    assert.equal(first.counterfactual.to, "MONTHS");
  }
});

test("identical and multi-field snapshots are not comparable", () => {
  const identical = deriveCounterfactualFromSnapshots(
    DEMO_BASELINE,
    structuredClone(DEMO_BASELINE),
  );
  assert.equal(identical.comparable, false);
  if (!identical.comparable) {
    assert.equal(identical.reason, "NO_CHANGED_FIELD");
    assert.deepEqual(identical.changes, []);
  }

  const multipleInput = structuredClone(DEMO_COUNTERFACTUAL);
  multipleInput.urgency = "TODAY";
  const multiple = deriveCounterfactualFromSnapshots(
    DEMO_BASELINE,
    multipleInput,
  );
  assert.equal(multiple.comparable, false);
  if (!multiple.comparable) {
    assert.equal(multiple.reason, "MULTIPLE_CHANGED_FIELDS");
    assert.deepEqual(
      multiple.changes.map((change) => change.fieldPath),
      ["horizon", "urgency"],
    );
  }
});

test("nested evidence leaf changes retain a stable field path", () => {
  const comparison = structuredClone(DEMO_BASELINE);
  comparison.userEvidence[0].observedAt = "2026-07-02";

  assert.deepEqual(diffInputSnapshots(DEMO_BASELINE, comparison), [
    {
      fieldPath: "userEvidence[0].observedAt",
      from: "2026-07-01",
      to: "2026-07-02",
    },
  ]);
});
