import { z } from "zod";

export const ChartHistoryBarSchema = z
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

export type ChartHistoryBar = z.infer<typeof ChartHistoryBarSchema>;

export const ChartHistoryViewSchema = z
  .object({
    symbol: z.string().trim().min(1).max(40),
    bars: z.array(ChartHistoryBarSchema).min(260),
    provenance: z.object({
      provider: z.literal("Yahoo Finance"),
      sourceUrl: z.url(),
      fetchedAt: z.string().datetime(),
      asOf: z.string().datetime(),
      range: z.literal("5y"),
      interval: z.literal("1d"),
      delayNotice: z.string().trim().min(1),
      synthetic: z.literal(false),
      exchangeTimezone: z.string().trim().min(1).nullable(),
      sampleCount: z.number().int().min(260),
      discardedSampleCount: z.number().int().nonnegative(),
    }),
  })
  .superRefine((view, context) => {
    if (view.provenance.sampleCount !== view.bars.length) {
      context.addIssue({
        code: "custom",
        path: ["provenance", "sampleCount"],
        message: "sample count must match history bars",
      });
    }

    const timestamps = view.bars.map((bar) => bar.timestamp);
    if (new Set(timestamps).size !== timestamps.length) {
      context.addIssue({
        code: "custom",
        path: ["bars"],
        message: "history timestamps must be unique",
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
        message: "history timestamps must be strictly increasing",
      });
    }
  });

export type ChartHistoryView = z.infer<typeof ChartHistoryViewSchema>;

export const ChartHistoryFailureCodeSchema = z.enum([
  "INVALID_SYMBOL",
  "DATA_PROVIDER_FAILURE",
  "DATA_SCHEMA_FAILURE",
  "DATA_INSUFFICIENT",
  "DATA_STALE",
]);

export type ChartHistoryFailureCode = z.infer<
  typeof ChartHistoryFailureCodeSchema
>;

export const ChartHistoryEnvelopeSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("SUCCESS"),
    data: ChartHistoryViewSchema,
    error: z.null(),
  }),
  z.object({
    status: z.literal("FAILURE"),
    data: z.null(),
    error: z.object({
      code: ChartHistoryFailureCodeSchema,
      message: z.string().trim().min(1),
    }),
  }),
]);

export type ChartHistoryEnvelope = z.infer<typeof ChartHistoryEnvelopeSchema>;
