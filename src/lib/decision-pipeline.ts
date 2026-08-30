import "server-only";

import {
  DecisionConversationInputSchema,
  DecisionEnvelopeSchema,
  type AgentDecisionExplanation,
  type DecisionConversationInput,
  type DecisionEnvelope,
  type DecisionFailureCode,
  type DecisionMarketSnapshot,
} from "@/lib/decision-contracts";
import {
  computeExecutionDecision,
  type ExecutionCoreSuccess,
} from "@/lib/execution-core";
import {
  DecisionExplanationGuardError,
  generateDecisionExplanation,
} from "@/lib/generate-decision-explanation";
import {
  fetchMarketSnapshot,
  MarketDataError,
  type MarketSnapshot,
} from "@/lib/market-data";
import { OpenAiGenerationError } from "@/lib/openai-generation-error";

type PipelineDependencies = {
  fetchMarket: (symbol: string) => Promise<MarketSnapshot>;
  explain: (options: {
    input: DecisionConversationInput;
    market: MarketSnapshot;
    decision: ExecutionCoreSuccess;
  }) => Promise<{ explanation: AgentDecisionExplanation; model: string }>;
};

const DEFAULT_DEPENDENCIES: PipelineDependencies = {
  fetchMarket: fetchMarketSnapshot,
  explain: generateDecisionExplanation,
};

function publicMarketSnapshot(market: MarketSnapshot): DecisionMarketSnapshot {
  return {
    symbol: market.symbol,
    provider: market.provider,
    sourceUrl: market.sourceUrl,
    fetchedAt: market.fetchedAt,
    asOf: market.asOf,
    range: market.range,
    interval: market.interval,
    delayNotice: market.delayNotice,
    synthetic: market.synthetic,
    currency: market.currency,
    exchange: market.exchange,
    metrics: market.metrics,
  };
}

function pausedEnvelope(options: {
  input: DecisionConversationInput | null;
  market: DecisionEnvelope["market"];
  decision?: ExecutionCoreSuccess | null;
  mode: "LIVE" | "NOT_CALLED";
  outcome: "FAILURE" | "SKIPPED";
  failureCode: DecisionFailureCode;
  failureMessage: string;
  model?: string | null;
}): DecisionEnvelope {
  return DecisionEnvelopeSchema.parse({
    status: "SAFETY_PAUSE",
    generation: {
      requestedMode: "LIVE",
      mode: options.mode,
      outcome: options.outcome,
      failureCode: options.failureCode,
      fixtureId: null,
      fixtureVersion: null,
      model: options.model ?? null,
    },
    market: options.market,
    inputSnapshot: options.input,
    decision: options.decision ?? null,
    explanation: null,
    failureMessage: options.failureMessage,
  });
}

function marketFailureMessage(code: MarketDataError["code"]): string {
  switch (code) {
    case "DATA_PROVIDER_FAILURE":
      return "Yahoo Finance에서 시장 데이터를 가져오지 못해 실행안을 만들지 않았습니다.";
    case "DATA_SCHEMA_FAILURE":
      return "시장 데이터 형식을 안전하게 확인하지 못해 실행안을 만들지 않았습니다.";
    case "DATA_INSUFFICIENT":
      return "최근 지표를 계산할 만큼 거래일 데이터가 충분하지 않습니다.";
    case "DATA_STALE":
      return "시장 데이터가 오래되어 현재 실행안에 사용하지 않았습니다.";
  }
}

function aiFailureMessage(code: DecisionFailureCode): string {
  switch (code) {
    case "MISSING_CONFIGURATION":
      return "AI 설명 기능이 준비되지 않아 쉬운 설명을 만들지 못했습니다. 계산된 비교안은 그대로 볼 수 있어요.";
    case "TIMEOUT":
      return "AI 응답이 늦어 쉬운 설명을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.";
    case "AUTHENTICATION":
      return "AI 연결을 확인하지 못해 쉬운 설명을 만들지 못했습니다. 계산된 비교안은 바뀌지 않았어요.";
    case "MODEL_ACCESS":
      return "현재 AI를 사용할 수 없어 쉬운 설명을 만들지 못했습니다. 계산된 비교안은 바뀌지 않았어요.";
    case "QUOTA_OR_RATE_LIMIT":
      return "AI가 잠시 혼잡해 쉬운 설명을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.";
    case "NETWORK":
      return "AI에 연결하지 못해 쉬운 설명을 만들지 못했습니다. 인터넷 연결을 확인해 주세요.";
    case "REFUSAL":
      return "AI가 이 요청을 설명하지 못했습니다. 계산된 비교안은 바뀌지 않았어요.";
    case "INCOMPLETE":
      return "AI 설명이 끝까지 완성되지 않았습니다. 계산된 비교안은 바뀌지 않았어요.";
    case "PARSE_ERROR":
    case "SCHEMA_ERROR":
    case "SEMANTIC_GUARD":
      return "AI 설명을 확인할 수 없어 표시하지 않았습니다. 계산된 비교안은 그대로예요.";
    default:
      return "AI가 쉬운 설명을 만들지 못했습니다. 계산된 비교안은 바뀌지 않았어요.";
  }
}

