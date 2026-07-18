import { z } from "zod";

import { ExecutionCoreSuccessSchema } from "@/lib/execution-core";

export const AdversarialFactIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Z][A-Z0-9_-]*$/, "근거 식별자 형식이 올바르지 않습니다.");

export const AdversarialConcernModeSchema = z.enum([
  "PRE_BUY",
  "HOLDING_ANXIETY",
  "SELL_TIMING",
]);

export const AdversarialIntentSchema = z.enum(["BUY", "SELL"]);

export const AdversarialConstraintValueSchema = z.union([
  z.string().trim().min(1).max(300),
  z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000),
  z.boolean(),
  z.null(),
]);

export const AdversarialUserConstraintSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .regex(/^[A-Z][A-Z0-9_]*$/),
    label: z.string().trim().min(1).max(100),
    value: AdversarialConstraintValueSchema,
  })
  .strict();

export const AdversarialUserInputSchema = z
  .object({
    concernMode: AdversarialConcernModeSchema,
    intent: AdversarialIntentSchema,
    constraints: z
      .array(AdversarialUserConstraintSchema)
      .min(1)
      .max(20),
  })
  .strict()
  .superRefine((input, context) => {
    const keys = input.constraints.map((constraint) => constraint.key);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        path: ["constraints"],
        message: "사용자 입력 식별자는 중복될 수 없습니다.",
      });
    }
  });

export const AdversarialMarketFactSchema = z
  .object({
    id: AdversarialFactIdSchema,
    label: z.string().trim().min(1).max(120),
    observation: z.string().trim().min(1).max(500),
    sourceLabel: z.string().trim().min(1).max(120),
  })
  .strict();

export const AdversarialQuestionKeySchema = z.enum([
  "CONFIRM_REGRET_PRIORITY",
  "CONFIRM_DEADLINE",
  "CONFIRM_LOSS_TOLERANCE",
  "CONFIRM_ORDER_PRIORITY",
  "CONFIRM_HOLDING_HORIZON",
  "CONFIRM_EXIT_STYLE",
]);

export type AdversarialQuestionKey = z.infer<
  typeof AdversarialQuestionKeySchema
>;

export const AdversarialAnswerKeySchema = z.enum([
  "PRICE_RISK",
  "MISSED_OPPORTUNITY",
  "NOW",
  "TODAY",
  "THIS_WEEK",
  "NO_RUSH",
  "TIGHTER",
  "KEEP_CURRENT",
  "WIDER",
  "FAST_EXECUTION",
  "PRICE_CONTROL",
  "UNSURE",
  "DAYS",
  "WEEKS",
  "MONTHS",
  "YEARS",
  "ONE_SHOT",
  "STAGED",
]);

export type AdversarialAnswerKey = z.infer<
  typeof AdversarialAnswerKeySchema
>;

export const AdversarialReviewRequestSchema = z
  .object({
    mode: z.literal("LIVE"),
    subjectLabel: z.string().trim().min(1).max(100),
    symbol: z
      .string()
      .trim()
      .toUpperCase()
      .min(1)
      .max(24)
      .regex(/^[A-Z0-9.^=-]+$/),
    userInput: AdversarialUserInputSchema,
    facts: z.array(AdversarialMarketFactSchema).min(1).max(20),
    currentPlan: ExecutionCoreSuccessSchema,
    dataContext: z
      .object({
        asOf: z.string().datetime({ offset: true }),
        fetchedAt: z.string().datetime({ offset: true }),
        limitations: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
      })
      .strict(),
    missingInformation: z
      .array(z.string().trim().min(1).max(300))
      .max(10),
    allowedQuestionKeys: z
      .array(AdversarialQuestionKeySchema)
      .min(1)
      .max(6),
  })
  .strict()
  .superRefine((request, context) => {
    const factIds = request.facts.map((fact) => fact.id);
    if (new Set(factIds).size !== factIds.length) {
      context.addIssue({
        code: "custom",
        path: ["facts"],
        message: "시장 근거 식별자는 중복될 수 없습니다.",
      });
    }

    if (
      new Set(request.allowedQuestionKeys).size !==
      request.allowedQuestionKeys.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["allowedQuestionKeys"],
        message: "허용 질문 키는 중복될 수 없습니다.",
      });
    }

    if (Date.parse(request.dataContext.fetchedAt) < Date.parse(request.dataContext.asOf)) {
      context.addIssue({
        code: "custom",
        path: ["dataContext", "fetchedAt"],
        message: "조회 시각은 데이터 기준시각보다 빠를 수 없습니다.",
      });
    }
  });

export type AdversarialReviewRequest = z.infer<
  typeof AdversarialReviewRequestSchema
>;

export const AdversarialCounterargumentSchema = z
  .object({
    argument: z.string().trim().min(1).max(500),
    factIds: z.array(AdversarialFactIdSchema).min(1).max(5),
  })
  .strict();

export const AdversarialReviewResultSchema = z
  .object({
    counterarguments: z
      .array(AdversarialCounterargumentSchema)
      .min(1)
      .max(3),
    unverifiedAssumption: z.string().trim().min(1).max(500),
    questionKey: AdversarialQuestionKeySchema,
    question: z.string().trim().min(1).max(300),
    whatWouldChangePlan: z.string().trim().min(1).max(500),
  })
  .strict();

export type AdversarialReviewResult = z.infer<
  typeof AdversarialReviewResultSchema
>;

export const AdversarialFailureCodeSchema = z.enum([
  "INVALID_INPUT",
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

export type AdversarialFailureCode = z.infer<
  typeof AdversarialFailureCodeSchema
>;

export const AdversarialReviewEnvelopeSchema = z
  .object({
    status: z.enum(["READY_FOR_REVIEW", "SAFETY_PAUSE"]),
    generation: z
      .object({
        requestedMode: z.literal("LIVE"),
        mode: z.enum(["LIVE", "NOT_CALLED"]),
        outcome: z.enum(["SUCCESS", "FAILURE", "SKIPPED"]),
        failureCode: AdversarialFailureCodeSchema.nullable(),
        model: z.string().trim().min(1).nullable(),
      })
      .strict(),
    inputSnapshot: AdversarialReviewRequestSchema.nullable(),
    result: AdversarialReviewResultSchema.nullable(),
    failureMessage: z.string().trim().min(1).nullable(),
  })
  .strict()
  .superRefine((envelope, context) => {
    const isSuccess = envelope.status === "READY_FOR_REVIEW";
    if (
      isSuccess &&
      (envelope.generation.mode !== "LIVE" ||
        envelope.generation.outcome !== "SUCCESS" ||
        envelope.generation.failureCode !== null ||
        envelope.result === null ||
        envelope.inputSnapshot === null ||
        envelope.failureMessage !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "성공 envelope의 provenance가 일치하지 않습니다.",
      });
    }

    if (
      !isSuccess &&
      (envelope.result !== null || envelope.generation.failureCode === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "안전 중단 envelope에는 결과가 없어야 합니다.",
      });
    }
  });

export type AdversarialReviewEnvelope = z.infer<
  typeof AdversarialReviewEnvelopeSchema
>;

export type AdversarialCoreAnswer = {
  questionKey: AdversarialQuestionKey;
  answerKey: AdversarialAnswerKey;
};
