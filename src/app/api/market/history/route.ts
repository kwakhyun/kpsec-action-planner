import { NextResponse } from "next/server";
import { z } from "zod";

import {
  ChartHistoryBarSchema,
  ChartHistoryEnvelopeSchema,
  ChartHistoryViewSchema,
  type ChartHistoryBar,
  type ChartHistoryFailureCode,
} from "@/lib/chart-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const RANGE = "5y" as const;
const INTERVAL = "1d" as const;
const MINIMUM_BARS = 260;
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
const YahooHistoryResponseSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          meta: z.object({
            symbol: z.string().trim().min(1),
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

class HistoryDataError extends Error {
  readonly code: Exclude<ChartHistoryFailureCode, "INVALID_SYMBOL">;

  constructor(code: Exclude<ChartHistoryFailureCode, "INVALID_SYMBOL">) {
    super(code);
    this.name = "HistoryDataError";
    this.code = code;
  }
}

function chartUrl(symbol: string): string {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${RANGE}&interval=${INTERVAL}&includePrePost=false&events=div%2Csplits`;
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
): Readonly<{ bars: ChartHistoryBar[]; discardedSampleCount: number }> {
  if (
    [quote.open, quote.high, quote.low, quote.close, quote.volume].some(
      (values) => values.length !== timestamps.length,
    )
  ) {
    throw new HistoryDataError("DATA_SCHEMA_FAILURE");
  }

  const seen = new Set<number>();
  const bars: ChartHistoryBar[] = [];
  let discardedSampleCount = 0;
  for (const [index, timestamp] of timestamps.entries()) {
    const candidate = {
      timestamp,
      open: quote.open[index],
      high: quote.high[index],
      low: quote.low[index],
      close: quote.close[index],
      volume: quote.volume[index],
    };
    if (Object.values(candidate).some((value) => value === null)) {
      discardedSampleCount += 1;
      continue;
    }
    if (seen.has(timestamp)) throw new HistoryDataError("DATA_SCHEMA_FAILURE");
    const parsed = ChartHistoryBarSchema.safeParse(candidate);
    if (!parsed.success) {
      discardedSampleCount += 1;
      continue;
    }
    seen.add(timestamp);
    bars.push(parsed.data);
  }
  const discardLimit = Math.max(5, Math.ceil(timestamps.length * 0.01));
  if (discardedSampleCount > discardLimit) {
    throw new HistoryDataError("DATA_SCHEMA_FAILURE");
  }
  return {
    bars: bars.sort((left, right) => left.timestamp - right.timestamp),
    discardedSampleCount,
  };
}

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

function failureStatus(code: ChartHistoryFailureCode): number {
  if (code === "INVALID_SYMBOL") return 400;
  if (code === "DATA_INSUFFICIENT") return 422;
  if (code === "DATA_STALE") return 503;
  return 502;
}

async function fetchHistory(symbol: string) {
  const sourceUrl = chartUrl(symbol);
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
    throw new HistoryDataError("DATA_PROVIDER_FAILURE");
  }
  if (!response.ok) throw new HistoryDataError("DATA_PROVIDER_FAILURE");

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new HistoryDataError("DATA_SCHEMA_FAILURE");
  }
  const parsed = YahooHistoryResponseSchema.safeParse(raw);
  if (!parsed.success) throw new HistoryDataError("DATA_SCHEMA_FAILURE");
  if (parsed.data.chart.error !== null) {
    throw new HistoryDataError("DATA_PROVIDER_FAILURE");
  }

  const result = parsed.data.chart.result?.[0];
  if (!result) throw new HistoryDataError("DATA_PROVIDER_FAILURE");
  if (result.meta.symbol.toUpperCase() !== symbol.toUpperCase()) {
    throw new HistoryDataError("DATA_SCHEMA_FAILURE");
  }
  if (
    (result.meta.range && result.meta.range !== RANGE) ||
    (result.meta.dataGranularity && result.meta.dataGranularity !== INTERVAL)
  ) {
    throw new HistoryDataError("DATA_SCHEMA_FAILURE");
  }

  const normalized = normalizeBars(
    result.timestamp,
    result.indicators.quote[0],
  );
  const { bars } = normalized;
  if (bars.length < MINIMUM_BARS) throw new HistoryDataError("DATA_INSUFFICIENT");
  const latest = bars.at(-1);
  if (!latest) throw new HistoryDataError("DATA_INSUFFICIENT");
  const ageMs = fetchedAt.getTime() - latest.timestamp * 1_000;
  if (ageMs > MAX_DATA_AGE_MS) throw new HistoryDataError("DATA_STALE");
  if (ageMs < -24 * 60 * 60 * 1_000) {
    throw new HistoryDataError("DATA_SCHEMA_FAILURE");
  }

  return ChartHistoryViewSchema.parse({
    symbol: result.meta.symbol,
    bars,
    provenance: {
      provider: "Yahoo Finance",
      sourceUrl,
      fetchedAt: fetchedAt.toISOString(),
      asOf: new Date(latest.timestamp * 1_000).toISOString(),
      range: RANGE,
      interval: INTERVAL,
      delayNotice: DELAY_NOTICE,
      synthetic: false,
      exchangeTimezone: result.meta.exchangeTimezoneName ?? null,
      sampleCount: bars.length,
      discardedSampleCount: normalized.discardedSampleCount,
    },
  });
}

export async function GET(request: Request) {
  const symbol = SymbolSchema.safeParse(
    new URL(request.url).searchParams.get("symbol"),
  );
  if (!symbol.success) {
    return NextResponse.json(failureEnvelope("INVALID_SYMBOL"), {
      status: 400,
      headers: NO_STORE_HEADERS,
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
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (error: unknown) {
    const code: ChartHistoryFailureCode =
      error instanceof HistoryDataError
        ? error.code
        : "DATA_SCHEMA_FAILURE";
    return NextResponse.json(failureEnvelope(code), {
      status: failureStatus(code),
      headers: NO_STORE_HEADERS,
    });
  }
}
