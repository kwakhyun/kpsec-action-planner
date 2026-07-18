import { z } from "zod";

import {
  ExecutionCoreSuccessSchema,
  ExecutionDeadlineSchema,
} from "./execution-core";
import { MarketViewSchema } from "./market-view";

export const TradeConcernSchema = z.enum([
  "PRE_BUY",
  "HOLDING_ANXIETY",
  "SELL_TIMING",
]);

export const HoldingHorizonSchema = z.enum([
  "DAYS",
  "WEEKS",
  "MONTHS",
  "YEARS",
]);

export const SellPlanPreferenceSchema = z.enum([
  "FULL",
  "STAGED",
  "UNSURE",
]);

export const OrderStylePreferenceSchema = z.enum([
  "FAST_EXECUTION",
  "PRICE_CONTROL",
  "UNSURE",
]);

export const TradeRegretPrioritySchema = z.enum([
  "PRICE_RISK",
  "MISSED_OPPORTUNITY",
]);

export const ChartObservationIntervalSchema = z.enum([
  "ONE_MINUTE",
  "FIVE_MINUTES",
  "DAILY",
]);

const CommonCoachInputFields = {
  subjectLabel: z.string().trim().min(1).max(100),
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .min(1)
    .max(24)
    .regex(/^[A-Z0-9.^=-]+$/),
  deadline: ExecutionDeadlineSchema,
  horizon: HoldingHorizonSchema,
  maxLossPercent: z.number().finite().min(0.5).max(50),
  regretPriority: TradeRegretPrioritySchema,
  orderStylePreference: OrderStylePreferenceSchema,
  selectedChartInterval: ChartObservationIntervalSchema,
  market: MarketViewSchema,
};

const PreBuyCoachInputSchema = z
  .object({
    concern: z.literal("PRE_BUY"),
    budgetKrw: z.number().int().positive().max(1_000_000_000_000),
    averageCostKrw: z.null(),
    holdingQuantity: z.null(),
    profitCriterionPercent: z.null(),
    sellPlanPreference: z.null(),
    ...CommonCoachInputFields,
  })
  .strict();

const PositionCoachInputFields = {
  budgetKrw: z.null(),
  averageCostKrw: z
    .number()
    .int()
    .positive()
    .max(1_000_000_000),
  holdingQuantity: z.number().int().positive().max(1_000_000_000),
  profitCriterionPercent: z.number().finite().min(0.5).max(500).nullable(),
  sellPlanPreference: SellPlanPreferenceSchema,
};

const HoldingAnxietyCoachInputSchema = z
  .object({
    concern: z.literal("HOLDING_ANXIETY"),
    ...PositionCoachInputFields,
    ...CommonCoachInputFields,
  })
  .strict();

const SellTimingCoachInputSchema = z
  .object({
    concern: z.literal("SELL_TIMING"),
    ...PositionCoachInputFields,
    ...CommonCoachInputFields,
  })
  .strict();

export const TradeCoachInputSchema = z.discriminatedUnion("concern", [
  PreBuyCoachInputSchema,
  HoldingAnxietyCoachInputSchema,
  SellTimingCoachInputSchema,
]);

export type TradeCoachInput = z.infer<typeof TradeCoachInputSchema>;

const PositionEvaluationSchema = z
  .object({
    referenceAverageCostKrw: z.number().int().positive(),
    currentPriceKrw: z.number().int().positive(),
    quantity: z.number().int().positive(),
    investedAmountKrw: z.number().int().nonnegative(),
    currentValuationKrw: z.number().int().nonnegative(),
    profitLossAmountKrw: z.number().int(),
    profitLossPercent: z.number().finite(),
    direction: z.enum(["GAIN", "LOSS", "EVEN"]),
    meaning: z.string().trim().min(1),
  })
  .strict();

const UserReviewLineSchema = z
  .object({
    source: z.enum([
      "USER_LOSS_TOLERANCE",
      "USER_PROFIT_CRITERION",
    ]),
    percentFromAverageCost: z.number().finite(),
    reviewPriceKrw: z.number().int().nonnegative(),
    positionValueAtReviewKrw: z.number().int().nonnegative(),
    profitLossAmountAtReviewKrw: z.number().int(),
    meaning: z.string().trim().min(1),
  })
  .strict();

