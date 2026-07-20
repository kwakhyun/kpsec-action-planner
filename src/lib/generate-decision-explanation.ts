import "server-only";

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import {
  AgentDecisionExplanationSchema,
  type AgentDecisionExplanation,
  type DecisionConversationInput,
} from "@/lib/decision-contracts";
import type { ExecutionCoreSuccess } from "@/lib/execution-core";
import {
  normalizeRequestError,
  PlanGenerationError,
  requireGenerationConfiguration,
} from "@/lib/generate-plan";
import type { MarketSnapshot } from "@/lib/market-data";
import {
  buildDecisionExplanationPrompt,
  DECISION_EXPLANATION_SYSTEM_PROMPT,
} from "@/lib/decision-prompt";

const REQUEST_TIMEOUT_MS = 18_000;
const MAX_OUTPUT_TOKENS = 1_400;

let clientCache:
  | {
      apiKey: string;
      client: OpenAI;
    }
  | undefined;

export class DecisionExplanationGuardError extends Error {
  readonly code = "SEMANTIC_GUARD" as const;
  readonly requestedModel: string | null;
  readonly reason:
    | "SCHEMA_INVALID"
    | "UNKNOWN_PLAN"
    | "PREFERRED_PLAN_MISMATCH"
    | "UNOWNED_NUMBER"
    | "INTERNAL_TOKEN"
    | "FORBIDDEN_CLAIM";

  constructor(
    reason:
      | "SCHEMA_INVALID"
      | "UNKNOWN_PLAN"
      | "PREFERRED_PLAN_MISMATCH"
      | "UNOWNED_NUMBER"
      | "INTERNAL_TOKEN"
      | "FORBIDDEN_CLAIM" = "SCHEMA_INVALID",
    requestedModel?: string,
  ) {
    super("SEMANTIC_GUARD");
    this.name = "DecisionExplanationGuardError";
    this.reason = reason;
    this.requestedModel = requestedModel ?? null;
  }
}

function getRuntimeConfiguration(): { client: OpenAI; model: string } {
  const { apiKey, model } = requireGenerationConfiguration();

  if (!clientCache || clientCache.apiKey !== apiKey) {
    clientCache = {
      apiKey,
      client: new OpenAI({ apiKey, maxRetries: 0 }),
    };
  }

  return { client: clientCache.client, model };
}

function containsRefusal(output: unknown): boolean {
  if (!Array.isArray(output)) return false;

  return output.some((item) => {
    if (!item || typeof item !== "object" || !("type" in item)) return false;
    if (item.type !== "message" || !("content" in item)) return false;
    return (
      Array.isArray(item.content) &&
      item.content.some(
        (content: unknown) =>
          content !== null &&
          typeof content === "object" &&
          "type" in content &&
          content.type === "refusal",
      )
    );
  });
}

function explanationText(explanation: AgentDecisionExplanation): string {
  return [
    explanation.understoodConcern,
    explanation.oneShotBenefit,
    explanation.oneShotRisk,
    explanation.stagedBenefit,
    explanation.stagedRisk,
    explanation.priorityReason,
  ].join("\n");
}

