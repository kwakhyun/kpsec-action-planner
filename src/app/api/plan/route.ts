import { NextResponse } from "next/server";

import {
  PlanRequestSchema,
  type ActionPlanInput,
  type FailureCode,
} from "@/lib/contracts";
import { deriveCounterfactualFromSnapshots } from "@/lib/counterfactual";
import {
  generateActionPlanWithMetadata,
  type LiveSmokeFailureCategory,
  PlanGenerationError,
  type GenerationFailureCode,
} from "@/lib/generate-plan";
import {
  finalizePlan,
  makeSafetyPause,
  precheckInput,
} from "@/lib/safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

const LIVE_MODEL_HEADER = "X-Action-Planner-Model";
const LIVE_FAILURE_CATEGORY_HEADER = "X-Action-Planner-Live-Failure";

const OFFLINE_ROUTE_REJECTION = {
  fixtureId: "ACTION_PLANNER_OFFLINE_ROUTE_REJECTED",
  fixtureVersion: "2.0.0",
} as const;

function failureStatus(code: FailureCode): number {
  if (code === "MISSING_CONFIGURATION") {
    return 503;
  }

  if (code === "TIMEOUT") {
    return 504;
  }

  return 502;
}

function generationFailure(
  code: GenerationFailureCode | "SEMANTIC_GUARD",
  input?: ActionPlanInput,
  metadata: {
    liveSmokeCategory?: LiveSmokeFailureCategory;
    model?: string | null;
  } = {},
) {
  const headers: Record<string, string> = { ...NO_STORE_HEADERS };
  if (metadata.liveSmokeCategory) {
    headers[LIVE_FAILURE_CATEGORY_HEADER] = metadata.liveSmokeCategory;
  }
  if (metadata.model && /^[A-Za-z0-9._:-]+$/.test(metadata.model)) {
    headers[LIVE_MODEL_HEADER] = metadata.model;
  }

  return NextResponse.json(
    makeSafetyPause({
      requestedMode: "LIVE",
      mode: "LIVE",
      outcome: "FAILURE",
      failureCode: code,
      message: "AI 답변을 안전하게 확인할 수 없어 새 계획을 만들지 않았습니다.",
      safetyOverride: null,
      input,
    }),
    {
      status: failureStatus(code),
      headers,
    },
  );
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      makeSafetyPause({
        requestedMode: "LIVE",
        mode: "NOT_CALLED",
        outcome: "SKIPPED",
        failureCode: "INVALID_JSON",
        message: "입력 내용을 읽지 못했습니다. 화면을 새로 고친 뒤 다시 입력해 주세요.",
        safetyOverride: null,
      }),
      {
        status: 400,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  const requestResult = PlanRequestSchema.safeParse(body);

  if (!requestResult.success) {
    return NextResponse.json(
      makeSafetyPause({
        requestedMode: "LIVE",
        mode: "NOT_CALLED",
        outcome: "SKIPPED",
        failureCode: "INVALID_INPUT",
        message: "입력 내용을 확인해 주세요. 표시된 항목을 고치면 다시 진행할 수 있습니다.",
        safetyOverride: null,
      }),
      {
        status: 400,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  const { mode, input, baselineInput } = requestResult.data;

  // OFFLINE_DEMO is a client-side, fixed-fixture path. Rejecting it here keeps
  // an explicit offline selection from ever reaching the provider network.
  if (mode === "OFFLINE_DEMO") {
    return NextResponse.json(
      makeSafetyPause({
        requestedMode: "OFFLINE_DEMO",
        mode: "NOT_CALLED",
        outcome: "SKIPPED",
        failureCode: "INVALID_INPUT",
        message: "예시 데이터 체험은 화면에 준비된 예시에서만 시작할 수 있습니다.",
        safetyOverride: "STATE_NORMALIZED",
        input,
        ...OFFLINE_ROUTE_REJECTION,
      }),
      {
        status: 400,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  if (baselineInput) {
    const comparison = deriveCounterfactualFromSnapshots(baselineInput, input);
    if (!comparison.comparable) {
      return NextResponse.json(
        makeSafetyPause({
          requestedMode: "LIVE",
          mode: "NOT_CALLED",
          outcome: "SKIPPED",
          failureCode: null,
          message: "비교하려면 조건을 한 가지만 바꿔 주세요.",
          safetyOverride: "COUNTERFACTUAL_MISMATCH",
          input,
        }),
        {
          status: 200,
          headers: NO_STORE_HEADERS,
        },
      );
    }
  }

  const preflight = precheckInput(input);

  if (preflight) {
    return NextResponse.json(
      makeSafetyPause({
        requestedMode: "LIVE",
        mode: "NOT_CALLED",
        outcome: "SKIPPED",
        failureCode: null,
        message: preflight.message,
        safetyOverride: preflight.safetyOverride,
        input,
      }),
      {
        status: 200,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  let generated;

  try {
    generated = await generateActionPlanWithMetadata(input);
  } catch (error: unknown) {
    if (error instanceof PlanGenerationError) {
      return generationFailure(error.code, input, {
        liveSmokeCategory: error.liveSmokeCategory,
        model: error.requestedModel,
      });
    }

    return generationFailure("UPSTREAM_ERROR", input, {
      liveSmokeCategory: "NETWORK",
    });
  }

  let envelope;

  try {
    envelope = finalizePlan(input, generated.plan, { baselineInput });
  } catch {
    return generationFailure("SEMANTIC_GUARD", input, {
      liveSmokeCategory: "SCHEMA_OR_GUARDRAIL",
      model: generated.model,
    });
  }

  return NextResponse.json(envelope, {
    status: envelope.generation.outcome === "FAILURE" ? 502 : 200,
    headers: {
      ...NO_STORE_HEADERS,
      [LIVE_MODEL_HEADER]: generated.model,
      ...(envelope.generation.outcome === "FAILURE"
        ? { [LIVE_FAILURE_CATEGORY_HEADER]: "SCHEMA_OR_GUARDRAIL" }
        : {}),
    },
  });
}