const ExecutionComparisonSchema = z
  .object({
    direction: z.enum(["BUY", "SELL"]),
    core: ExecutionCoreSuccessSchema,
    preferredPlanId: z.enum(["ONE_SHOT", "STAGED_2", "STAGED_3"]),
    selectionBasis: z.enum([
      "REGRET_BUDGET_CORE",
      "USER_FULL_PREFERENCE",
      "USER_STAGED_PREFERENCE",
      "CORE_COMPARISON_WHILE_UNSURE",
    ]),
    explanation: z.string().trim().min(1),
  })
  .strict();

export const OrderStyleCoachSchema = z
  .object({
    orderBookStatus: z.literal("NO_ORDER_BOOK"),
    preferredReviewStyle: z.enum([
      "MARKET_FIRST",
      "LIMIT_FIRST",
      "COMPARE_BOTH",
    ]),
    basedOn: z
      .object({
        deadline: ExecutionDeadlineSchema,
        preference: OrderStylePreferenceSchema,
      })
      .strict(),
    marketOrder: z
      .object({
        label: z.literal("시장가"),
        benefit: z.string().trim().min(1),
        tradeoff: z.string().trim().min(1),
      })
      .strict(),
    limitOrder: z
      .object({
        label: z.literal("지정가"),
        benefit: z.string().trim().min(1),
        tradeoff: z.string().trim().min(1),
      })
      .strict(),
    rationale: z.string().trim().min(1),
    limitPriceKrw: z.null(),
    estimatedSlippagePercent: z.null(),
    fillProbabilityPercent: z.null(),
    limitation: z.string().trim().min(1),
  })
  .strict();

export const TimeAxisCoachSchema = z
  .object({
    mismatchDetected: z.boolean(),
    observedInterval: ChartObservationIntervalSchema,
    plannedHorizon: HoldingHorizonSchema,
    deadline: ExecutionDeadlineSchema,
    observation: z.string().trim().min(1),
    actions: z
      .array(
        z
          .object({
            key: z.enum([
              "WIDEN_TO_DAILY",
              "REVIEW_ORIGINAL_PLAN",
              "KEEP_CURRENT_CHART",
            ]),
            label: z.string().trim().min(1),
          })
          .strict(),
      )
      .length(3),
    forcedChange: z.literal(false),
    limitation: z.string().trim().min(1),
  })
  .strict();

export const TradeCoachSuccessSchema = z
  .object({
    ok: z.literal(true),
    status: z.literal("READY_FOR_REVIEW"),
    concern: TradeConcernSchema,
    inputSnapshot: TradeCoachInputSchema,
    marketFacts: z
      .object({
        latestPrice: z
          .object({
            factId: z.literal("MARKET_LATEST_PRICE"),
            valueKrw: z.number().int().positive(),
          })
          .strict(),
        asOf: z
          .object({
            factId: z.literal("MARKET_AS_OF"),
            value: z.string().datetime(),
          })
          .strict(),
        sourceUrl: z.string().url(),
        synthetic: z.literal(false),
      })
      .strict(),
    position: PositionEvaluationSchema.nullable(),
    reviewLines: z
      .object({
        loss: UserReviewLineSchema.nullable(),
        profit: UserReviewLineSchema.nullable(),
      })
      .strict(),
    execution: ExecutionComparisonSchema,
    orderStyle: OrderStyleCoachSchema,
    timeAxis: TimeAxisCoachSchema,
    limits: z
      .object({
        predictsFuturePrice: z.literal(false),
        recommendsSecurity: z.literal(false),
        computesOptimalLimitPrice: z.literal(false),
        observesOrderBook: z.literal(false),
        executesOrder: z.literal(false),
      })
      .strict(),
  })
  .strict();

export const TradeCoachFailureSchema = z
  .object({
    ok: z.literal(false),
    status: z.literal("SAFETY_PAUSE"),
    failureCode: z.enum([
      "INVALID_INPUT",
      "UNSUPPORTED_MARKET_CURRENCY",
      "CORE_DECISION_FAILURE",
      "UNSAFE_NUMERIC_RANGE",
    ]),
    reasons: z
      .array(
        z
          .object({
            path: z.string(),
            message: z.string().trim().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const TradeCoachResultSchema = z.discriminatedUnion("ok", [
  TradeCoachSuccessSchema,
  TradeCoachFailureSchema,
]);

export type TradeCoachSuccess = z.infer<typeof TradeCoachSuccessSchema>;
export type TradeCoachFailure = z.infer<typeof TradeCoachFailureSchema>;
export type TradeCoachResult = z.infer<typeof TradeCoachResultSchema>;
