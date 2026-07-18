"use client";

import type {
  TradeCoachInput,
  TradeCoachSuccess,
} from "../lib/trade-coach-contracts";

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

export type PositionCoachPanelProps = {
  concern: PositionCoachInput["concern"];
  value: PositionCoachDraft;
  result: TradeCoachSuccess | null;
  selectedPlanId?: PositionCoachPlanId | null;
  disabled?: boolean;
  hideTimeAxis?: boolean;
  errorMessage?: string | null;
  onChange: (field: PositionCoachDraftField, value: string) => void;
  onSubmit: () => void;
  onClose?: () => void;
  onSelectPlan?: (planId: PositionCoachPlanId) => void;
  onTimeAxisAction?: (action: PositionCoachTimeAxisAction) => void;
};

const HORIZON_OPTIONS: Array<{
  value: PositionCoachDraft["horizon"];
  label: string;
}> = [
  { value: "DAYS", label: "며칠" },
  { value: "WEEKS", label: "몇 주" },
  { value: "MONTHS", label: "몇 달" },
  { value: "YEARS", label: "1년 이상" },
];

const DEADLINE_OPTIONS: Array<{
  value: PositionCoachDraft["deadline"];
  label: string;
}> = [
  { value: "NOW", label: "지금 바로" },
  { value: "TODAY", label: "오늘 안에" },
  { value: "THIS_WEEK", label: "이번 주 안에" },
  { value: "NO_RUSH", label: "급하지 않아요" },
];

const SELL_PREFERENCE_OPTIONS: Array<{
  value: PositionCoachDraft["sellPlanPreference"];
  label: string;
}> = [
  { value: "FULL", label: "전량 매도를 먼저 볼래요" },
  { value: "STAGED", label: "나누어 매도를 먼저 볼래요" },
  { value: "UNSURE", label: "둘 다 비교하고 싶어요" },
];

const ORDER_STYLE_OPTIONS: Array<{
  value: PositionCoachDraft["orderStylePreference"];
  label: string;
}> = [
  { value: "FAST_EXECUTION", label: "빨리 거래하는 것이 중요해요" },
  { value: "PRICE_CONTROL", label: "원하는 가격을 지키고 싶어요" },
  { value: "UNSURE", label: "아직 잘 모르겠어요" },
];

const PLAN_LABELS: Record<PositionCoachPlanId, string> = {
  ONE_SHOT: "한 번에 매도하기",
  STAGED_2: "두 번으로 나누기",
  STAGED_3: "세 번으로 나누기",
};

const ORDER_STYLE_LABELS: Record<
  TradeCoachSuccess["orderStyle"]["preferredReviewStyle"],
  string
> = {
  MARKET_FIRST: "시장가를 먼저 비교해 보세요",
  LIMIT_FIRST: "지정가를 먼저 비교해 보세요",
  COMPARE_BOTH: "시장가와 지정가를 함께 비교해 보세요",
};

function formatKrw(value: number): string {
  return `${value.toLocaleString("ko-KR")}원`;
}

function formatSignedKrw(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("ko-KR")}원`;
}

function formatPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("ko-KR", {
    maximumFractionDigits: 2,
  })}%`;
}

function updateNumericField(
  event: React.ChangeEvent<HTMLInputElement>,
  field: PositionCoachDraftField,
  onChange: PositionCoachPanelProps["onChange"],
) {
  onChange(field, event.currentTarget.value);
}

