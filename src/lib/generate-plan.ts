import "server-only";

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import {
  ActionPlanSchema,
  type ActionPlan,
  type ActionPlanInput,
} from "@/lib/contracts";
import {
  ACTION_PLAN_SYSTEM_PROMPT,
  buildActionPlanUserPrompt,
} from "@/lib/prompt";

export type GenerationFailureCode =
  | "TIMEOUT"
  | "UPSTREAM_ERROR"
  | "REFUSAL"
  | "INCOMPLETE"
  | "PARSE_ERROR"
  | "SCHEMA_ERROR"
  | "MISSING_CONFIGURATION";

export type LiveSmokeFailureCategory =
  | "MISSING_CONFIGURATION"
  | "AUTHENTICATION"
  | "MODEL_ACCESS"
  | "QUOTA_OR_RATE_LIMIT"
  | "NETWORK"
  | "TIMEOUT"
  | "REFUSAL"
  | "SCHEMA_OR_GUARDRAIL";

export class PlanGenerationError extends Error {
  readonly code: GenerationFailureCode;
  readonly liveSmokeCategory: LiveSmokeFailureCategory;
  readonly requestedModel: string | null;

  constructor(
    code: GenerationFailureCode,
    options: {
      liveSmokeCategory?: LiveSmokeFailureCategory;
      requestedModel?: string;
    } = {},
  ) {
    super(code);
    this.name = "PlanGenerationError";
    this.code = code;
    this.liveSmokeCategory =
      options.liveSmokeCategory ?? defaultLiveSmokeCategory(code);
    this.requestedModel = options.requestedModel ?? null;
  }
}

function defaultLiveSmokeCategory(
  code: GenerationFailureCode,
): LiveSmokeFailureCategory {
  switch (code) {
    case "MISSING_CONFIGURATION":
      return "MISSING_CONFIGURATION";
    case "TIMEOUT":
      return "TIMEOUT";
    case "REFUSAL":
      return "REFUSAL";
    case "INCOMPLETE":
    case "PARSE_ERROR":
    case "SCHEMA_ERROR":
      return "SCHEMA_OR_GUARDRAIL";
    case "UPSTREAM_ERROR":
      return "NETWORK";
  }
}

const REQUEST_TIMEOUT_MS = 18_000;
const MAX_OUTPUT_TOKENS = 3_200;

let clientCache:
  | {
      apiKey: string;
      client: OpenAI;
    }
  | undefined;

export function requireGenerationConfiguration(
  environment: Readonly<{
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
  }> = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
  },
): { apiKey: string; model: string } {
  const apiKey = environment.OPENAI_API_KEY?.trim();
  const model = environment.OPENAI_MODEL?.trim();

  if (!apiKey || !model) {
    throw new PlanGenerationError("MISSING_CONFIGURATION");
  }

  return { apiKey, model };
}

function getRuntimeConfiguration(): { client: OpenAI; model: string } {
  const { apiKey, model } = requireGenerationConfiguration();

  if (!clientCache || clientCache.apiKey !== apiKey) {
    clientCache = {
      apiKey,
      client: new OpenAI({
        apiKey,
        maxRetries: 0,
      }),
    };
  }

  return { client: clientCache.client, model };
}

function containsRefusal(output: unknown): boolean {
  if (!Array.isArray(output)) {
    return false;
  }

  return output.some((item) => {
    if (!item || typeof item !== "object" || !("type" in item)) {
      return false;
    }

    if (item.type !== "message" || !("content" in item)) {
      return false;
    }

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

export function normalizeRequestError(
  error: unknown,
  requestedModel?: string,
): PlanGenerationError {
  if (error instanceof PlanGenerationError) {
    return error;
  }

  if (
    error instanceof OpenAI.APIConnectionTimeoutError ||
    (error instanceof DOMException && error.name === "AbortError")
  ) {
    return new PlanGenerationError("TIMEOUT", { requestedModel });
  }

  if (error instanceof OpenAI.AuthenticationError) {
    return new PlanGenerationError("UPSTREAM_ERROR", {
      liveSmokeCategory: "AUTHENTICATION",
      requestedModel,
    });
  }

  if (
    error instanceof OpenAI.PermissionDeniedError ||
    error instanceof OpenAI.NotFoundError
  ) {
    return new PlanGenerationError("UPSTREAM_ERROR", {
      liveSmokeCategory: "MODEL_ACCESS",
      requestedModel,
    });
  }

  if (error instanceof OpenAI.RateLimitError) {
    return new PlanGenerationError("UPSTREAM_ERROR", {
      liveSmokeCategory: "QUOTA_OR_RATE_LIMIT",
      requestedModel,
    });
  }

  if (error instanceof OpenAI.APIConnectionError) {
    return new PlanGenerationError("UPSTREAM_ERROR", {
      liveSmokeCategory: "NETWORK",
      requestedModel,
    });
  }

  if (error instanceof z.ZodError) {
    return new PlanGenerationError("SCHEMA_ERROR", { requestedModel });
  }

  if (error instanceof SyntaxError) {
    return new PlanGenerationError("PARSE_ERROR", { requestedModel });
  }

  return new PlanGenerationError("UPSTREAM_ERROR", { requestedModel });
}

export function validateParsedGenerationResponse(response: {
  status: string | null | undefined;
  output: unknown;
  outputParsed: unknown;
}): ActionPlan {
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

  const parsed = ActionPlanSchema.safeParse(response.outputParsed);

  if (!parsed.success) {
    throw new PlanGenerationError("SCHEMA_ERROR");
  }

  return parsed.data;
}

export async function generateActionPlan(
  input: ActionPlanInput,
): Promise<ActionPlan> {
  const generated = await generateActionPlanWithMetadata(input);
  return generated.plan;
}

export async function generateActionPlanWithMetadata(
  input: ActionPlanInput,
): Promise<{ plan: ActionPlan; model: string }> {
  const { client, model } = getRuntimeConfiguration();

  let response;

  try {
    response = await client.responses.parse(
      {
        model,
        input: [
          {
            role: "developer",
            content: ACTION_PLAN_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: buildActionPlanUserPrompt(input),
          },
        ],
        text: {
          format: zodTextFormat(ActionPlanSchema, "action_plan"),
        },
        max_output_tokens: MAX_OUTPUT_TOKENS,
        store: false,
      },
      {
        timeout: REQUEST_TIMEOUT_MS,
      },
    );
  } catch (error: unknown) {
    throw normalizeRequestError(error, model);
  }

  try {
    return {
      plan: validateParsedGenerationResponse({
        status: response.status,
        output: response.output,
        outputParsed: response.output_parsed,
      }),
      model: response.model,
    };
  } catch (error: unknown) {
    const normalized = normalizeRequestError(error, response.model);
    throw new PlanGenerationError(normalized.code, {
      liveSmokeCategory: normalized.liveSmokeCategory,
      requestedModel: response.model,
    });
  }
}
