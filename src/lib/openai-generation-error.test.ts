import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeOpenAiRequestError,
  OpenAiGenerationError,
  requireGenerationConfiguration,
} from "./openai-generation-error";

test("OpenAI server configuration is required and trimmed", () => {
  assert.deepEqual(
    requireGenerationConfiguration({
      OPENAI_API_KEY: "  test-key  ",
      OPENAI_MODEL: "  test-model  ",
    }),
    { apiKey: "test-key", model: "test-model" },
  );

  assert.throws(
    () => requireGenerationConfiguration({ OPENAI_API_KEY: "" }),
    (error: unknown) =>
      error instanceof OpenAiGenerationError &&
      error.code === "MISSING_CONFIGURATION",
  );
});

test("known parse and timeout failures keep safe public categories", () => {
  const parseError = normalizeOpenAiRequestError(
    new SyntaxError("private provider response"),
    "test-model",
  );
  assert.equal(parseError.code, "PARSE_ERROR");
  assert.equal(parseError.liveSmokeCategory, "SCHEMA_OR_GUARDRAIL");
  assert.equal(parseError.requestedModel, "test-model");

  const timeout = normalizeOpenAiRequestError(
    new DOMException("aborted", "AbortError"),
  );
  assert.equal(timeout.code, "TIMEOUT");
  assert.equal(timeout.liveSmokeCategory, "TIMEOUT");
});