function classifiedAiFailureCode(error: unknown): DecisionFailureCode {
  if (error instanceof DecisionExplanationGuardError) return "SEMANTIC_GUARD";
  if (!(error instanceof OpenAiGenerationError)) return "UPSTREAM_ERROR";
  if (error.code !== "UPSTREAM_ERROR") return error.code;

  switch (error.liveSmokeCategory) {
    case "AUTHENTICATION":
    case "MODEL_ACCESS":
    case "QUOTA_OR_RATE_LIMIT":
    case "NETWORK":
      return error.liveSmokeCategory;
    default:
      return "UPSTREAM_ERROR";
  }
}

function toExecutionInput(input: DecisionConversationInput, market: MarketSnapshot) {
  if (market.currency !== "KRW" || market.metrics.relativeVolume20d === null) {
    return null;
  }

  const latestClose = Math.round(market.metrics.latestPrice);
  const rangeLow = Math.round(market.metrics.range20d.low);
  const rangeHigh = Math.round(market.metrics.range20d.high);
  const shared = {
    deadline: input.deadline,
    primaryRegret:
      input.regretPriority === "PRICE_RISK"
        ? ("PRICE_MOVE" as const)
        : ("MISSED_OPPORTUNITY" as const),
    maxLossPercent: input.maxAdverseMovePct,
    maxMovePercent: input.maxAdverseMovePct,
    lotSize: 1,
    market: {
      latestClose,
      volatility20dPct: market.metrics.volatility20dPct,
      rangeLow,
      rangeHigh,
      relativeVolume: market.metrics.relativeVolume20d,
      freshness: {
        status: "FRESH" as const,
        asOf: market.asOf,
        checkedAt: market.fetchedAt,
        maxAgeMinutes: 10_080,
      },
    },
  };

  return input.intent === "BUY"
    ? {
        direction: "BUY" as const,
        budgetKrw: input.budgetKrw ?? 0,
        ...shared,
      }
    : {
        direction: "SELL" as const,
        holdingQuantity: input.holdingQuantity ?? 0,
        ...shared,
      };
}

export async function runLiveDecisionPipeline(
  rawInput: unknown,
  dependencies: PipelineDependencies = DEFAULT_DEPENDENCIES,
): Promise<DecisionEnvelope> {
  const parsedInput = DecisionConversationInputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    return pausedEnvelope({
      input: null,
      market: {
        mode: "NOT_CALLED",
        outcome: "SKIPPED",
        failureCode: null,
        snapshot: null,
      },
      mode: "NOT_CALLED",
      outcome: "SKIPPED",
      failureCode: "INVALID_INPUT",
      failureMessage:
        "입력 내용을 확인해 주세요. 네 가지 질문을 모두 답하면 다시 진행할 수 있습니다.",
    });
  }
  const input = parsedInput.data;

  let market: MarketSnapshot;
  try {
    market = await dependencies.fetchMarket(input.symbol);
  } catch (error: unknown) {
    const code =
      error instanceof MarketDataError
        ? error.code
        : ("DATA_PROVIDER_FAILURE" as const);
    return pausedEnvelope({
      input,
      market: {
        mode: "YAHOO_LIVE",
        outcome: "FAILURE",
        failureCode: code,
        snapshot: null,
      },
      mode: "NOT_CALLED",
      outcome: "SKIPPED",
      failureCode: code,
      failureMessage: marketFailureMessage(code),
    });
  }

  const marketLayer: DecisionEnvelope["market"] = {
    mode: "YAHOO_LIVE",
    outcome: "SUCCESS",
    failureCode: null,
    snapshot: publicMarketSnapshot(market),
  };
  const executionInput = toExecutionInput(input, market);
  const core = executionInput ? computeExecutionDecision(executionInput) : null;

  if (!core?.ok) {
    return pausedEnvelope({
      input,
      market: marketLayer,
      mode: "NOT_CALLED",
      outcome: "SKIPPED",
      failureCode: "CORE_DECISION_FAILURE",
      failureMessage:
        market.currency !== "KRW"
          ? "현재 수직 흐름은 원화로 거래되는 국내 주식만 계산할 수 있습니다."
          : core?.reasons[0]?.message ??
            "일괄안과 분할안을 안전하게 계산하지 못했습니다.",
    });
  }

  try {
    const generated = await dependencies.explain({ input, market, decision: core });
    return DecisionEnvelopeSchema.parse({
      status: "READY_FOR_REVIEW",
      generation: {
        requestedMode: "LIVE",
        mode: "LIVE",
        outcome: "SUCCESS",
        failureCode: null,
        fixtureId: null,
        fixtureVersion: null,
        model: generated.model,
      },
      market: marketLayer,
      inputSnapshot: input,
      decision: core,
      explanation: generated.explanation,
      failureMessage: null,
    });
  } catch (error: unknown) {
    const code = classifiedAiFailureCode(error);
    const requestedModel =
      error instanceof DecisionExplanationGuardError ||
      error instanceof OpenAiGenerationError
        ? error.requestedModel
        : null;

    return pausedEnvelope({
      input,
      market: marketLayer,
      decision: core,
      mode: "LIVE",
      outcome: "FAILURE",
      failureCode: code,
      failureMessage: aiFailureMessage(code),
      model: requestedModel,
    });
  }
}
