import { z } from "zod";

import { ExecutionCoreSuccessSchema } from "./execution-core";

export const DecisionIntentSchema = z.enum(["BUY", "SELL"]);
export const DecisionDeadlineSchema = z.enum([
  "NOW",
  "TODAY",
  "THIS_WEEK",
  "NO_RUSH",
]);
export const RegretPrioritySchema = z.enum([
  "PRICE_RISK",
  "MISSED_OPPORTUNITY",
]);

export const DecisionConversationInputSchema = z
  .object({
    subjectLabel: z.string().trim().min(1).max(100),
    symbol: z
      .string()
      .trim()
      .toUpperCase()
      .min(1)
      .max(24)
      .regex(/^[A-Z0-9.^=-]+$/),
    intent: DecisionIntentSchema,
    budgetKrw: z.number().finite().int().positive().max(10_000_000_000).nullable(),
    holdingQuantity: z.number().finite().int().positive().max(100_000_000).nullable(),
    deadline: DecisionDeadlineSchema,
    regretPriority: RegretPrioritySchema,
    maxAdverseMovePct: z.number().finite().min(0.5).max(30),
  })
  .superRefine((input, context) => {
    if (input.intent === "BUY" && input.budgetKrw === null) {
      context.addIssue({
        code: "custom",
        path: ["budgetKrw"],
        message: "매수 고민에는 사용할 예산이 필요합니다.",
      });
    }
    if (input.intent === "SELL" && input.holdingQuantity === null) {
      context.addIssue({
        code: "custom",
        path: ["holdingQuantity"],
        message: "매도 고민에는 현재 보유수량이 필요합니다.",
      });
    }
    if (input.intent === "BUY" && input.holdingQuantity !== null) {
      context.addIssue({
        code: "custom",
        path: ["holdingQuantity"],
        message: "매수 입력에는 보유수량을 함께 보내지 않습니다.",
      });
    }
    if (input.intent === "SELL" && input.budgetKrw !== null) {
      context.addIssue({
        code: "custom",
        path: ["budgetKrw"],
        message: "매도 입력에는 예산을 함께 보내지 않습니다.",
      });
    }
  });

export type DecisionConversationInput = z.infer<
  typeof DecisionConversationInputSchema
>;

export const DecisionPlanIdSchema = z.enum([
  "ONE_SHOT",
  "STAGED_2",
  "STAGED_3",
]);

export const NextQuestionKeySchema = z.enum([
  "NONE",
  "CONFIRM_DEADLINE",
  "CONFIRM_TOLERANCE",
  "CONFIRM_REGRET_PRIORITY",
]);

export const AgentDecisionExplanationSchema = z.object({
  understoodConcern: z.string().trim().min(1).max(500),
  oneShotBenefit: z.string().trim().min(1).max(500),
  oneShotRisk: z.string().trim().min(1).max(500),
  stagedBenefit: z.string().trim().min(1).max(500),
  stagedRisk: z.string().trim().min(1).max(500),
  priorityPlanId: DecisionPlanIdSchema,
  priorityReason: z.string().trim().min(1).max(700),
  nextQuestionKey: NextQuestionKeySchema,
});

export type AgentDecisionExplanation = z.infer<
  typeof AgentDecisionExplanationSchema
>;

export const DecisionRequestSchema = z.object({
  mode: z.literal("LIVE"),
  input: DecisionConversationInputSchema,
});

export type DecisionRequest = z.infer<typeof DecisionRequestSchema>;

export const DecisionFailureCodeSchema = z.enum([
  "INVALID_INPUT",
  "DATA_PROVIDER_FAILURE",
  "DATA_SCHEMA_FAILURE",
  "DATA_INSUFFICIENT",
  "DATA_STALE",
  "CORE_DECISION_FAILURE",
  "MISSING_CONFIGURATION",
  "AUTHENTICATION",
  "MODEL_ACCESS",
  "QUOTA_OR_RATE_LIMIT",
  "NETWORK",
  "TIMEOUT",
  "UPSTREAM_ERROR",
  "REFUSAL",
  "INCOMPLETE",
  "PARSE_ERROR",
  "SCHEMA_ERROR",
  "SEMANTIC_GUARD",
  "CLIENT_NETWORK_ERROR",
  "CLIENT_RESPONSE_ERROR",
]);

export type DecisionFailureCode = z.infer<typeof DecisionFailureCodeSchema>;

export const DecisionGenerationSchema = z.object({
  requestedMode: z.enum(["LIVE", "OFFLINE_DEMO"]),
  mode: z.enum(["LIVE", "OFFLINE_DEMO", "NOT_CALLED"]),
  outcome: z.enum(["SUCCESS", "FAILURE", "SKIPPED"]),
  failureCode: DecisionFailureCodeSchema.nullable(),
  fixtureId: z.string().trim().min(1).nullable(),
  fixtureVersion: z.string().trim().min(1).nullable(),
  model: z.string().trim().min(1).nullable(),
});

export const DecisionMarketSnapshotSchema = z.object({
  symbol: z.string().trim().min(1),
  provider: z.string().trim().min(1),
  sourceUrl: z.string().url().nullable(),
  fetchedAt: z.string().datetime(),
  asOf: z.string().datetime(),
  range: z.string().trim().min(1),
  interval: z.string().trim().min(1),
  delayNotice: z.string().trim().min(1),
  synthetic: z.boolean(),
  currency: z.string().nullable(),
  exchange: z.string().nullable(),
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

export type DecisionMarketSnapshot = z.infer<
  typeof DecisionMarketSnapshotSchema
>;

export const DecisionMarketLayerSchema = z.object({
  mode: z.enum(["YAHOO_LIVE", "SYNTHETIC_FIXTURE", "NOT_CALLED"]),
  outcome: z.enum(["SUCCESS", "FAILURE", "SKIPPED"]),
  failureCode: z
    .enum([
      "DATA_PROVIDER_FAILURE",
      "DATA_SCHEMA_FAILURE",
      "DATA_INSUFFICIENT",
      "DATA_STALE",
    ])
    .nullable(),
  snapshot: DecisionMarketSnapshotSchema.nullable(),
});

export const DecisionEnvelopeSchema = z.object({
  status: z.enum(["READY_FOR_REVIEW", "SAFETY_PAUSE"]),
  generation: DecisionGenerationSchema,
  market: DecisionMarketLayerSchema,
  inputSnapshot: DecisionConversationInputSchema.nullable(),
  decision: ExecutionCoreSuccessSchema.nullable(),
  explanation: AgentDecisionExplanationSchema.nullable(),
  failureMessage: z.string().trim().min(1).nullable(),
});

export type DecisionEnvelope = z.infer<typeof DecisionEnvelopeSchema>;
