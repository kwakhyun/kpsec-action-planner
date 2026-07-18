import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createMarketView,
  MarketViewEnvelopeSchema,
  type MarketViewEnvelope,
  type MarketViewFailureCode,
} from "@/lib/market-view";
import {
  fetchMarketSnapshot,
  MarketDataError,
} from "@/lib/market-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

const SymbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(24)
  .regex(/^[A-Z0-9.^=-]+$/);

function friendlyFailure(code: MarketViewFailureCode): string {
  switch (code) {
    case "INVALID_SYMBOL":
      return "종목 코드를 확인해 주세요. 예: 삼성전자는 005930.KS입니다.";
    case "DATA_PROVIDER_FAILURE":
      return "공개 시세 제공처에 연결하지 못했습니다. 잠시 후 다시 확인해 주세요.";
    case "DATA_SCHEMA_FAILURE":
      return "받은 시장 데이터를 안전하게 확인할 수 없어 표시하지 않았습니다.";
    case "DATA_INSUFFICIENT":
      return "차트와 지표를 만들 만큼 최근 거래일 데이터가 충분하지 않습니다.";
    case "DATA_STALE":
      return "최근 시장 데이터가 오래되어 현재 정보로 표시하지 않았습니다.";
  }
}

function failureEnvelope(code: MarketViewFailureCode): MarketViewEnvelope {
  return MarketViewEnvelopeSchema.parse({
    status: "FAILURE",
    data: null,
    error: {
      code,
      message: friendlyFailure(code),
    },
  });
}

function failureStatus(code: MarketViewFailureCode): number {
  if (code === "INVALID_SYMBOL") return 400;
  if (code === "DATA_INSUFFICIENT") return 422;
  if (code === "DATA_STALE") return 503;
  return 502;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbolResult = SymbolSchema.safeParse(url.searchParams.get("symbol"));
  if (!symbolResult.success) {
    return NextResponse.json(failureEnvelope("INVALID_SYMBOL"), {
      status: 400,
      headers: NO_STORE_HEADERS,
    });
  }

  try {
    const snapshot = await fetchMarketSnapshot(symbolResult.data);
    const envelope = MarketViewEnvelopeSchema.parse({
      status: "SUCCESS",
      data: createMarketView(snapshot),
      error: null,
    });

    return NextResponse.json(envelope, {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (error: unknown) {
    const code: MarketViewFailureCode =
      error instanceof MarketDataError
        ? error.code
        : "DATA_SCHEMA_FAILURE";

    return NextResponse.json(failureEnvelope(code), {
      status: failureStatus(code),
      headers: NO_STORE_HEADERS,
    });
  }
}
