import { NextResponse } from "next/server";

import {
  IntradayMarketEnvelopeSchema,
  type IntradayFailureCode,
  type IntradayMarketEnvelope,
} from "@/lib/intraday-market";
import {
  fetchBestIntraday,
  IntradayDataError,
} from "@/server/market/intraday-market-provider";
import {
  MARKET_NO_STORE_HEADERS,
  MarketSymbolSchema,
  marketFailureStatus,
} from "@/server/market/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function friendlyFailure(code: IntradayFailureCode): string {
  switch (code) {
    case "INVALID_SYMBOL":
      return "종목 코드를 확인해 주세요. 예: 삼성전자는 005930.KS입니다.";
    case "DATA_PROVIDER_FAILURE":
      return "공개 시세 제공처에 연결하지 못해 분 단위 차트를 표시하지 않았습니다.";
    case "DATA_SCHEMA_FAILURE":
      return "받은 장중 데이터를 안전하게 확인할 수 없어 분 단위 차트를 표시하지 않았습니다.";
    case "DATA_INSUFFICIENT":
      return "1분·5분 데이터가 모두 부족해 분 단위 차트를 사용할 수 없습니다.";
    case "DATA_STALE":
      return "장중 데이터가 오래되어 분 단위 차트로 표시하지 않았습니다.";
  }
}

function failureEnvelope(code: IntradayFailureCode): IntradayMarketEnvelope {
  return IntradayMarketEnvelopeSchema.parse({
    status: "FAILURE",
    data: null,
    error: { code, message: friendlyFailure(code) },
  });
}

export async function GET(request: Request) {
  const symbol = MarketSymbolSchema.safeParse(
    new URL(request.url).searchParams.get("symbol"),
  );
  if (!symbol.success) {
    return NextResponse.json(failureEnvelope("INVALID_SYMBOL"), {
      status: 400,
      headers: MARKET_NO_STORE_HEADERS,
    });
  }

  try {
    const data = await fetchBestIntraday(symbol.data);
    return NextResponse.json(
      IntradayMarketEnvelopeSchema.parse({
        status: "SUCCESS",
        data,
        error: null,
      }),
      { status: 200, headers: MARKET_NO_STORE_HEADERS },
    );
  } catch (error: unknown) {
    const code: IntradayFailureCode =
      error instanceof IntradayDataError
        ? error.code
        : "DATA_SCHEMA_FAILURE";
    return NextResponse.json(failureEnvelope(code), {
      status: marketFailureStatus(code),
      headers: MARKET_NO_STORE_HEADERS,
    });
  }
}
