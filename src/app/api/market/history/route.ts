import { NextResponse } from "next/server";

import {
  ChartHistoryEnvelopeSchema,
  type ChartHistoryFailureCode,
} from "@/lib/chart-history";
import {
  fetchHistory,
  HistoryDataError,
} from "@/server/market/chart-history-provider";
import {
  MARKET_NO_STORE_HEADERS,
  MarketSymbolSchema,
  marketFailureStatus,
} from "@/server/market/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failureMessage(code: ChartHistoryFailureCode): string {
  switch (code) {
    case "INVALID_SYMBOL":
      return "종목 코드를 확인해 주세요.";
    case "DATA_PROVIDER_FAILURE":
      return "장기 공개 데이터 제공처에 연결하지 못했습니다.";
    case "DATA_SCHEMA_FAILURE":
      return "장기 공개 데이터를 안전하게 확인할 수 없습니다.";
    case "DATA_INSUFFICIENT":
      return "주·월·년 단위로 묶을 장기 공개 데이터가 충분하지 않습니다.";
    case "DATA_STALE":
      return "장기 공개 데이터가 오래되어 표시하지 않았습니다.";
  }
}

function failureEnvelope(code: ChartHistoryFailureCode) {
  return ChartHistoryEnvelopeSchema.parse({
    status: "FAILURE",
    data: null,
    error: { code, message: failureMessage(code) },
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
    const data = await fetchHistory(symbol.data);
    return NextResponse.json(
      ChartHistoryEnvelopeSchema.parse({
        status: "SUCCESS",
        data,
        error: null,
      }),
      { status: 200, headers: MARKET_NO_STORE_HEADERS },
    );
  } catch (error: unknown) {
    const code: ChartHistoryFailureCode =
      error instanceof HistoryDataError
        ? error.code
        : "DATA_SCHEMA_FAILURE";
    return NextResponse.json(failureEnvelope(code), {
      status: marketFailureStatus(code),
      headers: MARKET_NO_STORE_HEADERS,
    });
  }
}
