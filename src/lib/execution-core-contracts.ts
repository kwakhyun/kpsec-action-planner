import { z } from "zod";

export const ExecutionDirectionSchema = z.enum(["BUY", "SELL"]);
export const ExecutionDeadlineSchema = z.enum([
  "NOW",
  "TODAY",
  "THIS_WEEK",
  "NO_RUSH",
]);
export const PrimaryRegretSchema = z.enum([
  "PRICE_MOVE",
  "MISSED_OPPORTUNITY",
]);

export const MarketDataFreshnessSchema = z
  .object({
    status: z.enum(["FRESH", "STALE", "UNKNOWN"]),
    asOf: z.string().datetime({ offset: true }),
    checkedAt: z.string().datetime({ offset: true }),
    maxAgeMinutes: z.number().int().positive().max(10_080),
  })
  .strict()
  .superRefine((freshness, context) => {
    if (Date.parse(freshness.checkedAt) < Date.parse(freshness.asOf)) {
      context.addIssue({
        code: "custom",
        message: "checkedAt은 asOf보다 빠를 수 없습니다.",
        path: ["checkedAt"],
      });
    }
  });

export const ExecutionMarketMetricsSchema = z
  .object({
    latestClose: z.number().int().positive().max(1_000_000_000),
    // Annualized realized volatility can legitimately exceed 100% in an
    // unusually volatile window. Keep a finite sanity ceiling without
    // rejecting a validated public-market observation.
    volatility20dPct: z.number().nonnegative().max(1_000),
    rangeLow: z.number().int().positive().max(1_000_000_000),
    rangeHigh: z.number().int().positive().max(1_000_000_000),
    relativeVolume: z.number().nonnegative().max(100),
    freshness: MarketDataFreshnessSchema,
  })
  .strict()
  .superRefine((metrics, context) => {
    if (metrics.rangeLow > metrics.rangeHigh) {
      context.addIssue({
        code: "custom",
        message: "rangeLow는 rangeHigh보다 클 수 없습니다.",
        path: ["rangeLow"],
      });
    }
    if (
      metrics.latestClose < metrics.rangeLow ||
      metrics.latestClose > metrics.rangeHigh
    ) {
      context.addIssue({
        code: "custom",
        message: "latestClose는 최근 고저 범위 안에 있어야 합니다.",
        path: ["latestClose"],
      });
    }
  });

const SharedInputFields = {
  deadline: ExecutionDeadlineSchema,
  primaryRegret: PrimaryRegretSchema,
  maxLossPercent: z.number().positive().max(100),
  maxMovePercent: z.number().positive().max(100),
  market: ExecutionMarketMetricsSchema,
  lotSize: z.number().int().positive().max(10_000).default(1),
};

const BuyExecutionInputSchema = z
  .object({
    direction: z.literal("BUY"),
    budgetKrw: z.number().int().positive().max(1_000_000_000_000),
    ...SharedInputFields,
  })
  .strict();

const SellExecutionInputSchema = z
  .object({
    direction: z.literal("SELL"),
    holdingQuantity: z.number().int().positive().max(1_000_000_000),
    ...SharedInputFields,
  })
  .strict();

export const RegretBudgetExecutionInputSchema = z.discriminatedUnion(
  "direction",
  [BuyExecutionInputSchema, SellExecutionInputSchema],
);

export type RegretBudgetExecutionInput = z.infer<
  typeof RegretBudgetExecutionInputSchema
>;
export const ExecutionDecisionInputSchema = RegretBudgetExecutionInputSchema;
export type ExecutionDecisionInput = RegretBudgetExecutionInput;

const PlanConditionSchema = z.object({
  code: z.enum([
    "INPUT_UNCHANGED",
    "DATA_STILL_FRESH",
    "WITHIN_REVIEW_BAND",
  ]),
  check: z.string().min(1),
  passWhen: z.string().min(1),
});

const StopConditionSchema = z.object({
  code: z.enum([
    "DATA_BECOMES_STALE",
    "PRICE_OUTSIDE_REVIEW_BAND",
    "LOSS_TOLERANCE_REACHED",
    "INPUT_OR_DEADLINE_CHANGED",
  ]),
  trigger: z.string().min(1),
  reason: z.string().min(1),
  resumeWhen: z.string().min(1),
});

