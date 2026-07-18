import type { ExecutionPlan } from "./execution-core";
import { computeExecutionDecision } from "./execution-core";
import {
  OrderStyleCoachSchema,
  TimeAxisCoachSchema,
  TradeCoachFailureSchema,
  TradeCoachInputSchema,
  TradeCoachSuccessSchema,
  type TradeCoachFailure,
  type TradeCoachInput,
  type TradeCoachResult,
} from "./trade-coach-contracts";
import type { z } from "zod";

type OrderStyleCoach = z.infer<typeof OrderStyleCoachSchema>;
type TimeAxisCoach = z.infer<typeof TimeAxisCoachSchema>;

function fail(
  failureCode: TradeCoachFailure["failureCode"],
  reasons: TradeCoachFailure["reasons"],
): TradeCoachFailure {
  return TradeCoachFailureSchema.parse({
    ok: false,
    status: "SAFETY_PAUSE",
    failureCode,
    reasons,
  });
}

function roundPercent(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function safeMoney(value: number): number | null {
  const rounded = Math.round(value);
  return Number.isSafeInteger(rounded) ? rounded : null;
}

function buildOrderStyleCoach(
  input: TradeCoachInput,
): OrderStyleCoach {
  let preferredReviewStyle: OrderStyleCoach["preferredReviewStyle"];
  let rationale: string;

  if (input.orderStylePreference === "FAST_EXECUTION") {
    preferredReviewStyle = "MARKET_FIRST";
    rationale =
      "가격이 조금 달라질 수 있어도 빠르게 거래하려는 우선순위를 반영해 시장가를 먼저 비교합니다.";
  } else if (input.orderStylePreference === "PRICE_CONTROL") {
    preferredReviewStyle = "LIMIT_FIRST";
    rationale =
      "거래 속도보다 정한 가격을 지키려는 우선순위를 반영해 지정가를 먼저 비교합니다.";
  } else if (input.deadline === "NOW" || input.deadline === "TODAY") {
    preferredReviewStyle = "MARKET_FIRST";
    rationale =
      "주문 방식은 아직 정하지 않았지만 실행기한이 짧아 시장가의 빠른 체결 가능성을 먼저 확인합니다.";
  } else {
    preferredReviewStyle = "COMPARE_BOTH";
    rationale =
      "실행기한에 여유가 있고 주문 방식도 정하지 않아 시장가와 지정가의 차이를 함께 비교합니다.";
  }

  return {
    orderBookStatus: "NO_ORDER_BOOK",
    preferredReviewStyle,
    basedOn: {
      deadline: input.deadline,
      preference: input.orderStylePreference,
    },
    marketOrder: {
      label: "시장가",
      benefit: "현재 주문 상황에서 체결 가능성을 우선해 주문을 냅니다.",
      tradeoff: "주문을 누른 때와 실제 체결 가격이 달라질 수 있습니다.",
    },
    limitOrder: {
      label: "지정가",
      benefit: "사용자가 정한 가격 범위를 넘지 않도록 주문 가격을 통제합니다.",
      tradeoff: "상대 주문이 맞지 않으면 일부 또는 전부가 체결되지 않을 수 있습니다.",
    },
    rationale,
    limitPriceKrw: null,
    estimatedSlippagePercent: null,
    fillProbabilityPercent: null,
    limitation:
      "실시간 호가를 확인하지 않았습니다. 최적 지정가·예상 가격 차이·체결 가능성은 계산하지 않습니다.",
  };
}

const HORIZON_LABELS: Record<TradeCoachInput["horizon"], string> = {
  DAYS: "며칠",
  WEEKS: "몇 주",
  MONTHS: "몇 달",
  YEARS: "1년 이상",
};

const INTERVAL_LABELS: Record<
  TradeCoachInput["selectedChartInterval"],
  string
> = {
  ONE_MINUTE: "1분",
  FIVE_MINUTES: "5분",
  DAILY: "일봉",
};

function buildTimeAxisCoach(input: TradeCoachInput): TimeAxisCoach {
  const isIntraday = input.selectedChartInterval !== "DAILY";
  const planExtendsPastIntraday =
    input.horizon !== "DAYS" ||
    input.deadline === "THIS_WEEK" ||
    input.deadline === "NO_RUSH";
  const mismatchDetected = isIntraday && planExtendsPastIntraday;
  const horizonLabel = HORIZON_LABELS[input.horizon];
  const intervalLabel = INTERVAL_LABELS[input.selectedChartInterval];

  return {
    mismatchDetected,
    observedInterval: input.selectedChartInterval,
    plannedHorizon: input.horizon,
    deadline: input.deadline,
    observation: mismatchDetected
      ? `${horizonLabel} 보유할 계획인데 지금은 ${intervalLabel} 움직임을 보고 있어요. 아주 짧은 움직임이 원래 계획보다 크게 느껴질 수 있습니다.`
      : `지금 보는 ${intervalLabel} 차트와 ${horizonLabel} 보유 계획 사이에 큰 시간 차이는 확인되지 않았습니다.`,
    actions: [
      { key: "WIDEN_TO_DAILY", label: "일봉으로 시야 넓히기" },
      { key: "REVIEW_ORIGINAL_PLAN", label: "원래 계획 다시 보기" },
      { key: "KEEP_CURRENT_CHART", label: "지금 차트 계속 보기" },
    ],
    forcedChange: false,
    limitation:
      "시간축 안내는 매매 신호가 아니며 사용자가 선택한 차트를 강제로 바꾸지 않습니다.",
  };
}

function pickSellPlan(
  input: Exclude<TradeCoachInput, { concern: "PRE_BUY" }>,
  plans: ExecutionPlan[],
  corePreferredPlanId: ExecutionPlan["id"],
): {
  preferredPlanId: ExecutionPlan["id"];
  selectionBasis:
    | "USER_FULL_PREFERENCE"
    | "USER_STAGED_PREFERENCE"
    | "CORE_COMPARISON_WHILE_UNSURE";
  explanation: string;
} {
  if (input.sellPlanPreference === "FULL") {
    return {
      preferredPlanId: "ONE_SHOT",
      selectionBasis: "USER_FULL_PREFERENCE",
      explanation:
        "전량 매도를 먼저 비교하고 싶다는 답을 반영했습니다. 이것은 매도 시점의 정답이나 가격 전망이 아닙니다.",
    };
  }

  if (input.sellPlanPreference === "STAGED") {
    const canUseThreeStages = plans.some((plan) => plan.id === "STAGED_3");
    const hasTimeForThreeStages =
      input.deadline === "THIS_WEEK" || input.deadline === "NO_RUSH";
    return {
      preferredPlanId:
        canUseThreeStages && hasTimeForThreeStages
          ? "STAGED_3"
          : "STAGED_2",
      selectionBasis: "USER_STAGED_PREFERENCE",
      explanation:
        "나누어 매도를 먼저 비교하고 싶다는 답과 실행기한을 반영했습니다. 각 회차 전에는 같은 조건을 다시 확인합니다.",
    };
  }

  return {
    preferredPlanId: corePreferredPlanId,
    selectionBasis: "CORE_COMPARISON_WHILE_UNSURE",
    explanation:
      "전량과 분할 사이에서 아직 정하지 못해 감당 범위·최근 관측 범위·실행기한으로 계산한 비교안을 먼저 보여줍니다.",
  };
}

export function calculateTradeCoach(rawInput: unknown): TradeCoachResult {
  const parsed = TradeCoachInputSchema.safeParse(rawInput);
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
  if (input.market.provenance.currency !== "KRW") {
    return fail("UNSUPPORTED_MARKET_CURRENCY", [
      {
        path: "market.provenance.currency",
        message: "현재 계산 화면은 원화 가격만 지원합니다.",
      },
    ]);
  }

  const latestPriceKrw = safeMoney(input.market.quote.latestPrice);
  const rangeLowKrw = safeMoney(input.market.metrics.range20d.low);
  const rangeHighKrw = safeMoney(input.market.metrics.range20d.high);
  if (
    latestPriceKrw === null ||
    latestPriceKrw <= 0 ||
    rangeLowKrw === null ||
    rangeLowKrw <= 0 ||
    rangeHighKrw === null ||
    rangeHighKrw <= 0
  ) {
    return fail("UNSAFE_NUMERIC_RANGE", [
      {
        path: "market",
        message: "가격과 금액을 안전하게 계산할 수 있는 범위를 벗어났습니다.",
      },
    ]);
  }
  if (input.market.metrics.relativeVolume20d === null) {
    return fail("CORE_DECISION_FAILURE", [
      {
        path: "market.metrics.relativeVolume20d",
        message: "평균 대비 거래량을 확인하지 못해 실행안을 계산하지 않았습니다.",
      },
    ]);
  }

  const direction = input.concern === "PRE_BUY" ? "BUY" : "SELL";
  const core = computeExecutionDecision({
    direction,
    ...(direction === "BUY"
      ? { budgetKrw: input.budgetKrw }
      : { holdingQuantity: input.holdingQuantity }),
    deadline: input.deadline,
    primaryRegret:
      input.regretPriority === "PRICE_RISK"
        ? "PRICE_MOVE"
        : "MISSED_OPPORTUNITY",
    maxLossPercent: input.maxLossPercent,
    maxMovePercent: input.maxLossPercent,
    lotSize: 1,
    market: {
      latestClose: latestPriceKrw,
      volatility20dPct: input.market.metrics.volatility20dPct,
      rangeLow: rangeLowKrw,
      rangeHigh: rangeHighKrw,
      relativeVolume: input.market.metrics.relativeVolume20d,
      freshness: {
        status: "FRESH",
        asOf: input.market.provenance.asOf,
        checkedAt: input.market.provenance.fetchedAt,
        maxAgeMinutes: 10_080,
      },
    },
  });

  if (!core.ok) {
    return fail(
      "CORE_DECISION_FAILURE",
      core.reasons.map((reason) => ({
        path: `execution.${reason.path}`,
        message: reason.message,
      })),
    );
  }

  let position: z.infer<typeof TradeCoachSuccessSchema>["position"] = null;
  let lossReviewLine: z.infer<
    typeof TradeCoachSuccessSchema
  >["reviewLines"]["loss"] = null;
  let profitReviewLine: z.infer<
    typeof TradeCoachSuccessSchema
  >["reviewLines"]["profit"] = null;

  if (input.concern !== "PRE_BUY") {
    const investedAmountKrw = safeMoney(
      input.averageCostKrw * input.holdingQuantity,
    );
    const currentValuationKrw = safeMoney(
      latestPriceKrw * input.holdingQuantity,
    );
    const lossReviewPriceKrw = safeMoney(
      input.averageCostKrw * (1 - input.maxLossPercent / 100),
    );
    if (
      investedAmountKrw === null ||
      currentValuationKrw === null ||
      lossReviewPriceKrw === null
    ) {
      return fail("UNSAFE_NUMERIC_RANGE", [
        {
          path: "position",
          message: "보유금액과 재확인선을 안전하게 계산할 수 없습니다.",
        },
      ]);
    }

    const profitLossAmountKrw = currentValuationKrw - investedAmountKrw;
    position = {
      referenceAverageCostKrw: input.averageCostKrw,
      currentPriceKrw: latestPriceKrw,
      quantity: input.holdingQuantity,
      investedAmountKrw,
      currentValuationKrw,
      profitLossAmountKrw,
      profitLossPercent: roundPercent(
        (profitLossAmountKrw / investedAmountKrw) * 100,
      ),
      direction:
        profitLossAmountKrw > 0
          ? "GAIN"
          : profitLossAmountKrw < 0
            ? "LOSS"
            : "EVEN",
      meaning:
        "현재 평가손익은 사용자가 입력한 평균 매수가와 공개 데이터의 최근 가격으로만 계산했습니다.",
    };

    const lossReviewValueKrw = safeMoney(
      lossReviewPriceKrw * input.holdingQuantity,
    );
    if (lossReviewValueKrw === null) {
      return fail("UNSAFE_NUMERIC_RANGE", [
        {
          path: "reviewLines.loss",
          message: "손실 재확인 금액을 안전하게 계산할 수 없습니다.",
        },
      ]);
    }
    lossReviewLine = {
      source: "USER_LOSS_TOLERANCE",
      percentFromAverageCost: -input.maxLossPercent,
      reviewPriceKrw: lossReviewPriceKrw,
      positionValueAtReviewKrw: lossReviewValueKrw,
      profitLossAmountAtReviewKrw: lossReviewValueKrw - investedAmountKrw,
      meaning:
        "사용자가 입력한 감당 가능한 손실 범위를 가격과 금액으로 바꾼 재확인선입니다. 손절가 예측이나 자동 주문 조건이 아닙니다.",
    };

    if (input.profitCriterionPercent !== null) {
      const profitReviewPriceKrw = safeMoney(
        input.averageCostKrw * (1 + input.profitCriterionPercent / 100),
      );
      const profitReviewValueKrw =
        profitReviewPriceKrw === null
          ? null
          : safeMoney(profitReviewPriceKrw * input.holdingQuantity);
      if (profitReviewPriceKrw === null || profitReviewValueKrw === null) {
        return fail("UNSAFE_NUMERIC_RANGE", [
          {
            path: "reviewLines.profit",
            message: "이익 실현 기준 금액을 안전하게 계산할 수 없습니다.",
          },
        ]);
      }
      profitReviewLine = {
        source: "USER_PROFIT_CRITERION",
        percentFromAverageCost: input.profitCriterionPercent,
        reviewPriceKrw: profitReviewPriceKrw,
        positionValueAtReviewKrw: profitReviewValueKrw,
        profitLossAmountAtReviewKrw:
          profitReviewValueKrw - investedAmountKrw,
        meaning:
          "사용자가 직접 입력한 이익 실현 기준을 금액으로 바꿨습니다. 목표가나 미래 가격 예측이 아닙니다.",
      };
    }
  }

  const execution =
    input.concern === "PRE_BUY"
      ? {
          direction: "BUY" as const,
          core,
          preferredPlanId: core.preferredPlanId,
          selectionBasis: "REGRET_BUDGET_CORE" as const,
          explanation:
            "사용자가 더 피하고 싶은 후회와 감당 범위·실행기한으로 일괄안과 분할안을 비교했습니다. 가격 방향을 예측한 결과가 아닙니다.",
        }
      : {
          direction: "SELL" as const,
          core,
          ...pickSellPlan(input, core.plans, core.preferredPlanId),
        };

  return TradeCoachSuccessSchema.parse({
    ok: true,
    status: "READY_FOR_REVIEW",
    concern: input.concern,
    inputSnapshot: input,
    marketFacts: {
      latestPrice: {
        factId: "MARKET_LATEST_PRICE",
        valueKrw: latestPriceKrw,
      },
      asOf: {
        factId: "MARKET_AS_OF",
        value: input.market.provenance.asOf,
      },
      sourceUrl: input.market.provenance.sourceUrl,
      synthetic: false,
    },
    position,
    reviewLines: {
      loss: lossReviewLine,
      profit: profitReviewLine,
    },
    execution,
    orderStyle: buildOrderStyleCoach(input),
    timeAxis: buildTimeAxisCoach(input),
    limits: {
      predictsFuturePrice: false,
      recommendsSecurity: false,
      computesOptimalLimitPrice: false,
      observesOrderBook: false,
      executesOrder: false,
    },
  });
}

export const buildTradeCoach = calculateTradeCoach;