export function validateDecisionExplanation(
  candidate: unknown,
  decision: ExecutionCoreSuccess,
): AgentDecisionExplanation {
  const parsed = AgentDecisionExplanationSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new DecisionExplanationGuardError("SCHEMA_INVALID");
  }

  const text = explanationText(parsed.data);
  const planIds = new Set(decision.plans.map((plan) => plan.id));
  const hasUnownedNumber = /[0-9０-９]/.test(text);
  const hasInternalToken =
    /\b(?:BUY|SELL|ONE_SHOT|STAGED_[23]|PRICE_RISK|MISSED_OPPORTUNITY)\b/.test(
      text,
    );
  const hasForbiddenClaim =
    /(?:반드시\s*(?:오르|오를|내리|내릴|이익)|확실한\s*수익|원금\s*보장|수익(?:률)?\s*(?:예측|보장)|상승할\s*것|하락할\s*것|매수하세요|매도하세요|주문하세요)/.test(
      text,
    );

  if (!planIds.has(parsed.data.priorityPlanId)) {
    throw new DecisionExplanationGuardError("UNKNOWN_PLAN");
  }
  if (parsed.data.priorityPlanId !== decision.preferredPlanId) {
    throw new DecisionExplanationGuardError("PREFERRED_PLAN_MISMATCH");
  }
  if (hasUnownedNumber) {
    throw new DecisionExplanationGuardError("UNOWNED_NUMBER");
  }
  if (hasInternalToken) {
    throw new DecisionExplanationGuardError("INTERNAL_TOKEN");
  }
  if (hasForbiddenClaim) {
    throw new DecisionExplanationGuardError("FORBIDDEN_CLAIM");
  }

  return parsed.data;
}

export function validateParsedDecisionResponse(
  response: {
    status: string | null | undefined;
    output: unknown;
    outputParsed: unknown;
  },
  decision: ExecutionCoreSuccess,
): AgentDecisionExplanation {
  if (response.status === "incomplete") {
    throw new PlanGenerationError("INCOMPLETE");
  }
  if (response.status !== "completed") {
    throw new PlanGenerationError("UPSTREAM_ERROR");
  }
  if (containsRefusal(response.output)) {
    throw new PlanGenerationError("REFUSAL");
  }
  if (response.outputParsed === null || response.outputParsed === undefined) {
    throw new PlanGenerationError("PARSE_ERROR");
  }

  return validateDecisionExplanation(response.outputParsed, decision);
}

export async function generateDecisionExplanation(options: {
  input: DecisionConversationInput;
  market: MarketSnapshot;
  decision: ExecutionCoreSuccess;
}): Promise<{ explanation: AgentDecisionExplanation; model: string }> {
  const { client, model } = getRuntimeConfiguration();
  const payload = {
    userConcern: options.input,
    verifiedMarketAndPlans: {
      market: {
        asOf: options.market.asOf,
        latestPrice: options.market.metrics.latestPrice,
        volatility20dPct: options.market.metrics.volatility20dPct,
        range20d: options.market.metrics.range20d,
        relativeVolume20d: options.market.metrics.relativeVolume20d,
      },
      plans: options.decision.plans,
      preferredPlanId: options.decision.preferredPlanId,
      rationaleKeys: options.decision.rationaleKeys,
      signals: options.decision.signals,
    },
  };

  let response;
  try {
    response = await client.responses.parse(
      {
        model,
        input: [
          {
            role: "developer",
            content: DECISION_EXPLANATION_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: buildDecisionExplanationPrompt(payload),
          },
        ],
        text: {
          format: zodTextFormat(
            AgentDecisionExplanationSchema,
            "decision_explanation",
          ),
        },
        max_output_tokens: MAX_OUTPUT_TOKENS,
        store: false,
      },
      { timeout: REQUEST_TIMEOUT_MS },
    );
  } catch (error: unknown) {
    throw normalizeRequestError(error, model);
  }

  try {
    return {
      explanation: validateParsedDecisionResponse(
        {
          status: response.status,
          output: response.output,
          outputParsed: response.output_parsed,
        },
        options.decision,
      ),
      model: response.model,
    };
  } catch (error: unknown) {
    if (error instanceof DecisionExplanationGuardError) {
      console.warn("[decision-explanation] semantic guard rejected output", {
        reason: error.reason,
        model: response.model,
      });
      throw new DecisionExplanationGuardError(error.reason, response.model);
    }
    const normalized = normalizeRequestError(error, response.model);
    throw new PlanGenerationError(normalized.code, {
      liveSmokeCategory: normalized.liveSmokeCategory,
      requestedModel: response.model,
    });
  }
}
