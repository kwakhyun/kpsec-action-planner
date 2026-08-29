import {
  AdversarialReviewRequestSchema,
  type AdversarialReviewRequest,
} from "@/lib/adversarial-review-contracts";
import {
  DecisionConversationInputSchema,
  type DecisionConversationInput,
  type DecisionEnvelope,
} from "@/lib/decision-contracts";
import type { ExecutionCoreSuccess, ExecutionPlan } from "@/lib/execution-core";
import type { IntradayMarketView } from "@/lib/intraday-market";
import type { MarketView } from "@/lib/market-view";

import type { PositionCoachDraft } from "./position-coach-panel";
import type {
  CandlestickPeriod,
  CandlestickPlanOverlay,
} from "./security-candlestick-chart";

export type ConcernMode = "PRE_BUY" | "HOLDING_ANXIETY" | "SELL_TIMING";
export type AiExplanationState = "IDLE" | "LOADING" | "SUCCESS" | "FAILURE";

export const INITIAL_INPUT: DecisionConversationInput =
  DecisionConversationInputSchema.parse({
    subjectLabel: "삼성전자",
    symbol: "005930.KS",
    intent: "BUY",
    budgetKrw: 10_000_000,
    holdingQuantity: null,
    deadline: "THIS_WEEK",
    regretPriority: "MISSED_OPPORTUNITY",
    maxAdverseMovePct: 8,
  });

export const KNOWN_SUBJECTS: Record<string, string> = {
  "005930.KS": "삼성전자",
  "000660.KS": "SK하이닉스",
};

export const JOURNEY_STEPS = [
  [1, "시장 이해", "데이터로 현재 상황 파악"],
  [2, "상황 정리", "나의 고민과 조건 입력"],
  [3, "실행안 비교", "실행 계획을 비교하고 결정"],
] as const;

export const INITIAL_POSITION_DRAFT: PositionCoachDraft = {
  averageCostKrw: "300000",
  holdingQuantity: "100",
  horizon: "WEEKS",
  deadline: "THIS_WEEK",
  maxLossPercent: "8",
  profitCriterionPercent: "",
  sellPlanPreference: "UNSURE",
  orderStylePreference: "UNSURE",
};

export function chartInterval(
  period: CandlestickPeriod,
  intraday: IntradayMarketView | null,
): "ONE_MINUTE" | "FIVE_MINUTES" | "DAILY" {
  if (period !== "MINUTE" || !intraday) return "DAILY";
  return intraday.provenance.interval === "1m" ? "ONE_MINUTE" : "FIVE_MINUTES";
}

export function concernLabel(concern: ConcernMode): string {
  if (concern === "PRE_BUY") return "살까 고민되는 상황";
  if (concern === "HOLDING_ANXIETY") return "산 뒤 가격 움직임이 불안한 상황";
  return "팔 시점을 고민하는 상황";
}

export function formatKrw(value: number): string {
  return `${new Intl.NumberFormat("ko-KR").format(Math.round(value))}원`;
}

