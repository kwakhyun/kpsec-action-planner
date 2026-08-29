import { NextResponse } from "next/server";

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
import {
  MARKET_NO_STORE_HEADERS,
  MarketSymbolSchema,
  marketFailureStatus,
} from "@/server/market/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbolResult = MarketSymbolSchema.safeParse(url.searchParams.get("symbol"));
  if (!symbolResult.success) {
    return NextResponse.json(failureEnvelope("INVALID_SYMBOL"), {
      status: 400,
      headers: MARKET_NO_STORE_HEADERS,
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
      headers: MARKET_NO_STORE_HEADERS,
    });
  } catch (error: unknown) {
    const code: MarketViewFailureCode =
      error instanceof MarketDataError
        ? error.code
        : "DATA_SCHEMA_FAILURE";

    return NextResponse.json(failureEnvelope(code), {
      status: marketFailureStatus(code),
      headers: MARKET_NO_STORE_HEADERS,
    });
  }
}
