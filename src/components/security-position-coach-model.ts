import type {
  PositionCoachDraft,
} from "@/components/position-coach-panel";
import type { CandlestickPeriod } from "@/components/security-candlestick-chart";
import {
  chartInterval,
  type ConcernMode,
} from "@/components/security-trading-demo-model";
import type { AdversarialCoreAnswer } from "@/lib/adversarial-review-contracts";
import type { DecisionConversationInput } from "@/lib/decision-contracts";
import type { IntradayMarketView } from "@/lib/intraday-market";
import type { MarketView } from "@/lib/market-view";
import { calculateTradeCoach } from "@/lib/trade-coach-core";

type PositionCoachCalculation = Readonly<{
  draft: PositionCoachDraft;
  period: CandlestickPeriod;
  input: DecisionConversationInput;
  market: MarketView;
  concern: Exclude<ConcernMode, "PRE_BUY">;
  intraday: IntradayMarketView | null;
}>;

export function calculatePositionCoachForDraft({
  draft,
  period,
  input,
  market,
  concern,
  intraday,
}: PositionCoachCalculation) {
  const averageCostKrw = Number(draft.averageCostKrw);
  const holdingQuantity = Number(draft.holdingQuantity);
  const maxLossPercent = Number(draft.maxLossPercent);
  const profitCriterionPercent = draft.profitCriterionPercent.trim()
    ? Number(draft.profitCriterionPercent)
    : null;

  return calculateTradeCoach({
    concern,
    subjectLabel: input.subjectLabel,
    symbol: market.symbol,
    budgetKrw: null,
    averageCostKrw,
    holdingQuantity,
    deadline: draft.deadline,
    horizon: draft.horizon,
    maxLossPercent,
    profitCriterionPercent,
    sellPlanPreference: draft.sellPlanPreference,
    regretPriority:
      draft.sellPlanPreference === "FULL"
        ? "MISSED_OPPORTUNITY"
        : "PRICE_RISK",
    orderStylePreference: draft.orderStylePreference,
    selectedChartInterval: chartInterval(period, intraday),
    market,
  });
}

type AdversarialAnswerChange = Readonly<{
  input: DecisionConversationInput;
  draft: PositionCoachDraft;
  orderStylePreference: PositionCoachDraft["orderStylePreference"] | null;
  summary: string;
}>;

export function applyAdversarialAnswerToInputs(
  answer: AdversarialCoreAnswer,
  input: DecisionConversationInput,
  draft: PositionCoachDraft,
  concern: ConcernMode,
): AdversarialAnswerChange {
  let nextInput = { ...input };
  let nextDraft = { ...draft };
  let orderStylePreference: AdversarialAnswerChange["orderStylePreference"] =
    null;
  let summary =
    "답변을 반영해 같은 계획 계산기로 실행안을 다시 계산했습니다.";

  if (answer.questionKey === "CONFIRM_REGRET_PRIORITY") {
    const regret =
      answer.answerKey === "PRICE_RISK"
        ? "PRICE_RISK"
        : "MISSED_OPPORTUNITY";
    nextInput = { ...nextInput, regretPriority: regret };
    summary =
      regret === "PRICE_RISK"
        ? "산 뒤 가격이 내려가는 걱정을 더 크게 반영해 회차별 비중을 다시 계산했습니다."
        : "기회를 놓치는 걱정을 더 크게 반영해 회차별 비중을 다시 계산했습니다.";
  } else if (
    answer.questionKey === "CONFIRM_DEADLINE" &&
    ["NOW", "TODAY", "THIS_WEEK", "NO_RUSH"].includes(answer.answerKey)
  ) {
    nextInput = {
      ...nextInput,
      deadline: answer.answerKey as DecisionConversationInput["deadline"],
    };
    nextDraft = { ...nextDraft, deadline: nextInput.deadline };
    summary =
      "새 실행기한으로 가능한 분할 횟수와 재확인 조건을 다시 계산했습니다.";
  } else if (answer.questionKey === "CONFIRM_LOSS_TOLERANCE") {
    const current = input.maxAdverseMovePct;
    const next =
      answer.answerKey === "TIGHTER"
        ? Math.max(0.5, current * 0.75)
        : answer.answerKey === "WIDER"
          ? Math.min(50, current * 1.25)
          : current;
    nextInput = {
      ...nextInput,
      maxAdverseMovePct: Math.round(next * 10) / 10,
    };
    nextDraft = {
      ...nextDraft,
      maxLossPercent: String(nextInput.maxAdverseMovePct),
    };
    summary =
      "감당 가능한 손실 범위로 다시 확인할 가격과 나누는 비중을 다시 계산했습니다.";
  } else if (
    answer.questionKey === "CONFIRM_ORDER_PRIORITY" &&
    ["FAST_EXECUTION", "PRICE_CONTROL", "UNSURE"].includes(answer.answerKey)
  ) {
    orderStylePreference =
      answer.answerKey as PositionCoachDraft["orderStylePreference"];
    nextDraft = { ...nextDraft, orderStylePreference };
    summary =
      "빠른 거래와 가격 통제 중 새 우선순위로 주문 방식 설명을 다시 정리했습니다.";
  } else if (
    answer.questionKey === "CONFIRM_HOLDING_HORIZON" &&
    ["DAYS", "WEEKS", "MONTHS", "YEARS"].includes(answer.answerKey)
  ) {
    nextDraft = {
      ...nextDraft,
      horizon: answer.answerKey as PositionCoachDraft["horizon"],
    };
    summary =
      "새 보유기간과 현재 차트 시간대를 비교해 재확인 안내를 다시 계산했습니다.";
  } else if (answer.questionKey === "CONFIRM_EXIT_STYLE") {
    nextDraft = {
      ...nextDraft,
      sellPlanPreference:
        answer.answerKey === "ONE_SHOT" ? "FULL" : "STAGED",
    };
    summary =
      answer.answerKey === "ONE_SHOT"
        ? "전량 매도를 먼저 비교하도록 실행안 순서를 다시 계산했습니다."
        : "나누어 매도를 먼저 비교하도록 실행안 순서를 다시 계산했습니다.";
  }

  if (concern !== "PRE_BUY") {
    nextInput = {
      ...nextInput,
      regretPriority:
        nextDraft.sellPlanPreference === "FULL"
          ? "MISSED_OPPORTUNITY"
          : "PRICE_RISK",
    };
  }

  return {
    input: nextInput,
    draft: nextDraft,
    orderStylePreference,
    summary,
  };
}
