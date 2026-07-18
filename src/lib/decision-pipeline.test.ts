import assert from "node:assert/strict";
import test from "node:test";

import type { AgentDecisionExplanation } from "./decision-contracts";
import { DECISION_DEMO_BASELINE } from "./decision-demo";
import { runLiveDecisionPipeline } from "./decision-pipeline";
import { PlanGenerationError } from "./generate-plan";
import {
  MARKET_DATA_DELAY_CAVEAT,
  MarketDataError,
  type MarketDataFailureCode,
  type MarketSnapshot,
} from "./market-data";

const FIRST_TIMESTAMP = Date.parse("2026-06-27T00:00:00.000Z") / 1_000;

const MARKET: MarketSnapshot = {
  symbol: "005930.KS",
  provider: "Yahoo Finance",
  sourceUrl:
    "https://query1.finance.yahoo.com/v8/finance/chart/005930.KS?range=3mo&interval=1d",
  fetchedAt: "2026-07-18T00:00:00.000Z",
  asOf: "2026-07-17T00:00:00.000Z",
  range: "3mo",
  interval: "1d",
  delayNotice: MARKET_DATA_DELAY_CAVEAT,
  synthetic: false,
  currency: "KRW",
  exchange: "KSC",
  exchangeTimezone: "Asia/Seoul",
  bars: Array.from({ length: 21 }, (_, index) => ({
    timestamp: FIRST_TIMESTAMP + index * 86_400,
    open: 79_500 + index * 10,
    high: 85_000,
    low: 75_000,
    close: 80_000,
    volume: 1_000_000 + index,
  })),
  metrics: {
    latestPrice: 80_000,
    volatility20dPct: 11.4,
    range20d: {
      high: 85_000,
      low: 75_000,
      percent: 12.5,
    },
    relativeVolume20d: 1.18,
  },
};

function explanationFor(
  priorityPlanId: AgentDecisionExplanation["priorityPlanId"],
): AgentDecisionExplanation {
  return {
    understoodConcern:
      "기회를 놓치는 걱정이 가격 부담보다 더 큰 고민으로 이해했습니다.",
    oneShotBenefit: "남은 수량을 신경 써야 하는 부담을 줄일 수 있습니다.",
    oneShotRisk: "전체 수량이 같은 확인 시점의 가격에 영향을 받습니다.",
    stagedBenefit: "한 가격에 몰리는 부담을 여러 확인 시점으로 나눕니다.",
    stagedRisk: "다음 확인 전에 상황이 바뀌면 계획한 수량이 남을 수 있습니다.",
    priorityPlanId,
    priorityReason:
      "기회를 놓치는 후회를 더 크게 답했으므로 이 안을 먼저 비교합니다.",
    nextQuestionKey: "NONE",
  };
}

test("live pipeline succeeds with injected market and explanation dependencies", async () => {
  let fetchedSymbol = "";
  let explainCalls = 0;
  const result = await runLiveDecisionPipeline(DECISION_DEMO_BASELINE, {
    fetchMarket: async (symbol) => {
      fetchedSymbol = symbol;
      return MARKET;
    },
    explain: async ({ decision, input, market }) => {
      explainCalls += 1;
      assert.deepEqual(input, DECISION_DEMO_BASELINE);
      assert.equal(market, MARKET);
      return {
        explanation: explanationFor(decision.preferredPlanId),
        model: "test-model",
      };
    },
  });

  assert.equal(fetchedSymbol, "005930.KS");
  assert.equal(explainCalls, 1);
  assert.equal(result.status, "READY_FOR_REVIEW");
  assert.equal(result.market.mode, "YAHOO_LIVE");
  assert.equal(result.market.outcome, "SUCCESS");
  assert.equal(result.market.snapshot?.synthetic, false);
  assert.equal(result.decision?.selectedBy, "DETERMINISTIC_CORE");
  assert.equal(result.explanation?.priorityPlanId, result.decision?.preferredPlanId);
  assert.deepEqual(result.generation, {
    requestedMode: "LIVE",
    mode: "LIVE",
    outcome: "SUCCESS",
    failureCode: null,
    fixtureId: null,
    fixtureVersion: null,
    model: "test-model",
  });
});

