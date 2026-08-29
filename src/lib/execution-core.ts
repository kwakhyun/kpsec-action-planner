import {
  RegretBudgetExecutionInputSchema,
  type ExecutionCoreFailure,
  type ExecutionCoreResult,
  type ExecutionPlan,
  type RegretBudgetExecutionInput,
} from "./execution-core-contracts";

export * from "./execution-core-contracts";

function fail(
  failureCode: ExecutionCoreFailure["failureCode"],
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
  const conditions: ExecutionPlan["conditions"] = [
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
  reviewLine: ExecutionPlan["reviewLine"];
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
