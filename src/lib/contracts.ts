import { z } from "zod";

export const IntentSchema = z.enum(["BUY", "SELL", "UNSURE"]);
export const PurposeKindSchema = z.enum([
  "LONG_TERM_GROWTH",
  "CASH_NEED",
  "RISK_REDUCTION",
  "OTHER",
  "UNKNOWN",
]);
export const HorizonSchema = z.enum([
  "DAYS",
  "WEEKS",
  "MONTHS",
  "YEARS",
  "UNKNOWN",
]);
export const UrgencySchema = z.enum([
  "NOW",
  "TODAY",
  "THIS_WEEK",
  "NO_RUSH",
]);

export const EvidenceIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const UserEvidenceInputSchema = z.object({
  id: EvidenceIdSchema,
  statement: z.string().min(1).max(1_200),
  sourceLabel: z.string().min(1).max(300),
  observedAt: z.string().max(100).nullable(),
});

export const ActionPlanInputSchema = z
  .object({
    subjectLabel: z.string().trim().min(1).max(200),
    intent: IntentSchema,
    purpose: z.object({
      kind: PurposeKindSchema,
      note: z.string().max(600),
    }),
    horizon: HorizonSchema,
    urgency: UrgencySchema,
    constraints: z.array(z.string().min(1).max(500)).max(12),
    userEvidence: z.array(UserEvidenceInputSchema).max(12),
  })
  .superRefine((input, context) => {
    const seen = new Set<string>();
    input.userEvidence.forEach((evidence, index) => {
      if (seen.has(evidence.id)) {
        context.addIssue({
          code: "custom",
          message: "evidence ID는 입력 안에서 고유해야 합니다.",
          path: ["userEvidence", index, "id"],
        });
      }
      seen.add(evidence.id);
    });
  });

export type ActionPlanInput = z.infer<typeof ActionPlanInputSchema>;
export const PlannerInputSchema = ActionPlanInputSchema;
export type PlannerInput = ActionPlanInput;

export const RequestedGenerationModeSchema = z.enum(["LIVE", "OFFLINE_DEMO"]);
export type RequestedGenerationMode = z.infer<
  typeof RequestedGenerationModeSchema
>;

export const PlanRequestSchema = z.object({
  mode: RequestedGenerationModeSchema,
  input: ActionPlanInputSchema,
  baselineInput: ActionPlanInputSchema.optional(),
});
export type PlanRequest = z.infer<typeof PlanRequestSchema>;

export const ActionPlanStatusSchema = z.enum([
  "READY_FOR_REVIEW",
  "NEEDS_INFO",
  "SAFETY_PAUSE",
]);

export const FinalChoiceSchema = z.enum([
  "REVIEW_MORE",
  "ADD_INFORMATION",
  "PAUSE",
]);

export const MISSING_INFORMATION = "MISSING_INFORMATION" as const;
export const EvidenceReferenceSchema = z.string().trim().min(1).max(100);

export const CounterfactualDeltaSchema = z.object({
  fieldPath: z.string().trim().min(1),
  changedAssumption: z.string().trim().min(1),
  from: z.string(),
  to: z.string(),
  impact: z.string().trim().min(1),
});

export const ActionPlanSchema = z.object({
  status: ActionPlanStatusSchema,
  currentSituation: z.object({
    intentSummary: z.string(),
    confirmedFacts: z.array(
      z.object({
        statement: z.string(),
        basis: z.literal("USER_PROVIDED"),
        verification: z.literal("NOT_INDEPENDENTLY_VERIFIED"),
      }),
    ),
  }),
  userEvidence: z.array(
    z.object({
      id: EvidenceIdSchema,
      statement: z.string(),
      sourceLabel: z.string(),
      observedAt: z.string().nullable(),
      basis: z.literal("USER_PROVIDED"),
      verification: z.literal("NOT_INDEPENDENTLY_VERIFIED"),
    }),
  ),
  reasons: z.array(z.string().trim().min(1)).min(1),
  uncertainties: z.array(z.string().trim().min(1)).min(1),
  orderedChecks: z.array(
    z.object({
      order: z.number().int(),
      check: z.string().trim().min(1),
      why: z.string().trim().min(1),
      howToVerify: z.string().trim().min(1),
      doneWhen: z.string().trim().min(1),
      evidenceRefs: z.array(EvidenceReferenceSchema).min(1),
    }),
  ),
  decisionGates: z.array(
    z.object({
      question: z.string().trim().min(1),
      passCondition: z.string().trim().min(1),
      onPass: z.string().trim().min(1),
      onFail: z.string().trim().min(1),
      evidenceRefs: z.array(EvidenceReferenceSchema).min(1),
    }),
  ),
  stopConditions: z
    .array(
      z.object({
        trigger: z.string().trim().min(1),
        reason: z.string().trim().min(1),
        resumeWhen: z.string().trim().min(1),
      }),
    )
    .min(1),
  counterfactuals: z.array(CounterfactualDeltaSchema).length(1),
  nextQuestions: z.array(z.string().trim().min(1)).max(3),
  finalChoice: z.object({
    prompt: z.string().trim().min(1),
    options: z.array(FinalChoiceSchema).min(1).max(3),
  }),
});

