import "server-only";

import OpenAI from "openai";
import { z } from "zod";

export type AiGenerationFailureCode =
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

export class OpenAiGenerationError extends Error {
  readonly code: AiGenerationFailureCode;
  readonly liveSmokeCategory: LiveSmokeFailureCategory;
  readonly requestedModel: string | null;

  constructor(
    code: AiGenerationFailureCode,
    options: {
      liveSmokeCategory?: LiveSmokeFailureCategory;
      requestedModel?: string;
    } = {},
  ) {
    super(code);
    this.name = "OpenAiGenerationError";
    this.code = code;
    this.liveSmokeCategory =
      options.liveSmokeCategory ?? defaultLiveSmokeCategory(code);
    this.requestedModel = options.requestedModel ?? null;
  }
}

function defaultLiveSmokeCategory(
  code: AiGenerationFailureCode,
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
    throw new OpenAiGenerationError("MISSING_CONFIGURATION");
  }

  return { apiKey, model };
}

export function normalizeOpenAiRequestError(
  error: unknown,
  requestedModel?: string,
): OpenAiGenerationError {
  if (error instanceof OpenAiGenerationError) return error;

  if (
    error instanceof OpenAI.APIConnectionTimeoutError ||
    (error instanceof DOMException && error.name === "AbortError")
  ) {
    return new OpenAiGenerationError("TIMEOUT", { requestedModel });
  }

  if (error instanceof OpenAI.AuthenticationError) {
    return new OpenAiGenerationError("UPSTREAM_ERROR", {
      liveSmokeCategory: "AUTHENTICATION",
      requestedModel,
    });
  }

  if (
    error instanceof OpenAI.PermissionDeniedError ||
    error instanceof OpenAI.NotFoundError
  ) {
    return new OpenAiGenerationError("UPSTREAM_ERROR", {
      liveSmokeCategory: "MODEL_ACCESS",
      requestedModel,
    });
  }

  if (error instanceof OpenAI.RateLimitError) {
    return new OpenAiGenerationError("UPSTREAM_ERROR", {
      liveSmokeCategory: "QUOTA_OR_RATE_LIMIT",
      requestedModel,
    });
  }

  if (error instanceof OpenAI.APIConnectionError) {
    return new OpenAiGenerationError("UPSTREAM_ERROR", {
      liveSmokeCategory: "NETWORK",
      requestedModel,
    });
  }

  if (error instanceof z.ZodError) {
    return new OpenAiGenerationError("SCHEMA_ERROR", { requestedModel });
  }

  if (error instanceof SyntaxError) {
    return new OpenAiGenerationError("PARSE_ERROR", { requestedModel });
  }

  return new OpenAiGenerationError("UPSTREAM_ERROR", { requestedModel });
}
