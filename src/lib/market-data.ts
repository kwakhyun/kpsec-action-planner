import "server-only";

import { z } from "zod";

export const YAHOO_FINANCE_PROVIDER = "Yahoo Finance" as const;
export const YAHOO_FINANCE_RANGE = "3mo" as const;
export const YAHOO_FINANCE_INTERVAL = "1d" as const;
export const MARKET_DATA_DELAY_CAVEAT =
  "Yahoo Finance 공개 데이터는 거래소와 제공 과정에 따라 지연될 수 있으며 실시간 호가가 아닙니다." as const;

const MINIMUM_SESSION_COUNT = 21;
const METRIC_WINDOW = 20;
const ANNUALIZATION_SESSIONS = 252;
const DEFAULT_MAX_DATA_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const DEFAULT_TIMEOUT_MS = 8_000;

const NullableNumberArraySchema = z.array(z.number().nullable());

export const YahooChartResponseSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          meta: z.object({
            symbol: z.string().trim().min(1),
            currency: z.string().trim().min(1).optional(),
            exchangeName: z.string().trim().min(1).optional(),
            exchangeTimezoneName: z.string().trim().min(1).optional(),
            regularMarketTime: z.number().int().positive().optional(),
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

export const DailyOhlcvBarSchema = z
  .object({
    timestamp: z.number().int().positive(),
    open: z.number().positive(),
    high: z.number().positive(),
    low: z.number().positive(),
    close: z.number().positive(),
    volume: z.number().int().nonnegative(),
  })
  .superRefine((bar, context) => {
    if (bar.high < Math.max(bar.open, bar.close, bar.low)) {
      context.addIssue({
        code: "custom",
        message: "high must be the greatest OHLC value",
        path: ["high"],
      });
    }
    if (bar.low > Math.min(bar.open, bar.close, bar.high)) {
      context.addIssue({
        code: "custom",
        message: "low must be the smallest OHLC value",
        path: ["low"],
      });
    }
  });

export type DailyOhlcvBar = z.infer<typeof DailyOhlcvBarSchema>;

export const MarketSnapshotSchema = z.object({
  symbol: z.string().trim().min(1),
  provider: z.literal(YAHOO_FINANCE_PROVIDER),
  sourceUrl: z.url(),
  fetchedAt: z.string().datetime(),
  asOf: z.string().datetime(),
  range: z.literal(YAHOO_FINANCE_RANGE),
  interval: z.literal(YAHOO_FINANCE_INTERVAL),
  delayNotice: z.literal(MARKET_DATA_DELAY_CAVEAT),
  synthetic: z.literal(false),
  currency: z.string().nullable(),
  exchange: z.string().nullable(),
  exchangeTimezone: z.string().nullable(),
  bars: z.array(DailyOhlcvBarSchema).min(MINIMUM_SESSION_COUNT),
  metrics: z.object({
    latestPrice: z.number().positive(),
    volatility20dPct: z.number().nonnegative(),
    range20d: z.object({
      high: z.number().positive(),
      low: z.number().positive(),
      percent: z.number().nonnegative(),
    }),
    relativeVolume20d: z.number().nonnegative().nullable(),
  }),
});

export type MarketSnapshot = z.infer<typeof MarketSnapshotSchema>;
export const MarketDataSnapshotSchema = MarketSnapshotSchema;
export type MarketDataSnapshot = MarketSnapshot;

export type MarketDataFailureCode =
  | "DATA_PROVIDER_FAILURE"
  | "DATA_SCHEMA_FAILURE"
  | "DATA_INSUFFICIENT"
  | "DATA_STALE";

export class MarketDataError extends Error {
  readonly code: MarketDataFailureCode;

  constructor(code: MarketDataFailureCode) {
    super(code);
    this.name = "MarketDataError";
    this.code = code;
  }
}

export type MarketDataFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type FetchYahooMarketDataOptions = Readonly<{
  fetchImpl?: MarketDataFetch;
  now?: () => Date;
  maxDataAgeMs?: number;
  timeoutMs?: number;
}>;

export function buildYahooChartUrl(symbol: string): string {
  const normalizedSymbol = symbol.trim();
  if (!normalizedSymbol || normalizedSymbol.length > 40) {
    throw new MarketDataError("DATA_SCHEMA_FAILURE");
  }

  const encodedSymbol = encodeURIComponent(normalizedSymbol);
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?range=${YAHOO_FINANCE_RANGE}&interval=${YAHOO_FINANCE_INTERVAL}&includePrePost=false&events=div%2Csplits`;
}

function standardDeviation(values: readonly number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

export function calculateMarketMetrics(
  bars: readonly DailyOhlcvBar[],
): MarketSnapshot["metrics"] {
  if (bars.length < MINIMUM_SESSION_COUNT) {
    throw new MarketDataError("DATA_INSUFFICIENT");
  }

  const latestTwentyOne = bars.slice(-MINIMUM_SESSION_COUNT);
  const recentTwenty = latestTwentyOne.slice(-METRIC_WINDOW);
  const logReturns = latestTwentyOne.slice(1).map((bar, index) =>
    Math.log(bar.close / latestTwentyOne[index].close),
  );
  const annualizedVolatility20 =
    standardDeviation(logReturns) * Math.sqrt(ANNUALIZATION_SESSIONS);
  const high = Math.max(...recentTwenty.map((bar) => bar.high));
  const low = Math.min(...recentTwenty.map((bar) => bar.low));
  const latest = recentTwenty.at(-1);

  if (!latest) {
    throw new MarketDataError("DATA_INSUFFICIENT");
  }

  const averageVolume20 =
    recentTwenty.reduce((sum, bar) => sum + bar.volume, 0) /
    recentTwenty.length;

  return {
    latestPrice: latest.close,
    volatility20dPct: annualizedVolatility20 * 100,
    range20d: {
      high,
      low,
      percent: ((high - low) / latest.close) * 100,
    },
    relativeVolume20d:
      averageVolume20 === 0 ? null : latest.volume / averageVolume20,
  };
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
): DailyOhlcvBar[] {
  const bars: DailyOhlcvBar[] = [];
  const seenTimestamps = new Set<number>();
  const expectedLength = timestamps.length;
  if (
    quote.open.length !== expectedLength ||
    quote.high.length !== expectedLength ||
    quote.low.length !== expectedLength ||
    quote.close.length !== expectedLength ||
    quote.volume.length !== expectedLength
  ) {
    throw new MarketDataError("DATA_SCHEMA_FAILURE");
  }

  timestamps.forEach((timestamp, index) => {
    const candidate = {
      timestamp,
      open: quote.open[index],
      high: quote.high[index],
      low: quote.low[index],
      close: quote.close[index],
      volume: quote.volume[index],
    };

    if (
      candidate.open === null ||
      candidate.open === undefined ||
      candidate.high === null ||
      candidate.high === undefined ||
      candidate.low === null ||
      candidate.low === undefined ||
      candidate.close === null ||
      candidate.close === undefined ||
      candidate.volume === null ||
      candidate.volume === undefined
    ) {
      return;
    }

    if (seenTimestamps.has(timestamp)) {
      throw new MarketDataError("DATA_SCHEMA_FAILURE");
    }

    const parsed = DailyOhlcvBarSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new MarketDataError("DATA_SCHEMA_FAILURE");
    }

    seenTimestamps.add(timestamp);
    bars.push(parsed.data);
  });

  return bars.sort((left, right) => left.timestamp - right.timestamp);
}

function parseYahooResponse(raw: unknown, requestedSymbol: string) {
  const parsed = YahooChartResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new MarketDataError("DATA_SCHEMA_FAILURE");
  }

  if (parsed.data.chart.error !== null) {
    throw new MarketDataError("DATA_PROVIDER_FAILURE");
  }

  const result = parsed.data.chart.result?.[0];
  if (!result) {
    throw new MarketDataError("DATA_PROVIDER_FAILURE");
  }

  if (result.meta.symbol.toUpperCase() !== requestedSymbol.trim().toUpperCase()) {
    throw new MarketDataError("DATA_SCHEMA_FAILURE");
  }
  if (
    (result.meta.range && result.meta.range !== YAHOO_FINANCE_RANGE) ||
    (result.meta.dataGranularity &&
      result.meta.dataGranularity !== YAHOO_FINANCE_INTERVAL)
  ) {
    throw new MarketDataError("DATA_SCHEMA_FAILURE");
  }

  return result;
}

function isoFromEpochSeconds(timestamp: number): string {
  return new Date(timestamp * 1_000).toISOString();
}

export async function fetchYahooMarketData(
  symbol: string,
  options: FetchYahooMarketDataOptions = {},
): Promise<MarketSnapshot> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const maxDataAgeMs = options.maxDataAgeMs ?? DEFAULT_MAX_DATA_AGE_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const sourceUrl = buildYahooChartUrl(symbol);
  const fetchedAt = now();

  if (
    !Number.isFinite(fetchedAt.getTime()) ||
    !Number.isFinite(maxDataAgeMs) ||
    maxDataAgeMs < 0 ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    throw new MarketDataError("DATA_SCHEMA_FAILURE");
  }

  let response: Response;
  try {
    response = await fetchImpl(sourceUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new MarketDataError("DATA_PROVIDER_FAILURE");
  }

  if (!response.ok) {
    throw new MarketDataError("DATA_PROVIDER_FAILURE");
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new MarketDataError("DATA_SCHEMA_FAILURE");
  }

  const result = parseYahooResponse(raw, symbol);
  const quote = result.indicators.quote[0];
  const bars = normalizeBars(result.timestamp, quote);

  if (bars.length < MINIMUM_SESSION_COUNT) {
    throw new MarketDataError("DATA_INSUFFICIENT");
  }

  const firstBar = bars[0];
  const latestBar = bars.at(-1);
  if (!firstBar || !latestBar) {
    throw new MarketDataError("DATA_INSUFFICIENT");
  }

  const latestAtMs = latestBar.timestamp * 1_000;
  const ageMs = fetchedAt.getTime() - latestAtMs;
  if (ageMs > maxDataAgeMs) {
    throw new MarketDataError("DATA_STALE");
  }
  if (ageMs < -24 * 60 * 60 * 1_000) {
    throw new MarketDataError("DATA_SCHEMA_FAILURE");
  }

  const snapshot = {
    symbol: result.meta.symbol,
    provider: YAHOO_FINANCE_PROVIDER,
    sourceUrl,
    fetchedAt: fetchedAt.toISOString(),
    asOf: isoFromEpochSeconds(latestBar.timestamp),
    range: YAHOO_FINANCE_RANGE,
    interval: YAHOO_FINANCE_INTERVAL,
    delayNotice: MARKET_DATA_DELAY_CAVEAT,
    synthetic: false as const,
    currency: result.meta.currency ?? null,
    exchange: result.meta.exchangeName ?? null,
    exchangeTimezone: result.meta.exchangeTimezoneName ?? null,
    bars,
    metrics: calculateMarketMetrics(bars),
  };

  const parsedSnapshot = MarketSnapshotSchema.safeParse(snapshot);
  if (!parsedSnapshot.success) {
    throw new MarketDataError("DATA_SCHEMA_FAILURE");
  }

  return parsedSnapshot.data;
}

export const fetchMarketSnapshot = fetchYahooMarketData;
