import assert from "node:assert/strict";
import test from "node:test";

import { readPublicApiJson } from "./public-api-request";

const endpoint = "https://action-planner.example/api/decision";

function jsonRequest(body: string, headers: HeadersInit = {}): Request {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://action-planner.example",
      ...headers,
    },
    body,
  });
}

test("same-origin JSON request is accepted", async () => {
  const result = await readPublicApiJson(jsonRequest('{"mode":"LIVE"}'));
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.body, { mode: "LIVE" });
});

test("cross-site browser request is rejected before parsing", async () => {
  const result = await readPublicApiJson(
    jsonRequest("{}", {
      Origin: "https://malicious.example",
      "Sec-Fetch-Site": "cross-site",
    }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.response.status, 403);
});

test("non-JSON and malformed requests are rejected", async () => {
  const wrongType = await readPublicApiJson(
    new Request(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "{}",
    }),
  );
  assert.equal(wrongType.ok, false);
  if (!wrongType.ok) assert.equal(wrongType.response.status, 415);

  const malformed = await readPublicApiJson(jsonRequest("{"));
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.response.status, 400);
});

test("oversized JSON is rejected even without a content-length header", async () => {
  const result = await readPublicApiJson(
    jsonRequest(JSON.stringify({ value: "x".repeat(33 * 1024) })),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.response.status, 413);
});
