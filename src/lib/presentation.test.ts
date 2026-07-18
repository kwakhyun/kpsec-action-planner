import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_BASELINE } from "./demo-inputs";
import {
  CHOICE_LABELS,
  fieldPathLabel,
  generationSummary,
  HORIZON_LABELS,
  humanizePlanText,
  INTENT_LABELS,
  MODE_LABELS,
  STATUS_LABELS,
} from "./presentation";

test("beginner labels preserve internal enum values outside the presentation layer", () => {
  assert.equal(INTENT_LABELS.BUY, "사고 싶어요");
  assert.equal(HORIZON_LABELS.YEARS, "1년 이상");
  assert.equal(MODE_LABELS.OFFLINE_DEMO, "예시 데이터로 체험");
  assert.equal(
    STATUS_LABELS.SAFETY_PAUSE,
    "잠시 멈추고 확인해 주세요",
  );
  assert.equal(CHOICE_LABELS.ADD_INFORMATION, "정보 추가하기");
});

test("plan text hides enums and evidence IDs without changing source data", () => {
  const original =
    "SYNTH-EV-001의 LONG_TERM_GROWTH와 YEARS를 확인합니다.";
  const shown = humanizePlanText(original, DEMO_BASELINE.userEvidence);

  assert.equal(
    shown,
    "참고 정보 1의 장기적인 성장을 기대해요와 1년 이상을 확인합니다.",
  );
  assert.equal(original.includes("SYNTH-EV-001"), true);
  assert.equal(DEMO_BASELINE.userEvidence[0].id, "SYNTH-EV-001");
});

test("plan text uses natural Korean for intent and date particles", () => {
  assert.equal(
    humanizePlanText("사용자가 BUY 의도를 입력했고 기준일과 기준일을 확인했습니다."),
    "사용자가 사고 싶은 상황을 입력했고 확인한 날짜와 확인한 날짜를 확인했습니다.",
  );
});

test("counterfactual paths and values use user language", () => {
  assert.equal(fieldPathLabel("horizon"), "보유 기간");
  assert.equal(humanizePlanText("YEARS → MONTHS"), "1년 이상 → 몇 달");
});

test("generation summaries explain the outcome without raw provenance", () => {
  assert.equal(
    generationSummary({
      requestedMode: "OFFLINE_DEMO",
      mode: "OFFLINE_DEMO",
      outcome: "SUCCESS",
      failureCode: null,
      fixtureId: "ACTION_PLANNER_BASELINE",
      fixtureVersion: "2.0.0",
    }),
    "예시 데이터 분석을 마쳤습니다.",
  );
});