export type ActionPlan = z.infer<typeof ActionPlanSchema>;
export const ActionPlanCardSchema = ActionPlanSchema;
export type ActionPlanCard = ActionPlan;
export type CounterfactualDelta = z.infer<typeof CounterfactualDeltaSchema>;

export const GenerationModeSchema = z.enum([
  "LIVE",
  "OFFLINE_DEMO",
  "NOT_CALLED",
]);
export const GenerationOutcomeSchema = z.enum([
  "SUCCESS",
  "FAILURE",
  "SKIPPED",
]);
export const FailureCodeSchema = z.enum([
  "INVALID_JSON",
  "INVALID_INPUT",
  "MISSING_CONFIGURATION",
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
export type FailureCode = z.infer<typeof FailureCodeSchema>;

export const SafetyOverrideSchema = z.enum([
  "MISSING_CRITICAL_INPUT",
  "URGENT_WITHOUT_EVIDENCE",
  "SOURCE_CONFLICT",
  "CONSTRAINT_CONFLICT",
  "COUNTERFACTUAL_MISMATCH",
  "ORPHAN_EVIDENCE_REFERENCE",
  "FORBIDDEN_REQUEST",
  "FORBIDDEN_CONTENT",
  "STATE_NORMALIZED",
]);
export type SafetyOverride = z.infer<typeof SafetyOverrideSchema>;

const LiveSuccessGenerationSchema = z.object({
  requestedMode: z.literal("LIVE"),
  mode: z.literal("LIVE"),
  outcome: z.literal("SUCCESS"),
  failureCode: z.null(),
  fixtureId: z.null(),
  fixtureVersion: z.null(),
});

const LiveFailureGenerationSchema = z.object({
  requestedMode: z.literal("LIVE"),
  mode: z.literal("LIVE"),
  outcome: z.literal("FAILURE"),
  failureCode: FailureCodeSchema,
  fixtureId: z.null(),
  fixtureVersion: z.null(),
});

const OfflineSuccessGenerationSchema = z.object({
  requestedMode: z.literal("OFFLINE_DEMO"),
  mode: z.literal("OFFLINE_DEMO"),
  outcome: z.literal("SUCCESS"),
  failureCode: z.null(),
  fixtureId: z.string().trim().min(1),
  fixtureVersion: z.string().trim().min(1),
});

const LiveSkippedGenerationSchema = z.object({
  requestedMode: z.literal("LIVE"),
  mode: z.literal("NOT_CALLED"),
  outcome: z.literal("SKIPPED"),
  failureCode: FailureCodeSchema.nullable(),
  fixtureId: z.null(),
  fixtureVersion: z.null(),
});

const OfflineSkippedGenerationSchema = z.object({
  requestedMode: z.literal("OFFLINE_DEMO"),
  mode: z.literal("NOT_CALLED"),
  outcome: z.literal("SKIPPED"),
  failureCode: FailureCodeSchema.nullable(),
  fixtureId: z.string().trim().min(1),
  fixtureVersion: z.string().trim().min(1),
});

export const GenerationSchema = z.union([
  LiveSuccessGenerationSchema,
  LiveFailureGenerationSchema,
  OfflineSuccessGenerationSchema,
  LiveSkippedGenerationSchema,
  OfflineSkippedGenerationSchema,
]);

export const PlanEnvelopeSchema = z.object({
  generation: GenerationSchema,
  safetyOverride: SafetyOverrideSchema.nullable(),
  plan: ActionPlanSchema,
});

export type Generation = z.infer<typeof GenerationSchema>;
export type PlanEnvelope = z.infer<typeof PlanEnvelopeSchema>;
