import { NextResponse } from "next/server";

import {
  DecisionRequestSchema,
  type DecisionEnvelope,
  type DecisionFailureCode,
} from "@/lib/decision-contracts";
import { runLiveDecisionPipeline } from "@/lib/decision-pipeline";
import { readPublicApiJson } from "@/server/public-api-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

function responseStatus(envelope: DecisionEnvelope): number {
  if (envelope.status === "READY_FOR_REVIEW") return 200;

  const code = envelope.generation.failureCode;
  if (code === "INVALID_INPUT") return 400;
  if (code === "AUTHENTICATION") return 401;
  if (code === "MODEL_ACCESS") return 403;
  if (code === "QUOTA_OR_RATE_LIMIT") return 429;
  if (code === "TIMEOUT") return 504;
  if (code === "MISSING_CONFIGURATION") return 503;
  if (code === "DATA_STALE" || code === "DATA_INSUFFICIENT") return 503;
  return 502;
}

function safeModelHeader(model: string | null): Record<string, string> {
  return model && /^[A-Za-z0-9._:-]+$/.test(model)
    ? { "X-Decision-Companion-Model": model }
    : {};
}

export async function POST(request: Request) {
  const requestBody = await readPublicApiJson(request);
  if (!requestBody.ok) return requestBody.response;

  const requestResult = DecisionRequestSchema.safeParse(requestBody.body);
  const envelope = await runLiveDecisionPipeline(
    requestResult.success ? requestResult.data.input : null,
  );
  const failureCode = envelope.generation.failureCode as DecisionFailureCode | null;

  return NextResponse.json(envelope, {
    status: responseStatus(envelope),
    headers: {
      ...NO_STORE_HEADERS,
      ...safeModelHeader(envelope.generation.model),
      ...(failureCode
        ? { "X-Decision-Companion-Failure": failureCode }
        : {}),
    },
  });
}