export function formatVolume(value: number): string {
  return `${new Intl.NumberFormat("ko-KR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)}주`;
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "확인할 수 없음";
  return date.toLocaleString("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function exchangeLabel(exchange: string | null): string {
  if (exchange === "KSC" || exchange === "KRX") return "한국거래소";
  return exchange ?? "거래소 확인 불가";
}

export function beginnerDelayNotice(notice: string): string {
  return notice.replace(
    "실시간 호가가 아닙니다.",
    "지금 주문 가능한 가격을 보여주는 데이터가 아닙니다.",
  );
}

export function sameInput(
  left: DecisionConversationInput | null,
  right: DecisionConversationInput,
): boolean {
  return left !== null && JSON.stringify(left) === JSON.stringify(right);
}

export function sameMarket(envelope: DecisionEnvelope, market: MarketView): boolean {
  const snapshot = envelope.market.snapshot;
  return Boolean(
    snapshot &&
      snapshot.synthetic === false &&
      snapshot.symbol === market.symbol &&
      snapshot.asOf === market.provenance.asOf &&
      snapshot.sourceUrl === market.provenance.sourceUrl &&
      JSON.stringify(snapshot.metrics) === JSON.stringify(market.metrics),
  );
}

type AdversarialRequestOptions = Readonly<{
  planVisible: boolean;
  market: MarketView | null;
  decision: ExecutionCoreSuccess | null;
  selectedPlan: ExecutionPlan | null;
  concern: ConcernMode | null;
  input: DecisionConversationInput;
  orderStylePreference: PositionCoachDraft["orderStylePreference"];
  positionDraft: PositionCoachDraft;
}>;

export function buildAdversarialRequest({
  planVisible,
  market,
  decision,
  selectedPlan,
  concern,
  input,
  orderStylePreference,
  positionDraft,
}: AdversarialRequestOptions): AdversarialReviewRequest | null {
  if (!planVisible || !market || !decision || !selectedPlan || !concern) {
    return null;
  }

  const constraints: AdversarialReviewRequest["userInput"]["constraints"] = [
    { key: "DEADLINE", label: "실행기한", value: input.deadline },
    {
      key: "LOSS_TOLERANCE",
      label: "감당 가능한 손실 범위",
      value: input.maxAdverseMovePct,
    },
    {
      key: input.intent === "BUY" ? "BUDGET" : "HOLDING_QUANTITY",
      label: input.intent === "BUY" ? "매수 예산" : "보유수량",
      value: input.intent === "BUY" ? input.budgetKrw : input.holdingQuantity,
    },
    {
      key: "ORDER_PRIORITY",
      label: "주문 방식 우선순위",
      value: orderStylePreference,
    },
    {
      key: "SELECTED_PLAN",
      label: "지금 선택해 본 실행안",
      value: selectedPlan.id,
    },
  ];

  if (concern === "PRE_BUY") {
    constraints.push({
      key: "REGRET_PRIORITY",
      label: "더 피하고 싶은 후회",
      value: input.regretPriority,
    });
  } else {
    constraints.push(
      {
        key: "AVERAGE_COST",
        label: "평균 매수가",
        value: Number(positionDraft.averageCostKrw),
      },
      {
        key: "HOLDING_HORIZON",
        label: "예상 보유기간",
        value: positionDraft.horizon,
      },
      {
        key: "EXIT_STYLE",
        label: "매도 방식 고민",
        value: positionDraft.sellPlanPreference,
      },
    );
  }

  const candidate = {
    mode: "LIVE" as const,
    subjectLabel: input.subjectLabel,
    symbol: market.symbol,
    userInput: { concernMode: concern, intent: input.intent, constraints },
    facts: [
      {
        id: "MARKET_LATEST_PRICE",
        label: "최근 확인 가격",
        observation: `최근 확인 가격은 ${formatKrw(market.quote.latestPrice)}입니다.`,
        sourceLabel: "Yahoo Finance 공개 데이터",
      },
      {
        id: "MARKET_VOLATILITY_20D",
        label: "최근 20일 가격 흔들림 참고값",
        observation: `최근 20일 가격 흔들림 참고값은 ${market.metrics.volatility20dPct.toFixed(1)}%입니다.`,
        sourceLabel: "Yahoo Finance 하루 단위 데이터에서 서버 계산",
      },
      {
        id: "MARKET_RANGE_20D",
        label: "최근 20일 가격 범위",
        observation: `${formatKrw(market.metrics.range20d.low)}부터 ${formatKrw(market.metrics.range20d.high)}까지 관찰됐습니다.`,
        sourceLabel: "Yahoo Finance 하루 단위 데이터에서 서버 계산",
      },
      {
        id: "MARKET_RELATIVE_VOLUME_20D",
        label: "평소 대비 최근 거래량",
        observation: `최근 거래량은 이전 평균의 ${market.metrics.relativeVolume20d?.toFixed(2) ?? "확인 불가"}배입니다.`,
        sourceLabel: "Yahoo Finance 하루 단위 데이터에서 서버 계산",
      },
    ],
    currentPlan: {
      ...decision,
      preferredPlanId: selectedPlan.id,
      preferredExplanation:
        selectedPlan.id === decision.preferredPlanId
          ? decision.preferredExplanation
          : "사용자가 비교를 위해 이 실행안을 직접 선택했습니다. 수량과 조건은 계획 계산기가 계산한 값입니다.",
    },
    dataContext: {
      asOf: market.provenance.asOf,
      fetchedAt: market.provenance.fetchedAt,
      limitations: [
        market.provenance.delayNotice,
        "지금 시장의 주문 가격과 대기 물량은 확인하지 않았습니다.",
        "과거 공개 데이터로 미래 가격이나 수익을 예측하지 않습니다.",
      ],
    },
    missingInformation: [
      "지금 시장의 주문 가격과 거래 완료 가능성",
      "사용자의 전체 자산과 다른 보유 종목",
    ],
    allowedQuestionKeys:
      concern === "PRE_BUY"
        ? [
            "CONFIRM_REGRET_PRIORITY",
            "CONFIRM_DEADLINE",
            "CONFIRM_LOSS_TOLERANCE",
            "CONFIRM_ORDER_PRIORITY",
          ]
        : [
            "CONFIRM_DEADLINE",
            "CONFIRM_LOSS_TOLERANCE",
            "CONFIRM_ORDER_PRIORITY",
            "CONFIRM_HOLDING_HORIZON",
            "CONFIRM_EXIT_STYLE",
          ],
  };
  const parsed = AdversarialReviewRequestSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function buildAdversarialRequestKey(
  request: AdversarialReviewRequest | null,
): string {
  return request
    ? JSON.stringify({
        input: request.userInput,
        preferred: request.currentPlan.preferredPlanId,
        asOf: request.dataContext.asOf,
      })
    : "NO_REQUEST";
}

export function buildChartOverlay(
  planVisible: boolean,
  selectedPlan: ExecutionPlan | null,
  lossReviewPriceKrw: number | null,
): CandlestickPlanOverlay | null {
  if (!planVisible || !selectedPlan) return null;
  return {
    reviewBand: {
      low: selectedPlan.reviewLine.lowerReviewPriceKrw,
      high: selectedPlan.reviewLine.upperReviewPriceKrw,
      label: "멈추고 다시 확인할 범위",
    },
    markers: [
      {
        id: "reference-price",
        price: selectedPlan.reviewLine.referencePriceKrw,
        label: "계산 기준 가격",
        tone: "primary",
      },
      {
        id: "loss-tolerance",
        price: lossReviewPriceKrw ?? selectedPlan.reviewLine.lossTolerancePriceKrw,
        label: lossReviewPriceKrw
          ? "내가 다시 확인할 손실 가격"
          : "손실 감당 기준",
        tone: "warning",
      },
    ],
    stages: selectedPlan.allocations.map((allocation) => ({
      id: `${selectedPlan.id}-${allocation.sequence}`,
      label: `${allocation.sequence}회차`,
      shareLabel: `${allocation.shares.toLocaleString("ko-KR")}주`,
      weightPct: (allocation.shares / selectedPlan.totalShares) * 100,
    })),
  };
}