const MARKET_FAILURE_CODES: readonly MarketDataFailureCode[] = [
  "DATA_PROVIDER_FAILURE",
  "DATA_SCHEMA_FAILURE",
  "DATA_INSUFFICIENT",
  "DATA_STALE",
];

for (const failureCode of MARKET_FAILURE_CODES) {
  test(`market ${failureCode} skips AI and returns no decision`, async () => {
    let explainCalls = 0;
    const result = await runLiveDecisionPipeline(DECISION_DEMO_BASELINE, {
      fetchMarket: async () => {
        throw new MarketDataError(failureCode);
      },
      explain: async () => {
        explainCalls += 1;
        throw new Error("EXPLAIN_SHOULD_NOT_BE_CALLED");
      },
    });

    assert.equal(explainCalls, 0);
    assert.equal(result.status, "SAFETY_PAUSE");
    assert.equal(result.market.mode, "YAHOO_LIVE");
    assert.equal(result.market.outcome, "FAILURE");
    assert.equal(result.market.failureCode, failureCode);
    assert.equal(result.market.snapshot, null);
    assert.equal(result.generation.mode, "NOT_CALLED");
    assert.equal(result.generation.outcome, "SKIPPED");
    assert.equal(result.generation.failureCode, failureCode);
    assert.equal(result.generation.fixtureId, null);
    assert.equal(result.generation.fixtureVersion, null);
    assert.equal(result.decision, null);
    assert.equal(result.explanation, null);
  });
}

test("AI failure preserves verified market and deterministic core without inheriting a fixture", async () => {
  const result = await runLiveDecisionPipeline(DECISION_DEMO_BASELINE, {
    fetchMarket: async () => MARKET,
    explain: async () => {
      throw new PlanGenerationError("TIMEOUT", {
        requestedModel: "test-model",
      });
    },
  });

  assert.equal(result.status, "SAFETY_PAUSE");
  assert.equal(result.market.mode, "YAHOO_LIVE");
  assert.equal(result.market.outcome, "SUCCESS");
  assert.deepEqual(result.market.snapshot?.metrics, MARKET.metrics);
  assert.ok(result.decision);
  assert.equal(result.decision?.selectedBy, "DETERMINISTIC_CORE");
  assert.equal(result.explanation, null);
  assert.deepEqual(result.generation, {
    requestedMode: "LIVE",
    mode: "LIVE",
    outcome: "FAILURE",
    failureCode: "TIMEOUT",
    fixtureId: null,
    fixtureVersion: null,
    model: "test-model",
  });
});

for (const failureCode of [
  "AUTHENTICATION",
  "MODEL_ACCESS",
  "QUOTA_OR_RATE_LIMIT",
  "NETWORK",
] as const) {
  test(`AI ${failureCode} remains distinct from market-data failure`, async () => {
    const result = await runLiveDecisionPipeline(DECISION_DEMO_BASELINE, {
      fetchMarket: async () => MARKET,
      explain: async () => {
        throw new PlanGenerationError("UPSTREAM_ERROR", {
          liveSmokeCategory: failureCode,
          requestedModel: "test-model",
        });
      },
    });

    assert.equal(result.status, "SAFETY_PAUSE");
    assert.equal(result.market.outcome, "SUCCESS");
    assert.ok(result.decision);
    assert.equal(result.explanation, null);
    assert.equal(result.generation.mode, "LIVE");
    assert.equal(result.generation.outcome, "FAILURE");
    assert.equal(result.generation.failureCode, failureCode);
    assert.equal(result.generation.fixtureId, null);
  });
}
