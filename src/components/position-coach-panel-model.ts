import type {
  TradeCoachInput,
  TradeCoachSuccess,
} from "@/lib/trade-coach-contracts";
import { formatWholeNumberInput } from "@/lib/numeric-input";

type PositionCoachInput = Exclude<
  TradeCoachInput,
  { concern: "PRE_BUY" }
>;

export type PositionCoachDraft = {
  averageCostKrw: string;
  holdingQuantity: string;
  horizon: PositionCoachInput["horizon"];
  deadline: PositionCoachInput["deadline"];
  maxLossPercent: string;
  profitCriterionPercent: string;
  sellPlanPreference: PositionCoachInput["sellPlanPreference"];
  orderStylePreference: PositionCoachInput["orderStylePreference"];
};

export type PositionCoachDraftField = keyof PositionCoachDraft;
export type PositionCoachPlanId =
  TradeCoachSuccess["execution"]["preferredPlanId"];
export type PositionCoachTimeAxisAction =
  TradeCoachSuccess["timeAxis"]["actions"][number]["key"];
export type PositionCoachStep = 1 | 2 | 3 | 4;

export type PositionCoachPanelProps = {
  concern: PositionCoachInput["concern"];
  value: PositionCoachDraft;
  result: TradeCoachSuccess | null;
  disabled?: boolean;
  hideTimeAxis?: boolean;
  errorMessage?: string | null;
  onChange: (field: PositionCoachDraftField, value: string) => void;
  onSubmit: () => void;
  onClose?: () => void;
  onTimeAxisAction?: (action: PositionCoachTimeAxisAction) => void;
};

export const STEP_LABELS: Record<PositionCoachStep, string> = {
  1: "보유 정보",
  2: "계획 시간",
  3: "감당 범위",
  4: "매도와 주문 방식",
};

export const HORIZON_OPTIONS: Array<{
  value: PositionCoachDraft["horizon"];
  label: string;
}> = [
  { value: "DAYS", label: "며칠" },
  { value: "WEEKS", label: "몇 주" },
  { value: "MONTHS", label: "몇 달" },
  { value: "YEARS", label: "1년 이상" },
];

export const DEADLINE_OPTIONS: Array<{
  value: PositionCoachDraft["deadline"];
  label: string;
}> = [
  { value: "NOW", label: "지금 바로" },
  { value: "TODAY", label: "오늘 안에" },
  { value: "THIS_WEEK", label: "이번 주 안에" },
  { value: "NO_RUSH", label: "급하지 않아요" },
];

const DEADLINE_REFLECTIONS: Record<PositionCoachDraft["deadline"], string> = {
  NOW: "지금 바로 해야 하는",
  TODAY: "오늘 안에 해야 하는",
  THIS_WEEK: "이번 주 안에 해야 하는",
  NO_RUSH: "급하지 않은",
};

export const SELL_PREFERENCE_OPTIONS: Array<{
  value: PositionCoachDraft["sellPlanPreference"];
  label: string;
  description: string;
}> = [
  {
    value: "FULL",
    label: "전량 매도를 먼저 볼래요",
    description: "한 번에 정리하는 안부터 비교",
  },
  {
    value: "STAGED",
    label: "나누어 매도를 먼저 볼래요",
    description: "두 번·세 번으로 나누는 안부터 비교",
  },
  {
    value: "UNSURE",
    label: "둘 다 비교하고 싶어요",
    description: "정하지 않고 모든 안을 나란히 비교",
  },
];

export const ORDER_STYLE_OPTIONS: Array<{
  value: PositionCoachDraft["orderStylePreference"];
  label: string;
  description: string;
}> = [
  {
    value: "FAST_EXECUTION",
    label: "빨리 거래하는 것이 중요해요",
    description: "가격이 달라질 수 있는 점도 함께 확인",
  },
  {
    value: "PRICE_CONTROL",
    label: "원하는 가격을 지키고 싶어요",
    description: "거래가 끝나지 않을 수 있는 점도 함께 확인",
  },
  {
    value: "UNSURE",
    label: "아직 잘 모르겠어요",
    description: "시장가와 지정가의 차이를 함께 비교",
  },
];

export const PLAN_LABELS: Record<PositionCoachPlanId, string> = {
  ONE_SHOT: "한 번에 매도하기",
  STAGED_2: "두 번으로 나누기",
  STAGED_3: "세 번으로 나누기",
};

export const ORDER_STYLE_LABELS: Record<
  TradeCoachSuccess["orderStyle"]["preferredReviewStyle"],
  string
> = {
  MARKET_FIRST: "시장가를 먼저 비교",
  LIMIT_FIRST: "지정가를 먼저 비교",
  COMPARE_BOTH: "시장가와 지정가를 함께 비교",
};

export function formatKrw(value: number): string {
  return `${value.toLocaleString("ko-KR")}원`;
}

export function formatSignedKrw(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("ko-KR")}원`;
}

export function formatPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("ko-KR", {
    maximumFractionDigits: 2,
  })}%`;
}

function selectedLabel<T extends string>(
  options: Array<{ value: T; label: string }>,
  value: T,
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

export function reflectionForStep(
  step: PositionCoachStep,
  value: PositionCoachDraft,
): string | null {
  if (step === 1) return null;
  if (step === 2) {
    return `${formatWholeNumberInput(value.averageCostKrw) || "0"}원에 산 ${Number(value.holdingQuantity || 0).toLocaleString("ko-KR")}주를 기준으로 볼게요.`;
  }
  if (step === 3) {
    return `${selectedLabel(HORIZON_OPTIONS, value.horizon)} 보유 계획이고, 결정은 ${DEADLINE_REFLECTIONS[value.deadline]} 상황으로 볼게요.`;
  }
  const profit = value.profitCriterionPercent.trim()
    ? `, 이익 ${value.profitCriterionPercent}%에서도 다시 확인`
    : "";
  return `손실 ${value.maxLossPercent}%${profit}하는 기준으로 정리했어요.`;
}

export function validateStep(
  step: PositionCoachStep,
  value: PositionCoachDraft,
): string | null {
  if (step === 1) {
    if (!(Number(value.averageCostKrw) > 0)) {
      return "평균 매수가를 입력해 주세요.";
    }
    if (
      !(Number(value.holdingQuantity) > 0) ||
      !Number.isInteger(Number(value.holdingQuantity))
    ) {
      return "보유수량을 한 주 이상 입력해 주세요.";
    }
  }
  if (step === 3) {
    const loss = Number(value.maxLossPercent);
    if (!(loss >= 0.5 && loss <= 50)) {
      return "감당 범위는 0.5%에서 50% 사이로 입력해 주세요.";
    }
    if (value.profitCriterionPercent.trim()) {
      const profit = Number(value.profitCriterionPercent);
      if (!(profit >= 0.5 && profit <= 500)) {
        return "이익 확인 기준은 0.5%에서 500% 사이로 입력해 주세요.";
      }
    }
  }
  return null;
}
