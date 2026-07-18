import { NextResponse } from "next/server";
import { z } from "zod";

import {
  IntradayBarSchema,
  IntradayMarketEnvelopeSchema,
  IntradayMarketViewSchema,
  type IntradayBar,
  type IntradayFailureCode,
  type IntradayInterval,
  type IntradayMarketEnvelope,
  type IntradayMarketView,
} from "@/lib/intraday-market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const MINIMUM_INTRADAY_BARS = 12;
const MAX_DATA_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const FETCH_TIMEOUT_MS = 8_000;
const DELAY_NOTICE =
  "Yahoo Finance 공개 데이터는 거래소와 제공 과정에 따라 지연될 수 있으며 실시간 호가가 아닙니다.";

const SymbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(24)
  .regex(/^[A-Z0-9.^=-]+$/);

const NullableNumberArraySchema = z.array(z.number().nullable());
const YahooIntradayResponseSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          meta: z.object({
            symbol: z.string().trim().min(1),
            currency: z.string().trim().min(1).optional(),
            exchangeName: z.string().trim().min(1).optional(),
            exchangeTimezoneName: z.string().trim().min(1).optional(),
            dataGranularity: z.string().trim().min(1).optional(),
            range: z.string().trim().min(1).optional(),
          }),
          timestamp: z.array(z.number().int().positive()),
          indicators: z.object({
            quote: z
              .array(
                z.object({
                  open: NullableNumberArraySchema,
                  high: NullableNumberArraySchema,
                  low: NullableNumberArraySchema,
                  close: NullableNumberArraySchema,
                  volume: NullableNumberArraySchema,
                }),
              )
              .min(1),
          }),
        }),
      )
      .nullable(),
    error: z
      .object({
        code: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
      })
      .nullable(),
  }),
});

class IntradayDataError extends Error {
  readonly code: Exclude<IntradayFailureCode, "INVALID_SYMBOL">;

  constructor(code: Exclude<IntradayFailureCode, "INVALID_SYMBOL">) {
    super(code);
    this.name = "IntradayDataError";
    this.code = code;
  }
}

type FetchedIntraday = Readonly<{
  symbol: string;
  bars: IntradayBar[];
  sourceUrl: string;
  interval: IntradayInterval;
  fetchedAt: Date;
  currency: string | null;
  exchange: string | null;
  exchangeTimezone: string | null;
}>;

