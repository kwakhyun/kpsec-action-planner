import "server-only";

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import {
  AdversarialReviewRequestSchema,
  AdversarialReviewResultSchema,
  type AdversarialFailureCode,
  type AdversarialReviewRequest,
  type AdversarialReviewResult,
} from "@/lib/adversarial-review-contracts";
import {
  ADVERSARIAL_REVIEW_SYSTEM_PROMPT,
  buildAdversarialReviewPrompt,
} from "@/lib/adversarial-review-prompt";

const REQUEST_TIMEOUT_MS = 18_000;
const MAX_OUTPUT_TOKENS = 1_100;

let clientCache:
  | {
      apiKey: string;
      client: OpenAI;
    }
  | undefined;

export class AdversarialReviewGenerationError extends Error {
  readonly code: AdversarialFailureCode;
  readonly requestedModel: string | null;

  constructor(code: AdversarialFailureCode, requestedModel?: string | null) {
    super(code);
    this.name = "AdversarialReviewGenerationError";
    this.code = code;
    this.requestedModel = requestedModel ?? null;
  }
}

function getRuntimeConfiguration(): { client: OpenAI; model: string } {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim();
  if (!apiKey || !model) {
    throw new AdversarialReviewGenerationError("MISSING_CONFIGURATION");
  }

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

export function normalizeAdversarialError(
  error: unknown,
  requestedModel?: string | null,
): AdversarialReviewGenerationError {
  if (error instanceof AdversarialReviewGenerationError) return error;
  if (
    error instanceof OpenAI.APIConnectionTimeoutError ||
    (error instanceof DOMException && error.name === "AbortError")
  ) {
    return new AdversarialReviewGenerationError("TIMEOUT", requestedModel);
  }
  if (error instanceof OpenAI.AuthenticationError) {
    return new AdversarialReviewGenerationError("AUTHENTICATION", requestedModel);
  }
  if (
    error instanceof OpenAI.PermissionDeniedError ||
    error instanceof OpenAI.NotFoundError
  ) {
    return new AdversarialReviewGenerationError("MODEL_ACCESS", requestedModel);
  }
  if (error instanceof OpenAI.RateLimitError) {
    return new AdversarialReviewGenerationError(
      "QUOTA_OR_RATE_LIMIT",
      requestedModel,
    );
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new AdversarialReviewGenerationError("NETWORK", requestedModel);
  }
  if (error instanceof z.ZodError) {
    return new AdversarialReviewGenerationError("SCHEMA_ERROR", requestedModel);
  }
  if (error instanceof SyntaxError) {
    return new AdversarialReviewGenerationError("PARSE_ERROR", requestedModel);
  }
  return new AdversarialReviewGenerationError("UPSTREAM_ERROR", requestedModel);
}

function allProse(result: AdversarialReviewResult): string[] {
  return [
    ...result.counterarguments.map((item) => item.argument),
    result.unverifiedAssumption,
    result.question,
    result.whatWouldChangePlan,
  ];
}

function hasUnsafeProse(text: string): boolean {
  const hasNumericOrDatedClaim = /[0-9０-９]|%|％/.test(text);
  const hasInternalToken =
    /\b(?:BUY|SELL|ONE_SHOT|STAGED_[23]|PRICE_RISK|MISSED_OPPORTUNITY|CONFIRM_[A-Z_]+)\b/.test(
      text,
    );
  const hasPredictionOrDirection =
    /(?:상승\s*신호|하락\s*신호|매수\s*적기|매도\s*적기|곧\s*(?:오르|내리|반등)|반드시\s*(?:오르|내리|이익)|확실한\s*수익|원금\s*보장|수익(?:률)?\s*(?:예측|보장)|매수하세요|매도하세요|주문하세요|사세요|파세요)/.test(
      text,
    );

  return hasNumericOrDatedClaim || hasInternalToken || hasPredictionOrDirection;
}

export function validateAdversarialReview(
  candidate: unknown,
  request: AdversarialReviewRequest,
): AdversarialReviewResult {
  const parsed = AdversarialReviewResultSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new AdversarialReviewGenerationError("SCHEMA_ERROR");
  }

  const suppliedFactIds = new Set(request.facts.map((fact) => fact.id));
  const allowedQuestionKeys = new Set(request.allowedQuestionKeys);
  const hasOrphanOrDuplicateReference = parsed.data.counterarguments.some(
    (item) =>
      new Set(item.factIds).size !== item.factIds.length ||
      item.factIds.some((factId) => !suppliedFactIds.has(factId)),
  );

  if (
    hasOrphanOrDuplicateReference ||
    !allowedQuestionKeys.has(parsed.data.questionKey) ||
    allProse(parsed.data).some(hasUnsafeProse)
  ) {
    throw new AdversarialReviewGenerationError("SEMANTIC_GUARD");
  }

  return parsed.data;
}

export function validateParsedAdversarialResponse(
  response: {
    status: string | null | undefined;
    output: unknown;
    outputParsed: unknown;
  },
  request: AdversarialReviewRequest,
): AdversarialReviewResult {
  if (response.status === "incomplete") {
    throw new AdversarialReviewGenerationError("INCOMPLETE");
  }
  if (response.status !== "completed") {
    throw new AdversarialReviewGenerationError("UPSTREAM_ERROR");
  }
  if (containsRefusal(response.output)) {
    throw new AdversarialReviewGenerationError("REFUSAL");
  }
  if (response.outputParsed === null || response.outputParsed === undefined) {
    throw new AdversarialReviewGenerationError("PARSE_ERROR");
  }

  return validateAdversarialReview(response.outputParsed, request);
}

export async function generateAdversarialReview(
  rawRequest: AdversarialReviewRequest,
): Promise<{ result: AdversarialReviewResult; model: string }> {
  const requestResult = AdversarialReviewRequestSchema.safeParse(rawRequest);
  if (!requestResult.success) {
    throw new AdversarialReviewGenerationError("INVALID_INPUT");
  }
  const request = requestResult.data;
  const { client, model } = getRuntimeConfiguration();

  let response;
  try {
    response = await client.responses.parse(
      {
        model,
        input: [
          {
            role: "developer",
            content: ADVERSARIAL_REVIEW_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: buildAdversarialReviewPrompt(request),
          },
        ],
        text: {
          format: zodTextFormat(
            AdversarialReviewResultSchema,
            "adversarial_plan_review",
          ),
        },
        max_output_tokens: MAX_OUTPUT_TOKENS,
        store: false,
      },
      { timeout: REQUEST_TIMEOUT_MS },
    );
  } catch (error: unknown) {
    throw normalizeAdversarialError(error, model);
  }

  try {
    return {
      result: validateParsedAdversarialResponse(
        {
          status: response.status,
          output: response.output,
          outputParsed: response.output_parsed,
        },
        request,
      ),
      model: response.model,
    };
  } catch (error: unknown) {
    const normalized = normalizeAdversarialError(error, response.model);
    throw new AdversarialReviewGenerationError(
      normalized.code,
      response.model,
    );
  }
}