export function PositionCoachPanel({
  concern,
  value,
  result,
  selectedPlanId,
  disabled = false,
  hideTimeAxis = false,
  errorMessage = null,
  onChange,
  onSubmit,
  onClose,
  onSelectPlan,
  onTimeAxisAction,
}: PositionCoachPanelProps) {
  const activePlanId = selectedPlanId ?? result?.execution.preferredPlanId;
  const isAnxiousHolding = concern === "HOLDING_ANXIETY";
  const lossReviewLineReached = Boolean(
    result?.position &&
      result.reviewLines.loss &&
      result.position.currentPriceKrw <= result.reviewLines.loss.reviewPriceKrw,
  );

  return (
    <section
      className="position-coach-panel"
      aria-labelledby="position-coach-title"
    >
      <header className="position-coach-panel__header">
        {onClose ? (
          <button
            type="button"
            className="position-coach-panel__close"
            onClick={onClose}
            aria-label="매매 동반자 닫기"
          >
            닫기
          </button>
        ) : null}
        <p className="position-coach-panel__eyebrow">
          {isAnxiousHolding ? "보유 후 불안 함께 보기" : "팔 시점 함께 보기"}
        </p>
        <h2 id="position-coach-title">
          {isAnxiousHolding
            ? "지금의 불안을 원래 계획과 맞춰볼게요"
            : "전량과 분할 매도를 함께 비교해 볼게요"}
        </h2>
        <p>
          입력한 평균 매수가와 감당 범위를 재확인 계획으로 바꿉니다. 미래
          가격이나 정답을 예측하지 않습니다.
        </p>
      </header>

      <div className="position-coach-panel__form">
        <label className="position-coach-panel__field">
          <span>평균적으로 얼마에 샀나요?</span>
          <span className="position-coach-panel__input-with-unit">
            <input
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={value.averageCostKrw}
              disabled={disabled}
              onChange={(event) =>
                updateNumericField(event, "averageCostKrw", onChange)
              }
              placeholder="예: 72,000"
            />
            <span aria-hidden="true">원</span>
          </span>
        </label>

        <label className="position-coach-panel__field">
          <span>몇 주를 가지고 있나요?</span>
          <span className="position-coach-panel__input-with-unit">
            <input
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={value.holdingQuantity}
              disabled={disabled}
              onChange={(event) =>
                updateNumericField(event, "holdingQuantity", onChange)
              }
              placeholder="예: 20"
            />
            <span aria-hidden="true">주</span>
          </span>
        </label>

        <label className="position-coach-panel__field">
          <span>얼마 동안 보유할 생각인가요?</span>
          <select
            value={value.horizon}
            disabled={disabled}
            onChange={(event) => onChange("horizon", event.currentTarget.value)}
          >
            {HORIZON_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="position-coach-panel__field">
          <span>언제까지 이 결정을 해야 하나요?</span>
          <select
            value={value.deadline}
            disabled={disabled}
            onChange={(event) => onChange("deadline", event.currentTarget.value)}
          >
            {DEADLINE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="position-coach-panel__field">
          <span>평균 매수가에서 몇 % 손실까지 감당할 수 있나요?</span>
          <span className="position-coach-panel__input-with-unit">
            <input
              type="number"
              inputMode="decimal"
              min="0.5"
              max="50"
              step="0.5"
              value={value.maxLossPercent}
              disabled={disabled}
              onChange={(event) =>
                updateNumericField(event, "maxLossPercent", onChange)
              }
              placeholder="예: 8"
            />
            <span aria-hidden="true">%</span>
          </span>
        </label>

        <label className="position-coach-panel__field">
          <span>직접 정한 이익 실현 기준이 있나요? (선택)</span>
          <span className="position-coach-panel__input-with-unit">
            <input
              type="number"
              inputMode="decimal"
              min="0.5"
              max="500"
              step="0.5"
              value={value.profitCriterionPercent}
              disabled={disabled}
              onChange={(event) =>
                updateNumericField(event, "profitCriterionPercent", onChange)
              }
              placeholder="없으면 비워 두세요"
            />
            <span aria-hidden="true">%</span>
          </span>
        </label>

        <fieldset className="position-coach-panel__choice-group">
          <legend>전량 매도와 나누어 매도 중 어떤 쪽을 먼저 볼까요?</legend>
          <div className="position-coach-panel__choices">
            {SELL_PREFERENCE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={value.sellPlanPreference === option.value}
                disabled={disabled}
                onClick={() => onChange("sellPlanPreference", option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="position-coach-panel__choice-group">
          <legend>주문할 때 무엇이 더 중요한가요?</legend>
          <div className="position-coach-panel__choices">
            {ORDER_STYLE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={value.orderStylePreference === option.value}
                disabled={disabled}
                onClick={() => onChange("orderStylePreference", option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <button
          className="position-coach-panel__submit"
          type="button"
          disabled={disabled}
          onClick={onSubmit}
        >
          {disabled
            ? "계획을 계산하고 있어요"
            : isAnxiousHolding
              ? "내 재확인 계획 만들기"
              : "매도 선택지 비교하기"}
        </button>
        {errorMessage ? (
          <p className="position-coach-panel__error" role="alert">
            {errorMessage}
          </p>
        ) : null}
      </div>

      {result ? (
        <div className="position-coach-panel__result" aria-live="polite">
          {result.position ? (
            <section
              className="position-coach-panel__position"
              data-direction={result.position.direction.toLowerCase()}
              aria-labelledby="position-evaluation-title"
            >
              <div>
                <p>현재 평가손익</p>
                <h3 id="position-evaluation-title">
                  <span aria-hidden="true">
                    {result.position.direction === "GAIN"
                      ? "▲"
                      : result.position.direction === "LOSS"
                        ? "▼"
                        : "―"}
                  </span>{" "}
                  {formatSignedKrw(result.position.profitLossAmountKrw)} ·{" "}
                  {formatPercent(result.position.profitLossPercent)}
                </h3>
              </div>
              <dl>
                <div>
                  <dt>입력한 평균 매수가</dt>
                  <dd>{formatKrw(result.position.referenceAverageCostKrw)}</dd>
                </div>
                <div>
                  <dt>공개 데이터 기준 가격</dt>
                  <dd>{formatKrw(result.position.currentPriceKrw)}</dd>
                </div>
                <div>
                  <dt>현재 평가금액</dt>
                  <dd>{formatKrw(result.position.currentValuationKrw)}</dd>
                </div>
              </dl>
              <p>{result.position.meaning}</p>
            </section>
          ) : null}

          <section
            className="position-coach-panel__review-lines"
            aria-labelledby="review-line-title"
          >
            <h3 id="review-line-title">계획을 다시 확인할 선</h3>
            {result.reviewLines.loss ? (
              <article>
                <p>감당 가능한 손실 기준</p>
                <strong>
                  {formatKrw(result.reviewLines.loss.reviewPriceKrw)} · 평가손익{" "}
                  {formatSignedKrw(
                    result.reviewLines.loss.profitLossAmountAtReviewKrw,
                  )}
                </strong>
                <small>{result.reviewLines.loss.meaning}</small>
              </article>
            ) : null}
            {lossReviewLineReached ? (
              <p className="position-coach-panel__line-alert" role="note">
                현재 공개 가격이 내가 정한 손실 재확인선을 이미 지났습니다. 새 결론을 서두르기보다 원래 보유 이유와 감당 범위를 먼저 다시 확인해 주세요.
              </p>
            ) : null}
            {result.reviewLines.profit ? (
              <article>
                <p>직접 정한 이익 실현 기준</p>
                <strong>
                  {formatKrw(result.reviewLines.profit.reviewPriceKrw)} · 평가손익{" "}
                  {formatSignedKrw(
                    result.reviewLines.profit.profitLossAmountAtReviewKrw,
                  )}
                </strong>
                <small>{result.reviewLines.profit.meaning}</small>
              </article>
            ) : null}
          </section>

          <section
            className="position-coach-panel__plans"
            aria-labelledby="sell-plan-title"
          >
            <header>
              <div>
                <p>전량과 분할 비교</p>
                <h3 id="sell-plan-title">
                  먼저 볼 선택: {PLAN_LABELS[result.execution.preferredPlanId]}
                </h3>
              </div>
              <p>{result.execution.explanation}</p>
            </header>
            <div className="position-coach-panel__plan-list">
              {result.execution.core.plans.map((plan) => (
                <button
                  key={plan.id}
                  type="button"
                  aria-pressed={activePlanId === plan.id}
                  disabled={disabled || !onSelectPlan}
                  onClick={() => onSelectPlan?.(plan.id)}
                >
                  <span>{PLAN_LABELS[plan.id]}</span>
                  <strong>
                    총 {plan.totalShares.toLocaleString("ko-KR")}주 · 기준금액{" "}
                    {formatKrw(plan.referenceTotalAmountKrw)}
                  </strong>
                  <small>
                    {plan.allocations
                      .map(
                        (allocation) =>
                          `${allocation.sequence}회 ${allocation.shares.toLocaleString("ko-KR")}주`,
                      )
                      .join(" · ")}
                  </small>
                </button>
              ))}
            </div>
          </section>

          <section
            className="position-coach-panel__order-style"
            aria-labelledby="order-style-title"
          >
            <p>주문 방식 코치</p>
            <h3 id="order-style-title">
              {
                ORDER_STYLE_LABELS[
                  result.orderStyle.preferredReviewStyle
                ]
              }
            </h3>
            <p>{result.orderStyle.rationale}</p>
            <div>
              <article>
                <strong>시장가</strong>
                <span>{result.orderStyle.marketOrder.benefit}</span>
                <small>{result.orderStyle.marketOrder.tradeoff}</small>
              </article>
              <article>
                <strong>지정가</strong>
                <span>{result.orderStyle.limitOrder.benefit}</span>
                <small>{result.orderStyle.limitOrder.tradeoff}</small>
              </article>
            </div>
            <p className="position-coach-panel__order-book-limit">
              실시간 호가 미확인 · {result.orderStyle.limitation}
            </p>
          </section>

          {result.timeAxis.mismatchDetected && !hideTimeAxis ? (
            <section
              className="position-coach-panel__time-axis"
              aria-labelledby="time-axis-title"
            >
              <p>차트를 보는 시간과 계획이 달라요</p>
              <h3 id="time-axis-title">짧은 움직임이 더 크게 느껴질 수 있어요</h3>
              <p>{result.timeAxis.observation}</p>
              <div>
                {result.timeAxis.actions.map((action) => (
                  <button
                    key={action.key}
                    type="button"
                    disabled={disabled || !onTimeAxisAction}
                    onClick={() => onTimeAxisAction?.(action.key)}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
              <small>{result.timeAxis.limitation}</small>
            </section>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
