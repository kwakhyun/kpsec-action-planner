import { z } from "zod";

const MarketViewBarSchema = z
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
        path: ["high"],
        message: "high must be the greatest OHLC value",
      });
    }
    if (bar.low > Math.min(bar.open, bar.close, bar.high)) {
      context.addIssue({
        code: "custom",
        path: ["low"],
        message: "low must be the smallest OHLC value",
      });
    }
  });

export const MarketViewSchema = z
  .object({
    symbol: z.string().trim().min(1).max(40),
    quote: z.object({
      latestPrice: z.number().positive(),
      previousClose: z.number().positive(),
      change: z.number().finite(),
      changePct: z.number().finite(),
      volume: z.number().int().nonnegative(),
    }),
    bars: z.array(MarketViewBarSchema).min(2),
    metrics: z.object({
      latestPrice: z.number().positive(),
      volatility20dPct: z.number().finite().nonnegative(),
      range20d: z.object({
        high: z.number().positive(),
        low: z.number().positive(),
        percent: z.number().finite().nonnegative(),
      }),
      relativeVolume20d: z.number().finite().nonnegative().nullable(),
    }),
    observations: z
      .object({
        latestClose: z.number().positive(),
        movingAverage20: z.number().positive().nullable(),
        relativeVolume20: z.number().finite().nonnegative().nullable(),
        pricePosition: z.enum(["ABOVE", "BELOW", "NEAR", "UNAVAILABLE"]),
        priceText: z.string().trim().min(1),
        volumeText: z.string().trim().min(1),
        movingAverageText: z.string().trim().min(1),
      })
      .optional(),
    provenance: z.object({
      provider: z.literal("Yahoo Finance"),
      sourceUrl: z.url(),
      fetchedAt: z.string().datetime(),
      asOf: z.string().datetime(),
      range: z.literal("3mo"),
      interval: z.literal("1d"),
      delayNotice: z.string().trim().min(1),
      synthetic: z.literal(false),
      currency: z.string().trim().min(1).nullable(),
      exchange: z.string().trim().min(1).nullable(),
      exchangeTimezone: z.string().trim().min(1).nullable(),
      tradingSessionCount: z.number().int().positive(),
    }),
  })
  .superRefine((view, context) => {
    if (view.quote.latestPrice !== view.metrics.latestPrice) {
      context.addIssue({
        code: "custom",
        path: ["quote", "latestPrice"],
        message: "quote and metric latest prices must match",
      });
    }
    if (view.provenance.tradingSessionCount !== view.bars.length) {
      context.addIssue({
        code: "custom",
        path: ["provenance", "tradingSessionCount"],
        message: "trading session count must match chart bars",
      });
    }

    const timestamps = view.bars.map((bar) => bar.timestamp);
    const uniqueTimestamps = new Set(timestamps);
    if (uniqueTimestamps.size !== timestamps.length) {
      context.addIssue({
        code: "custom",
        path: ["bars"],
        message: "chart timestamps must be unique",
      });
    }
    if (timestamps.some((timestamp, index) => index > 0 && timestamp <= timestamps[index - 1])) {
      context.addIssue({
        code: "custom",
        path: ["bars"],
        message: "chart timestamps must be strictly increasing",
      });
    }
  });

export type MarketView = z.infer<typeof MarketViewSchema>;

export const MarketViewFailureCodeSchema = z.enum([
  "INVALID_SYMBOL",
  "DATA_PROVIDER_FAILURE",
  "DATA_SCHEMA_FAILURE",
  "DATA_INSUFFICIENT",
  "DATA_STALE",
]);

export type MarketViewFailureCode = z.infer<
  typeof MarketViewFailureCodeSchema
>;

export const MarketViewSuccessEnvelopeSchema = z.object({
  status: z.literal("SUCCESS"),
  data: MarketViewSchema,
  error: z.null(),
});

export const MarketViewFailureEnvelopeSchema = z.object({
  status: z.literal("FAILURE"),
  data: z.null(),
  error: z.object({
    code: MarketViewFailureCodeSchema,
    message: z.string().trim().min(1),
  }),
});

