"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import {
  formatWholeNumberInput,
  normalizeWholeNumberInput,
} from "../lib/numeric-input";
import {
  DEADLINE_OPTIONS,
  formatKrw,
  formatPercent,
  formatSignedKrw,
  HORIZON_OPTIONS,
  ORDER_STYLE_LABELS,
  ORDER_STYLE_OPTIONS,
  PLAN_LABELS,
  reflectionForStep,
  SELL_PREFERENCE_OPTIONS,
  STEP_LABELS,
  validateStep,
  type PositionCoachDraftField,
  type PositionCoachPanelProps,
  type PositionCoachStep,
} from "./position-coach-panel-model";

export type {
  PositionCoachDraft,
  PositionCoachDraftField,
  PositionCoachPanelProps,
  PositionCoachPlanId,
  PositionCoachTimeAxisAction,
} from "./position-coach-panel-model";

const subscribeToClient = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;


function updateNumericField(
  event: React.ChangeEvent<HTMLInputElement>,
  field: PositionCoachDraftField,
  onChange: PositionCoachPanelProps["onChange"],
) {
  onChange(
    field,
    field === "averageCostKrw"
      ? normalizeWholeNumberInput(event.currentTarget.value)
      : event.currentTarget.value,
  );
}

export function PositionCoachPanel({
  concern,
  value,
  result,
  disabled = false,
  hideTimeAxis = false,
  errorMessage = null,
  onChange,
  onSubmit,
  onClose,
  onTimeAxisAction,
}: PositionCoachPanelProps) {
  const [step, setStep] = useState<PositionCoachStep>(1);
  const [localError, setLocalError] = useState<string | null>(null);
  const portalReady = useSyncExternalStore(
    subscribeToClient,
    getClientSnapshot,
    getServerSnapshot,
  );
  const timeAxisDialogRef = useRef<HTMLElement>(null);
  const dismissTimeAxisWithKeyboard = useEffectEvent(() => {
    onTimeAxisAction?.("KEEP_CURRENT_CHART");
  });
  const isAnxiousHolding = concern === "HOLDING_ANXIETY";
  const showTimeAxis = Boolean(
    result?.timeAxis.mismatchDetected && !hideTimeAxis,
  );
  const lossReviewLineReached = Boolean(
    result?.position &&
      result.reviewLines.loss &&
      result.position.currentPriceKrw <= result.reviewLines.loss.reviewPriceKrw,
  );

  useEffect(() => {
    if (!showTimeAxis) return;
    const dialog = timeAxisDialogRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        dismissTimeAxisWithKeyboard();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>("button:not(:disabled)"),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [showTimeAxis]);

  function change(field: PositionCoachDraftField, nextValue: string) {
    setLocalError(null);
    onChange(field, nextValue);
  }

  function goNext() {
    const message = validateStep(step, value);
    if (message) {
      setLocalError(message);
      return;
    }
    setLocalError(null);
    if (step < 4) setStep((step + 1) as PositionCoachStep);
  }

  function submit() {
    const message = validateStep(step, value);
    if (message) {
      setLocalError(message);
      return;
    }
    setLocalError(null);
    onSubmit();
  }

  const timeAxisModal = showTimeAxis && result && portalReady
    ? createPortal(
        <div className="position-coach-panel__time-axis-overlay">
          <div className="position-coach-panel__time-axis-backdrop" aria-hidden="true" />
          <section
            ref={timeAxisDialogRef}
            className="position-coach-panel__time-axis"
            role="dialog"
            aria-modal="true"
            aria-labelledby="time-axis-title"
            aria-describedby="time-axis-description"
            tabIndex={-1}
          >
            <div className="position-coach-panel__time-axis-identity">
              <span className="agent-ai-badge" aria-hidden="true">AI</span>
              <span>
                <strong>차트 보는 시간을 확인했어요</strong>
                <small>현재 선택한 차트와 보유 계획 비교</small>
              </span>
            </div>
            <span className="position-coach-panel__time-axis-eyebrow">분 단위 차트를 보고 있어요</span>
            <h2 id="time-axis-title">원래 계획보다 아주 짧은 움직임을 보고 있어요</h2>
            <p id="time-axis-description">{result.timeAxis.observation}</p>
            <div className="position-coach-panel__time-axis-actions">
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
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <section
        className="position-coach-panel position-coach-panel--stepper"
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
          <div className="position-coach-panel__identity">
            <span className="agent-ai-badge" aria-hidden="true">AI</span>
            <span>
              <strong>AI 매매 동반자</strong>
              <small>{step}단계 · {STEP_LABELS[step]}</small>
            </span>
          </div>
          <h2 id="position-coach-title">
            {isAnxiousHolding
              ? "보유 중인 고민을 한 단계씩 정리할게요"
              : "파는 방법을 한 단계씩 비교할게요"}
          </h2>
        </header>

        <div className="position-coach-panel__progress-wrap">
          <div><span>{step} / 4</span><strong>{STEP_LABELS[step]}</strong></div>
          <div className="position-coach-panel__progress" aria-label={`전체 4단계 중 ${step}단계`}>
            {[1, 2, 3, 4].map((item) => (
              <span key={item} className={item <= step ? "is-active" : undefined} />
            ))}
          </div>
        </div>

        {reflectionForStep(step, value) ? (
          <div className="position-coach-panel__latest" role="status" aria-live="polite">
            <span>방금 답변을 이렇게 이해했어요</span>
            <p>{reflectionForStep(step, value)}</p>
          </div>
        ) : null}

        <div className="position-coach-panel__form position-coach-panel__form--single-step">
          <section className="position-coach-panel__step-card">
            <span>{STEP_LABELS[step]}</span>
            <h3>
              {step === 1
                ? "지금 가지고 있는 주식 정보를 알려주세요"
                : step === 2
                  ? "원래 계획한 시간은 어느 정도인가요?"
                  : step === 3
                    ? "어느 범위에서 계획을 다시 확인할까요?"
                    : "어떤 실행 방법부터 비교할까요?"}
            </h3>

            {step === 1 ? (
              <div className="position-coach-panel__field-grid">
                <label className="position-coach-panel__field">
                  <span>평균적으로 얼마에 샀나요?</span>
                  <span className="position-coach-panel__input-with-unit">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formatWholeNumberInput(value.averageCostKrw)}
                      disabled={disabled}
                      onChange={(event) =>
                        updateNumericField(event, "averageCostKrw", change)
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
                        updateNumericField(event, "holdingQuantity", change)
                      }
                      placeholder="예: 20"
                    />
                    <span aria-hidden="true">주</span>
                  </span>
                </label>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="position-coach-panel__step-groups">
                <fieldset className="position-coach-panel__choice-group">
                  <legend>얼마 동안 보유할 생각인가요?</legend>
                  <div className="position-coach-panel__choices position-coach-panel__choices--grid">
                    {HORIZON_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={value.horizon === option.value}
                        disabled={disabled}
                        onClick={() => change("horizon", option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="position-coach-panel__choice-group">
                  <legend>언제까지 이 결정을 해야 하나요?</legend>
                  <div className="position-coach-panel__choices position-coach-panel__choices--grid">
                    {DEADLINE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={value.deadline === option.value}
                        disabled={disabled}
                        onClick={() => change("deadline", option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </fieldset>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="position-coach-panel__field-grid">
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
                        updateNumericField(event, "maxLossPercent", change)
                      }
                      placeholder="예: 8"
                    />
                    <span aria-hidden="true">%</span>
                  </span>
                </label>
                <label className="position-coach-panel__field">
                  <span>직접 정한 이익 확인 기준이 있나요? (선택)</span>
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
                        updateNumericField(event, "profitCriterionPercent", change)
                      }
                      placeholder="없으면 비워 두세요"
                    />
                    <span aria-hidden="true">%</span>
                  </span>
                </label>
              </div>
            ) : null}

            {step === 4 ? (
              <div className="position-coach-panel__step-groups">
                <fieldset className="position-coach-panel__choice-group">
                  <legend>전량 매도와 나누어 매도 중 어떤 쪽을 먼저 볼까요?</legend>
                  <div className="position-coach-panel__choices position-coach-panel__choices--cards">
                    {SELL_PREFERENCE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={value.sellPlanPreference === option.value}
                        disabled={disabled}
                        onClick={() => change("sellPlanPreference", option.value)}
                      >
                        <strong>{option.label}</strong>
                        <span>{option.description}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="position-coach-panel__choice-group">
                  <legend>주문할 때 무엇이 더 중요한가요?</legend>
                  <div className="position-coach-panel__choices position-coach-panel__choices--cards">
                    {ORDER_STYLE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={value.orderStylePreference === option.value}
                        disabled={disabled}
                        onClick={() => change("orderStylePreference", option.value)}
                      >
                        <strong>{option.label}</strong>
                        <span>{option.description}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>
              </div>
            ) : null}
          </section>

          {localError || errorMessage ? (
            <p className="position-coach-panel__error" role="alert">
              {localError ?? errorMessage}
            </p>
          ) : null}

          <div className="position-coach-panel__actions">
            {step > 1 ? (
              <button
                type="button"
                className="btn btn--secondary"
                disabled={disabled}
                onClick={() => {
                  setLocalError(null);
                  setStep((step - 1) as PositionCoachStep);
                }}
              >
                이전 단계
              </button>
            ) : null}
            <button
              className="position-coach-panel__submit btn btn--primary"
              type="button"
              disabled={disabled}
              onClick={step === 4 ? submit : goNext}
            >
              {disabled
                ? "계획을 계산하고 있어요"
                : step < 4
                  ? "다음 질문"
                  : isAnxiousHolding
                    ? "내 계획 다시 확인하기"
                    : "매도 선택지 비교하기"}
            </button>
          </div>
        </div>

        {result && step === 4 ? (
          <section className="position-coach-panel__compact-result" aria-live="polite">
            <header>
              <span>계획 계산을 마쳤어요</span>
              <h3>먼저 볼 선택: {PLAN_LABELS[result.execution.preferredPlanId]}</h3>
            </header>
            {result.position ? (
              <dl>
                <div>
                  <dt>현재 손익</dt>
                  <dd>{formatSignedKrw(result.position.profitLossAmountKrw)} · {formatPercent(result.position.profitLossPercent)}</dd>
                </div>
                {result.reviewLines.loss ? (
                  <div>
                    <dt>손실 기준을 다시 볼 가격</dt>
                    <dd>{formatKrw(result.reviewLines.loss.reviewPriceKrw)} · {formatSignedKrw(result.reviewLines.loss.profitLossAmountAtReviewKrw)}</dd>
                  </div>
                ) : null}
                {result.reviewLines.profit ? (
                  <div>
                    <dt>이익 기준을 다시 볼 가격</dt>
                    <dd>{formatKrw(result.reviewLines.profit.reviewPriceKrw)} · {formatSignedKrw(result.reviewLines.profit.profitLossAmountAtReviewKrw)}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>주문 방식</dt>
                  <dd>{ORDER_STYLE_LABELS[result.orderStyle.preferredReviewStyle]}</dd>
                </div>
              </dl>
            ) : null}
            {lossReviewLineReached ? (
              <p className="position-coach-panel__line-alert" role="note">
                현재 공개 가격이 내가 정한 손실 기준을 이미 지났습니다. 원래 보유 이유와 감당 범위를 먼저 다시 확인해 주세요.
              </p>
            ) : null}
            <button type="button" onClick={() => setStep(1)}>이전 답변 수정하기</button>
          </section>
        ) : null}
      </section>
      {timeAxisModal}
    </>
  );
}