const ExecutionAllocationSchema = z.object({
  sequence: z.number().int().positive(),
  shares: z.number().int().positive(),
  amountKrw: z.number().int().nonnegative(),
  condition: z.enum(["INITIAL_REVIEW", "RECHECK_REQUIRED"]),
});

const ReviewLineSchema = z.object({
  referencePriceKrw: z.number().int().positive(),
  lowerReviewPriceKrw: z.number().int().nonnegative(),
  upperReviewPriceKrw: z.number().int().positive(),
  lossTolerancePriceKrw: z.number().int().nonnegative(),
  movePercent: z.number().positive(),
  lossPercent: z.number().positive(),
  meaning: z.string().min(1),
});

export const ExecutionPlanSchema = z.object({
  id: z.enum(["ONE_SHOT", "STAGED_2", "STAGED_3"]),
  installmentCount: z.number().int().min(1).max(3),
  allocations: z.array(ExecutionAllocationSchema).min(1).max(3),
  totalShares: z.number().int().positive(),
  referenceTotalAmountKrw: z.number().int().nonnegative(),
  unallocatedBudgetKrw: z.number().int().nonnegative().nullable(),
  remainingHoldingQuantity: z.number().int().nonnegative().nullable(),
  benefits: z.array(z.string().min(1)).min(1),
  tradeoffs: z.array(z.string().min(1)).min(1),
  conditions: z.array(PlanConditionSchema).min(1),
  reviewLine: ReviewLineSchema,
  stopConditions: z.array(StopConditionSchema).min(1),
});

const DerivedSignalsSchema = z.object({
  observedRangePct: z.number().nonnegative(),
  dataAgeMinutes: z.number().nonnegative(),
  volatilityAboveLossTolerance: z.boolean(),
  rangeAboveMoveTolerance: z.boolean(),
  relativeVolumeElevated: z.boolean(),
});

export const ExecutionCoreSuccessSchema = z.object({
  ok: z.literal(true),
  status: z.literal("READY_FOR_REVIEW"),
  plans: z.array(ExecutionPlanSchema).min(2).max(3),
  preferredPlanId: z.enum(["ONE_SHOT", "STAGED_2", "STAGED_3"]),
  selectedBy: z.literal("DETERMINISTIC_CORE"),
  rationaleKeys: z
    .array(
      z.enum([
        "PRICE_MOVE_REGRET",
        "MISSED_OPPORTUNITY_REGRET",
        "RISK_ABOVE_TOLERANCE",
        "RISK_WITHIN_TOLERANCE",
        "SHORT_DEADLINE",
        "ENOUGH_TIME_TO_STAGE",
      ]),
    )
    .min(2),
  preferredExplanation: z.string().min(1),
  signals: DerivedSignalsSchema,
  limits: z.object({
    predictsFuturePrice: z.literal(false),
    executesOrder: z.literal(false),
    selectsSecurity: z.literal(false),
  }),
});

export const ExecutionCoreFailureCodeSchema = z.enum([
  "INVALID_INPUT",
  "MARKET_DATA_STALE",
  "MARKET_DATA_FRESHNESS_UNKNOWN",
  "INSUFFICIENT_EXECUTABLE_QUANTITY",
  "UNSAFE_NUMERIC_RANGE",
]);

export const ExecutionCoreFailureSchema = z.object({
  ok: z.literal(false),
  status: z.literal("SAFETY_PAUSE"),
  failureCode: ExecutionCoreFailureCodeSchema,
  reasons: z.array(
    z.object({
      path: z.string(),
      message: z.string().min(1),
    }),
  ),
});

export const ExecutionCoreResultSchema = z.union([
  ExecutionCoreSuccessSchema,
  ExecutionCoreFailureSchema,
]);

export const ExecutionDecisionSchema = ExecutionCoreResultSchema;
export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;
export type ExecutionCoreSuccess = z.infer<typeof ExecutionCoreSuccessSchema>;
export type ExecutionCoreFailure = z.infer<typeof ExecutionCoreFailureSchema>;
export type ExecutionCoreResult = z.infer<typeof ExecutionCoreResultSchema>;
export type ExecutionDecision = ExecutionCoreResult;
