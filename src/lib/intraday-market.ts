import { z } from "zod";

export const IntradayIntervalSchema = z.enum(["1m", "5m"]);
export type IntradayInterval = z.infer<typeof IntradayIntervalSchema>;

export const IntradayBarSchema = z
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

export type IntradayBar = z.infer<typeof IntradayBarSchema>;

export const IntradayMarketViewSchema = z
  .object({
    symbol: z.string().trim().min(1).max(40),
    bars: z.array(IntradayBarSchema).min(12),
    provenance: z.object({
      provider: z.literal("Yahoo Finance"),
      sourceUrl: z.url(),
      fetchedAt: z.string().datetime(),
      asOf: z.string().datetime(),
      range: z.literal("1d"),
      interval: IntradayIntervalSchema,
      resolutionLabel: z.enum(["1분 봉", "5분 봉"]),
      attemptedIntervals: z
        .array(IntradayIntervalSchema)
        .min(1)
        .max(2),
      fallbackReason: z
        .enum([
          "ONE_MINUTE_DATA_INSUFFICIENT",
          "ONE_MINUTE_DATA_UNAVAILABLE",
        ])
        .nullable(),
      delayNotice: z.string().trim().min(1),
      synthetic: z.literal(false),
      currency: z.string().trim().min(1).nullable(),
      exchange: z.string().trim().min(1).nullable(),
      exchangeTimezone: z.string().trim().min(1).nullable(),
      sampleCount: z.number().int().min(12),
    }),
  })
  .superRefine((view, context) => {
    if (view.provenance.sampleCount !== view.bars.length) {
      context.addIssue({
        code: "custom",
        path: ["provenance", "sampleCount"],
        message: "sample count must match intraday bars",
      });
    }

    const timestamps = view.bars.map((bar) => bar.timestamp);
    if (new Set(timestamps).size !== timestamps.length) {
      context.addIssue({
        code: "custom",
        path: ["bars"],
        message: "intraday timestamps must be unique",
      });
    }
    if (
      timestamps.some(
        (timestamp, index) => index > 0 && timestamp <= timestamps[index - 1],
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["bars"],
        message: "intraday timestamps must be strictly increasing",
      });
    }

    if (
      view.provenance.interval === "1m" &&
      view.provenance.resolutionLabel !== "1분 봉"
    ) {
      context.addIssue({
        code: "custom",
        path: ["provenance", "resolutionLabel"],
        message: "resolution label must match interval",
      });
    }
    if (
      view.provenance.interval === "5m" &&
      view.provenance.resolutionLabel !== "5분 봉"
    ) {
      context.addIssue({
        code: "custom",
        path: ["provenance", "resolutionLabel"],
        message: "resolution label must match interval",
      });
    }
    if (
      view.provenance.interval === "1m" &&
      view.provenance.fallbackReason !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["provenance", "fallbackReason"],
        message: "one-minute data cannot have a fallback reason",
      });
    }
  });

export type IntradayMarketView = z.infer<typeof IntradayMarketViewSchema>;

export const IntradayFailureCodeSchema = z.enum([
  "INVALID_SYMBOL",
  "DATA_PROVIDER_FAILURE",
  "DATA_SCHEMA_FAILURE",
  "DATA_INSUFFICIENT",
  "DATA_STALE",
]);
export type IntradayFailureCode = z.infer<typeof IntradayFailureCodeSchema>;

export const IntradayMarketEnvelopeSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("SUCCESS"),
    data: IntradayMarketViewSchema,
    error: z.null(),
  }),
  z.object({
    status: z.literal("FAILURE"),
    data: z.null(),
    error: z.object({
      code: IntradayFailureCodeSchema,
      message: z.string().trim().min(1),
    }),
  }),
]);

export type IntradayMarketEnvelope = z.infer<
  typeof IntradayMarketEnvelopeSchema
>;