export const MarketViewEnvelopeSchema = z.discriminatedUnion("status", [
  MarketViewSuccessEnvelopeSchema,
  MarketViewFailureEnvelopeSchema,
]);

export type MarketViewEnvelope = z.infer<typeof MarketViewEnvelopeSchema>;

type MarketViewSource = Omit<MarketView, "quote" | "provenance"> & {
  provider: "Yahoo Finance";
  sourceUrl: string;
  fetchedAt: string;
  asOf: string;
  range: "3mo";
  interval: "1d";
  delayNotice: string;
  synthetic: false;
  currency: string | null;
  exchange: string | null;
  exchangeTimezone: string | null;
};

export function createMarketView(snapshot: MarketViewSource): MarketView {
  const latest = snapshot.bars.at(-1);
  const previous = snapshot.bars.at(-2);
  if (!latest || !previous) {
    throw new Error("DATA_INSUFFICIENT");
  }

  const change = latest.close - previous.close;
  const recentTwenty = snapshot.bars.slice(-20);
  const previousTwenty = snapshot.bars.slice(-21, -1);
  const movingAverage20 =
    recentTwenty.length === 20
      ? recentTwenty.reduce((sum, bar) => sum + bar.close, 0) / 20
      : null;
  const averageVolume20 =
    previousTwenty.length === 20
      ? previousTwenty.reduce((sum, bar) => sum + bar.volume, 0) / 20
      : null;
  const relativeVolume20 =
    averageVolume20 && averageVolume20 > 0
      ? latest.volume / averageVolume20
      : null;
  const differencePct = movingAverage20
    ? ((latest.close - movingAverage20) / movingAverage20) * 100
    : null;
  const pricePosition =
    differencePct === null
      ? ("UNAVAILABLE" as const)
      : Math.abs(differencePct) < 0.25
        ? ("NEAR" as const)
        : differencePct > 0
          ? ("ABOVE" as const)
          : ("BELOW" as const);
  return MarketViewSchema.parse({
    symbol: snapshot.symbol,
    quote: {
      latestPrice: latest.close,
      previousClose: previous.close,
      change,
      changePct: (change / previous.close) * 100,
      volume: latest.volume,
    },
    bars: snapshot.bars,
    metrics: snapshot.metrics,
    observations: {
      latestClose: latest.close,
      movingAverage20,
      relativeVolume20,
      pricePosition,
      priceText:
        pricePosition === "ABOVE"
          ? "최근 가격이 20일 평균보다 위에 있습니다."
          : pricePosition === "BELOW"
            ? "최근 가격이 20일 평균보다 아래에 있습니다."
            : pricePosition === "NEAR"
              ? "최근 가격이 20일 평균과 비슷한 범위에 있습니다."
              : "20일 평균과 비교할 거래일 데이터가 충분하지 않습니다.",
      volumeText:
        relativeVolume20 === null
          ? "거래량을 최근 평균과 비교할 데이터가 충분하지 않습니다."
          : relativeVolume20 > 1.05
            ? "최근 거래일 거래량은 이전 20개 거래일 평균보다 많습니다."
            : relativeVolume20 < 0.95
              ? "최근 거래일 거래량은 이전 20개 거래일 평균보다 적습니다."
              : "최근 거래일 거래량은 이전 20개 거래일 평균과 비슷합니다.",
      movingAverageText:
        "5일 평균은 최근 움직임에 빠르게 반응하고, 60일 평균은 더 긴 흐름을 천천히 보여줍니다.",
    },
    provenance: {
      provider: snapshot.provider,
      sourceUrl: snapshot.sourceUrl,
      fetchedAt: snapshot.fetchedAt,
      asOf: snapshot.asOf,
      range: snapshot.range,
      interval: snapshot.interval,
      delayNotice: snapshot.delayNotice,
      synthetic: snapshot.synthetic,
      currency: snapshot.currency,
      exchange: snapshot.exchange,
      exchangeTimezone: snapshot.exchangeTimezone,
      tradingSessionCount: snapshot.bars.length,
    },
  });
}
