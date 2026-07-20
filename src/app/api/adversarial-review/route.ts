import { NextResponse } from "next/server";

import {
  AdversarialReviewEnvelopeSchema,
  AdversarialReviewRequestSchema,
  type AdversarialFailureCode,
  type AdversarialReviewEnvelope,
  type AdversarialReviewRequest,
} from "@/lib/adversarial-review-contracts";
import {
  AdversarialReviewGenerationError,
  generateAdversarialReview,
} from "@/lib/generate-adversarial-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

function failureMessage(code: AdversarialFailureCode): string {
  switch (code) {
    case "INVALID_INPUT":
      return "반대 의견을 검토할 입력을 안전하게 확인하지 못했습니다.";
    case "MISSING_CONFIGURATION":
      return "AI 분석 설정을 확인할 수 없어 반대 의견을 만들지 않았습니다.";
    case "AUTHENTICATION":
      return "AI 연결 권한을 확인하지 못해 반대 의견을 만들지 않았습니다.";
    case "MODEL_ACCESS":
      return "설정된 AI 모델을 사용할 수 없어 반대 의견을 만들지 않았습니다.";
    case "QUOTA_OR_RATE_LIMIT":
      return "AI 사용 한도 또는 일시적인 혼잡으로 반대 의견을 만들지 않았습니다.";
    case "NETWORK":
      return "외부 AI 네트워크에 연결하지 못해 반대 의견을 만들지 않았습니다.";
    case "TIMEOUT":
      return "AI 응답이 늦어 새 반대 의견을 만들지 않았습니다.";
    case "REFUSAL":
      return "AI가 요청에 답하지 않아 새 반대 의견을 만들지 않았습니다.";
    case "INCOMPLETE":
      return "AI 답변이 끝까지 완성되지 않아 사용하지 않았습니다.";
    case "PARSE_ERROR":
    case "SCHEMA_ERROR":
    case "SEMANTIC_GUARD":
      return "AI 답변을 안전하게 확인하지 못해 새 반대 의견을 사용하지 않았습니다.";
    default:
      return "외부 AI 응답을 확인하지 못해 새 반대 의견을 만들지 않았습니다.";
  }
}

function pausedEnvelope(options: {
  request: AdversarialReviewRequest | null;
  code: AdversarialFailureCode;
  model?: string | null;
}): AdversarialReviewEnvelope {
  return AdversarialReviewEnvelopeSchema.parse({
    status: "SAFETY_PAUSE",
    generation: {
      requestedMode: "LIVE",
      mode: options.code === "INVALID_INPUT" ? "NOT_CALLED" : "LIVE",
      outcome: options.code === "INVALID_INPUT" ? "SKIPPED" : "FAILURE",
      failureCode: options.code,
      model: options.model ?? null,
    },
    inputSnapshot: options.request,
    result: null,
    failureMessage: failureMessage(options.code),
  });
}

function responseStatus(envelope: AdversarialReviewEnvelope): number {
  if (envelope.status === "READY_FOR_REVIEW") return 200;
  switch (envelope.generation.failureCode) {
    case "INVALID_INPUT":
      return 400;
    case "AUTHENTICATION":
      return 401;
    case "MODEL_ACCESS":
      return 403;
    case "QUOTA_OR_RATE_LIMIT":
      return 429;
    case "TIMEOUT":
      return 504;
    case "MISSING_CONFIGURATION":
      return 503;
    default:
      return 502;
  }
}

function safeModelHeader(model: string | null): Record<string, string> {
  return model && /^[A-Za-z0-9._:-]+$/.test(model)
    ? { "X-Adversarial-Review-Model": model }
    : {};
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const parsed = AdversarialReviewRequestSchema.safeParse(body);
  if (!parsed.success) {
    const envelope = pausedEnvelope({ request: null, code: "INVALID_INPUT" });
    return NextResponse.json(envelope, {
      status: 400,
      headers: NO_STORE_HEADERS,
    });
  }

  let envelope: AdversarialReviewEnvelope;
  try {
    const generated = await generateAdversarialReview(parsed.data);
    envelope = AdversarialReviewEnvelopeSchema.parse({
      status: "READY_FOR_REVIEW",
      generation: {
        requestedMode: "LIVE",
        mode: "LIVE",
        outcome: "SUCCESS",
        failureCode: null,
        model: generated.model,
      },
      inputSnapshot: parsed.data,
      result: generated.result,
      failureMessage: null,
    });
  } catch (error: unknown) {
    const normalized =
      error instanceof AdversarialReviewGenerationError
        ? error
        : new AdversarialReviewGenerationError("UPSTREAM_ERROR");
    console.warn("[adversarial-review] generation failed", {
      failureCode: normalized.code,
      model: normalized.requestedModel,
    });
    envelope = pausedEnvelope({
      request: parsed.data,
      code: normalized.code,
      model: normalized.requestedModel,
    });
  }

  return NextResponse.json(envelope, {
    status: responseStatus(envelope),
    headers: {
      ...NO_STORE_HEADERS,
      ...safeModelHeader(envelope.generation.model),
    },
  });
}
