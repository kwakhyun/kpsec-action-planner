import "server-only";

import { z } from "zod";

import {
  IntradayBarSchema,
  IntradayMarketViewSchema,
  type IntradayBar,
  type IntradayFailureCode,
  type IntradayInterval,
  type IntradayMarketView,
} from "@/lib/intraday-market";

const MINIMUM_INTRADAY_BARS = 12;
const MAX_DATA_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const FETCH_TIMEOUT_MS = 8_000;
const DELAY_NOTICE =
  "Yahoo Finance 공개 데이터는 거래소와 제공 과정에 따라 지연될 수 있으며 실시간 호가가 아닙니다.";


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

export class IntradayDataError extends Error {
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

export async function fetchBestIntraday(symbol: string): Promise<IntradayMarketView> {
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
