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

function fail(
  failureCode: z.infer<typeof ExecutionCoreFailureCodeSchema>,
  reasons: Array<{ path: string; message: string }>,
): ExecutionCoreFailure {
  return {
    ok: false,
    status: "SAFETY_PAUSE",
    failureCode,
    reasons,
  };
}

function roundPercent(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function roundPrice(value: number): number {
  return Math.max(0, Math.round(value));
}

function distributeLots(
  totalLots: number,
  weights: number[],
  lotSize: number,
): number[] {
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const rawLots = weights.map((weight) => (totalLots * weight) / weightTotal);
  const allocatedLots = rawLots.map(Math.floor);
  let remainderLots =
    totalLots - allocatedLots.reduce((sum, lots) => sum + lots, 0);
  const remainderOrder = rawLots
    .map((raw, index) => ({ index, remainder: raw - Math.floor(raw) }))
    .sort((left, right) =>
      right.remainder === left.remainder
        ? left.index - right.index
        : right.remainder - left.remainder,
    );

  for (const allocation of remainderOrder) {
    if (remainderLots === 0) break;
    allocatedLots[allocation.index] += 1;
    remainderLots -= 1;
  }

  return allocatedLots.map((lots) => lots * lotSize);
}

function allocationWeights(
  installmentCount: number,
  primaryRegret: RegretBudgetExecutionInput["primaryRegret"],
  riskAboveTolerance: boolean,
): number[] {
  if (installmentCount === 1) return [1];
  if (primaryRegret === "PRICE_MOVE") {
    return Array.from({ length: installmentCount }, () => 1);
  }
  if (installmentCount === 2) {
    return riskAboveTolerance ? [0.55, 0.45] : [0.65, 0.35];
  }
  return riskAboveTolerance ? [0.4, 0.35, 0.25] : [0.5, 0.3, 0.2];
}

function commonConditions(installmentCount: number) {
  const conditions: z.infer<typeof PlanConditionSchema>[] = [
    {
      code: "INPUT_UNCHANGED",
      check: "예산·보유수량·실행기한과 감당 범위를 다시 확인합니다.",
      passWhen: "처음 입력한 조건이 그대로일 때만 이 안을 검토합니다.",
    },
    {
      code: "DATA_STILL_FRESH",
      check: "각 실행을 검토하기 전에 시장 데이터 기준시각을 확인합니다.",
      passWhen: "데이터가 허용된 최신성 범위 안에 있을 때만 진행합니다.",
    },
  ];

  if (installmentCount > 1) {
    conditions.push({
      code: "WITHIN_REVIEW_BAND",
      check: "다음 회차 전에 현재 가격이 재검토 범위 안인지 확인합니다.",
      passWhen: "가격이 재검토 범위 안이고 중단 조건이 없을 때만 다음 회차를 검토합니다.",
    });
  }

  return conditions;
}

function commonStopConditions(
  lowerReviewPriceKrw: number,
  upperReviewPriceKrw: number,
  lossTolerancePriceKrw: number,
) {
  return [
    {
      code: "DATA_BECOMES_STALE" as const,
      trigger: "시장 데이터가 허용된 최신성 범위를 벗어났을 때",
      reason: "오래된 가격으로 실행안을 이어가면 현재 상황과 어긋날 수 있습니다.",
      resumeWhen: "같은 출처의 새 데이터를 검증하고 지표를 다시 계산했을 때",
    },
    {
      code: "PRICE_OUTSIDE_REVIEW_BAND" as const,
      trigger: `확인 가격이 ${lowerReviewPriceKrw.toLocaleString("ko-KR")}원 미만 또는 ${upperReviewPriceKrw.toLocaleString("ko-KR")}원 초과일 때`,
      reason: "사용자가 입력한 감당 가능한 변동 범위를 벗어났습니다.",
      resumeWhen: "새 가격 기준으로 허용범위와 실행안을 다시 계산했을 때",
    },
    {
      code: "LOSS_TOLERANCE_REACHED" as const,
      trigger: `확인 가격이 손실 감당 범위로 계산한 ${lossTolerancePriceKrw.toLocaleString("ko-KR")}원 이하일 때`,
      reason: "사용자가 정한 손실 감당 범위에 닿았습니다.",
      resumeWhen: "사용자가 감당 범위를 다시 확인하고 새 기준으로 계획을 만들었을 때",
    },
    {
      code: "INPUT_OR_DEADLINE_CHANGED" as const,
      trigger: "예산·보유수량·우려·감당 범위 또는 실행기한이 바뀌었을 때",
      reason: "이 실행안은 기존 입력에만 맞춰 계산됐습니다.",
      resumeWhen: "변경된 입력으로 모든 수량과 조건을 다시 계산했을 때",
    },
  ];
}

function buildPlan(params: {
  id: "ONE_SHOT" | "STAGED_2" | "STAGED_3";
  installmentCount: number;
  totalLots: number;
  lotSize: number;
  latestClose: number;
  unallocatedBudgetKrw: number | null;
  remainingHoldingQuantity: number | null;
  reviewLine: z.infer<typeof ReviewLineSchema>;
  primaryRegret: RegretBudgetExecutionInput["primaryRegret"];
  riskAboveTolerance: boolean;
}): ExecutionPlan {
  const quantities = distributeLots(
    params.totalLots,
    allocationWeights(
      params.installmentCount,
      params.primaryRegret,
      params.riskAboveTolerance,
    ),
    params.lotSize,
  );
  const allocations = quantities.map((quantity, index) => ({
    sequence: index + 1,
    shares: quantity,
    amountKrw: quantity * params.latestClose,
    condition: index === 0 ? ("INITIAL_REVIEW" as const) : ("RECHECK_REQUIRED" as const),
  }));
  const isOneShot = params.installmentCount === 1;

  return {
    id: params.id,
    installmentCount: params.installmentCount,
    allocations,
    totalShares: quantities.reduce((sum, quantity) => sum + quantity, 0),
    referenceTotalAmountKrw: allocations.reduce(
      (sum, allocation) => sum + allocation.amountKrw,
      0,
    ),
    unallocatedBudgetKrw: params.unallocatedBudgetKrw,
    remainingHoldingQuantity: params.remainingHoldingQuantity,
    benefits: [
      isOneShot
        ? "여러 회차를 기다리는 동안 일부 수량이 남는 부담을 줄입니다."
        : "한 시점 가격에 전체 수량이 노출되는 부담을 여러 번으로 나눕니다.",
    ],
    tradeoffs: [
      isOneShot
        ? "전체 수량이 한 시점의 확인 가격에 영향을 받습니다."
        : "다음 회차 전에 가격이 움직이면 처음 계산한 수량 계획을 끝내지 못할 수 있습니다.",
    ],
    conditions: commonConditions(params.installmentCount),
    reviewLine: params.reviewLine,
    stopConditions: commonStopConditions(
      params.reviewLine.lowerReviewPriceKrw,
      params.reviewLine.upperReviewPriceKrw,
      params.reviewLine.lossTolerancePriceKrw,
    ),
  };
}

function choosePreferredPlan(params: {
  input: RegretBudgetExecutionInput;
  plans: ExecutionPlan[];
  riskAboveTolerance: boolean;
}) {
  const { input, plans, riskAboveTolerance } = params;
  const hasThreeStages = plans.some((plan) => plan.id === "STAGED_3");
  const hasTimeToStage =
    input.deadline === "THIS_WEEK" || input.deadline === "NO_RUSH";

  if (input.primaryRegret === "MISSED_OPPORTUNITY") {
    return {
      preferredPlanId: "ONE_SHOT" as const,
      selectedBy: "DETERMINISTIC_CORE" as const,
      rationaleKeys: [
        "MISSED_OPPORTUNITY_REGRET" as const,
        riskAboveTolerance
          ? ("RISK_ABOVE_TOLERANCE" as const)
          : ("RISK_WITHIN_TOLERANCE" as const),
        hasTimeToStage
          ? ("ENOUGH_TIME_TO_STAGE" as const)
          : ("SHORT_DEADLINE" as const),
      ],
      preferredExplanation:
        "기다리는 동안 가격이 올라 기회를 놓치는 상황을 더 걱정한다고 답했습니다. 그래서 한 번에 확인하는 방법을 먼저 보여드립니다. 수익을 예상해서 고른 것은 아닙니다.",
    };
  }

  const useThreeStages = riskAboveTolerance && hasTimeToStage && hasThreeStages;
  return {
    preferredPlanId: useThreeStages
      ? ("STAGED_3" as const)
      : ("STAGED_2" as const),
    selectedBy: "DETERMINISTIC_CORE" as const,
    rationaleKeys: [
      "PRICE_MOVE_REGRET" as const,
      riskAboveTolerance
        ? ("RISK_ABOVE_TOLERANCE" as const)
        : ("RISK_WITHIN_TOLERANCE" as const),
      hasTimeToStage
        ? ("ENOUGH_TIME_TO_STAGE" as const)
        : ("SHORT_DEADLINE" as const),
    ],
    preferredExplanation: useThreeStages
      ? "한 번에 확인한 뒤 가격이 내려가는 상황을 더 걱정한다고 답했습니다. 최근 가격 움직임도 내가 정한 감당 범위보다 컸습니다. 그래서 세 번으로 나누는 방법을 먼저 보여드립니다."
      : "한 번에 확인한 뒤 가격이 내려가는 상황을 더 걱정한다고 답했습니다. 그래서 두 번으로 나누는 방법을 먼저 보여드립니다.",
  };
}

export function calculateRegretBudgetExecution(
  rawInput: unknown,
): ExecutionCoreResult {
  const parsed = RegretBudgetExecutionInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return fail(
      "INVALID_INPUT",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  const input = parsed.data;
  const freshness = input.market.freshness;
  const ageMinutes =
    (Date.parse(freshness.checkedAt) - Date.parse(freshness.asOf)) / 60_000;

  if (freshness.status === "UNKNOWN") {
    return fail("MARKET_DATA_FRESHNESS_UNKNOWN", [
      {
        path: "market.freshness.status",
        message: "시장 데이터 기준시각을 확인할 수 없습니다.",
      },
    ]);
  }
  if (
    freshness.status === "STALE" ||
    ageMinutes > freshness.maxAgeMinutes
  ) {
    return fail("MARKET_DATA_STALE", [
      {
        path: "market.freshness",
        message: "시장 데이터가 허용된 최신성 범위를 벗어났습니다.",
      },
    ]);
  }

  const sourceQuantity =
    input.direction === "BUY"
      ? Math.floor(input.budgetKrw / input.market.latestClose)
      : input.holdingQuantity;
  const executableQuantity =
    Math.floor(sourceQuantity / input.lotSize) * input.lotSize;
  const totalLots = executableQuantity / input.lotSize;

  if (totalLots < 2) {
    return fail("INSUFFICIENT_EXECUTABLE_QUANTITY", [
      {
        path: input.direction === "BUY" ? "budgetKrw" : "holdingQuantity",
        message:
          "일괄안과 분할안을 함께 비교하려면 최소 두 거래단위가 필요합니다.",
      },
    ]);
  }

  const referenceTotalAmountKrw =
    executableQuantity * input.market.latestClose;
  if (!Number.isSafeInteger(referenceTotalAmountKrw)) {
    return fail("UNSAFE_NUMERIC_RANGE", [
      {
        path: "market.latestClose",
        message: "정확한 금액 계산이 가능한 범위를 벗어났습니다.",
      },
    ]);
  }

  const observedRangePct = roundPercent(
    ((input.market.rangeHigh - input.market.rangeLow) /
      input.market.latestClose) *
      100,
  );
  const volatilityAboveLossTolerance =
    input.market.volatility20dPct > input.maxLossPercent;
  const rangeAboveMoveTolerance = observedRangePct > input.maxMovePercent;
  const relativeVolumeElevated = input.market.relativeVolume >= 1.5;
  const riskAboveTolerance =
    volatilityAboveLossTolerance || rangeAboveMoveTolerance;

  const lowerReviewPriceKrw = roundPrice(
    input.market.latestClose * (1 - input.maxMovePercent / 100),
  );
  const upperReviewPriceKrw = roundPrice(
    input.market.latestClose * (1 + input.maxMovePercent / 100),
  );
  const lossTolerancePriceKrw = roundPrice(
    input.market.latestClose * (1 - input.maxLossPercent / 100),
  );
  const reviewLine = {
    referencePriceKrw: input.market.latestClose,
    lowerReviewPriceKrw,
    upperReviewPriceKrw,
    lossTolerancePriceKrw,
    movePercent: input.maxMovePercent,
    lossPercent: input.maxLossPercent,
    meaning:
      "이 가격 범위는 미래 예측이나 자동 주문 조건이 아닙니다. 내가 입력한 허용 범위를 벗어나면 계획을 다시 확인하라는 기준입니다.",
  };
  const unallocatedBudgetKrw =
    input.direction === "BUY"
      ? input.budgetKrw - referenceTotalAmountKrw
      : null;
  const remainingHoldingQuantity =
    input.direction === "SELL"
      ? input.holdingQuantity - executableQuantity
      : null;

  const plans: ExecutionPlan[] = [
    buildPlan({
      id: "ONE_SHOT",
      installmentCount: 1,
      totalLots,
      lotSize: input.lotSize,
      latestClose: input.market.latestClose,
      unallocatedBudgetKrw,
      remainingHoldingQuantity,
      reviewLine,
      primaryRegret: input.primaryRegret,
      riskAboveTolerance,
    }),
    buildPlan({
      id: "STAGED_2",
      installmentCount: 2,
      totalLots,
      lotSize: input.lotSize,
      latestClose: input.market.latestClose,
      unallocatedBudgetKrw,
      remainingHoldingQuantity,
      reviewLine,
      primaryRegret: input.primaryRegret,
      riskAboveTolerance,
    }),
  ];

  if (totalLots >= 3) {
    plans.push(
      buildPlan({
        id: "STAGED_3",
        installmentCount: 3,
        totalLots,
        lotSize: input.lotSize,
        latestClose: input.market.latestClose,
        unallocatedBudgetKrw,
        remainingHoldingQuantity,
        reviewLine,
        primaryRegret: input.primaryRegret,
        riskAboveTolerance,
      }),
    );
  }

  return {
    ok: true,
    status: "READY_FOR_REVIEW",
    plans,
    ...choosePreferredPlan({
      input,
      plans,
      riskAboveTolerance,
    }),
    signals: {
      observedRangePct,
      dataAgeMinutes: roundPercent(ageMinutes),
      volatilityAboveLossTolerance,
      rangeAboveMoveTolerance,
      relativeVolumeElevated,
    },
    limits: {
      predictsFuturePrice: false,
      executesOrder: false,
      selectsSecurity: false,
    },
  };
}

export const computeExecutionDecision = calculateRegretBudgetExecution;