function chartUrl(symbol: string, interval: IntradayInterval): string {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=${interval}&includePrePost=false&events=div%2Csplits`;
}

function normalizeBars(
  timestamps: readonly number[],
  quote: {
    open: readonly (number | null)[];
    high: readonly (number | null)[];
    low: readonly (number | null)[];
    close: readonly (number | null)[];
    volume: readonly (number | null)[];
  },
): IntradayBar[] {
  const lengths = [
    quote.open.length,
    quote.high.length,
    quote.low.length,
    quote.close.length,
    quote.volume.length,
  ];
  if (lengths.some((length) => length !== timestamps.length)) {
    throw new IntradayDataError("DATA_SCHEMA_FAILURE");
  }

  const bars: IntradayBar[] = [];
  const seen = new Set<number>();

  for (const [index, timestamp] of timestamps.entries()) {
    const candidate = {
      timestamp,
      open: quote.open[index],
      high: quote.high[index],
      low: quote.low[index],
      close: quote.close[index],
      volume: quote.volume[index],
    };
    if (Object.values(candidate).some((value) => value === null)) continue;
    if (seen.has(timestamp)) {
      throw new IntradayDataError("DATA_SCHEMA_FAILURE");
    }

    const parsed = IntradayBarSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new IntradayDataError("DATA_SCHEMA_FAILURE");
    }
    seen.add(timestamp);
    bars.push(parsed.data);
  }

  return bars.sort((left, right) => left.timestamp - right.timestamp);
}

async function fetchInterval(
  symbol: string,
  interval: IntradayInterval,
): Promise<FetchedIntraday> {
  const sourceUrl = chartUrl(symbol, interval);
  const fetchedAt = new Date();
  let response: Response;

  try {
    response = await fetch(sourceUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new IntradayDataError("DATA_PROVIDER_FAILURE");
  }
  if (!response.ok) {
    throw new IntradayDataError("DATA_PROVIDER_FAILURE");
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new IntradayDataError("DATA_SCHEMA_FAILURE");
  }

  const parsed = YahooIntradayResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new IntradayDataError("DATA_SCHEMA_FAILURE");
  }
  if (parsed.data.chart.error !== null) {
    throw new IntradayDataError("DATA_PROVIDER_FAILURE");
  }

  const result = parsed.data.chart.result?.[0];
  if (!result) {
    throw new IntradayDataError("DATA_PROVIDER_FAILURE");
  }
  if (result.meta.symbol.toUpperCase() !== symbol.toUpperCase()) {
    throw new IntradayDataError("DATA_SCHEMA_FAILURE");
  }
  if (
    (result.meta.range && result.meta.range !== "1d") ||
    (result.meta.dataGranularity && result.meta.dataGranularity !== interval)
  ) {
    throw new IntradayDataError("DATA_SCHEMA_FAILURE");
  }

  const bars = normalizeBars(result.timestamp, result.indicators.quote[0]);
  return {
    symbol: result.meta.symbol,
    bars,
    sourceUrl,
    interval,
    fetchedAt,
    currency: result.meta.currency ?? null,
    exchange: result.meta.exchangeName ?? null,
    exchangeTimezone: result.meta.exchangeTimezoneName ?? null,
  };
}

async function fetchBestIntraday(symbol: string): Promise<IntradayMarketView> {
  let oneMinuteFailure:
    | "ONE_MINUTE_DATA_INSUFFICIENT"
    | "ONE_MINUTE_DATA_UNAVAILABLE" = "ONE_MINUTE_DATA_UNAVAILABLE";

  try {
    const oneMinute = await fetchInterval(symbol, "1m");
    if (oneMinute.bars.length >= MINIMUM_INTRADAY_BARS) {
      return buildView(oneMinute, ["1m"], null);
    }
    oneMinuteFailure = "ONE_MINUTE_DATA_INSUFFICIENT";
  } catch {
    oneMinuteFailure = "ONE_MINUTE_DATA_UNAVAILABLE";
  }

  const fiveMinute = await fetchInterval(symbol, "5m");
  if (fiveMinute.bars.length < MINIMUM_INTRADAY_BARS) {
    throw new IntradayDataError("DATA_INSUFFICIENT");
  }
  return buildView(fiveMinute, ["1m", "5m"], oneMinuteFailure);
}

function buildView(
  source: FetchedIntraday,
  attemptedIntervals: IntradayInterval[],
  fallbackReason:
    | "ONE_MINUTE_DATA_INSUFFICIENT"
    | "ONE_MINUTE_DATA_UNAVAILABLE"
    | null,
): IntradayMarketView {
  const latest = source.bars.at(-1);
  if (!latest) throw new IntradayDataError("DATA_INSUFFICIENT");

  const ageMs = source.fetchedAt.getTime() - latest.timestamp * 1_000;
  if (ageMs > MAX_DATA_AGE_MS) {
    throw new IntradayDataError("DATA_STALE");
  }
  if (ageMs < -24 * 60 * 60 * 1_000) {
    throw new IntradayDataError("DATA_SCHEMA_FAILURE");
  }

  const candidate = {
    symbol: source.symbol,
    bars: source.bars,
    provenance: {
      provider: "Yahoo Finance" as const,
      sourceUrl: source.sourceUrl,
      fetchedAt: source.fetchedAt.toISOString(),
      asOf: new Date(latest.timestamp * 1_000).toISOString(),
      range: "1d" as const,
      interval: source.interval,
      resolutionLabel: source.interval === "1m" ? "1분 봉" : "5분 봉",
      attemptedIntervals,
      fallbackReason,
      delayNotice: DELAY_NOTICE,
      synthetic: false as const,
      currency: source.currency,
      exchange: source.exchange,
      exchangeTimezone: source.exchangeTimezone,
      sampleCount: source.bars.length,
    },
  };

  const parsed = IntradayMarketViewSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new IntradayDataError("DATA_SCHEMA_FAILURE");
  }
  return parsed.data;
}

function friendlyFailure(code: IntradayFailureCode): string {
  switch (code) {
    case "INVALID_SYMBOL":
      return "종목 코드를 확인해 주세요. 예: 삼성전자는 005930.KS입니다.";
    case "DATA_PROVIDER_FAILURE":
      return "공개 시세 제공처에 연결하지 못해 1일 차트를 표시하지 않았습니다.";
    case "DATA_SCHEMA_FAILURE":
      return "받은 장중 데이터를 안전하게 확인할 수 없어 1일 차트를 표시하지 않았습니다.";
    case "DATA_INSUFFICIENT":
      return "1분·5분 데이터가 모두 부족해 1일 차트를 사용할 수 없습니다.";
    case "DATA_STALE":
      return "장중 데이터가 오래되어 1일 차트로 표시하지 않았습니다.";
  }
}

function failureEnvelope(code: IntradayFailureCode): IntradayMarketEnvelope {
  return IntradayMarketEnvelopeSchema.parse({
    status: "FAILURE",
    data: null,
    error: { code, message: friendlyFailure(code) },
  });
}

function failureStatus(code: IntradayFailureCode): number {
  if (code === "INVALID_SYMBOL") return 400;
  if (code === "DATA_INSUFFICIENT") return 422;
  if (code === "DATA_STALE") return 503;
  return 502;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = SymbolSchema.safeParse(url.searchParams.get("symbol"));
  if (!symbol.success) {
    return NextResponse.json(failureEnvelope("INVALID_SYMBOL"), {
      status: 400,
      headers: NO_STORE_HEADERS,
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
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (error: unknown) {
    const code: IntradayFailureCode =
      error instanceof IntradayDataError
        ? error.code
        : "DATA_SCHEMA_FAILURE";
    return NextResponse.json(failureEnvelope(code), {
      status: failureStatus(code),
      headers: NO_STORE_HEADERS,
    });
  }
}
