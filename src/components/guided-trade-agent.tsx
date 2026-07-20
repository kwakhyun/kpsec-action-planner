"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";

import type { DecisionConversationInput } from "@/lib/decision-contracts";
import {
  formatWholeNumberInput,
  parseWholeNumberInput,
} from "@/lib/numeric-input";

export type GuidedTradeStep = 1 | 2 | 3 | 4 | 5;

type GuidedTradeAgentProps = {
  open: boolean;
  input: DecisionConversationInput;
  step: GuidedTradeStep;
  completedSteps: readonly GuidedTradeStep[];
  loading: boolean;
  errorMessage: string | null;
  onInputChange: Dispatch<SetStateAction<DecisionConversationInput>>;
  onContinue: () => void;
  onBack: () => void;
  onClose: () => void;
};

const DEADLINE_LABELS = {
  NOW: "지금 바로",
  TODAY: "오늘 안에",
  THIS_WEEK: "이번 주 안에",
  NO_RUSH: "급하지 않아요",
} as const;

const STEP_LABELS: Record<GuidedTradeStep, string> = {
  1: "거래 방향",
  2: "거래 규모",
  3: "결정 시점",
  4: "더 피하고 싶은 상황",
  5: "다시 확인할 범위",
};

function formatKrw(value: number): string {
  return `${new Intl.NumberFormat("ko-KR").format(value)}원`;
}

function answerForStep(
  step: GuidedTradeStep,
  input: DecisionConversationInput,
): string {
  if (step === 1) return input.intent === "BUY" ? "매수 고민" : "매도 고민";
  if (step === 2) {
    return input.intent === "BUY"
      ? `예산 ${formatKrw(input.budgetKrw ?? 0)}`
      : `보유수량 ${(input.holdingQuantity ?? 0).toLocaleString("ko-KR")}주`;
  }
  if (step === 3) return DEADLINE_LABELS[input.deadline];
  if (step === 4) {
    return input.regretPriority === "MISSED_OPPORTUNITY"
      ? "기다리다 가격이 올라 놓치는 상황"
      : "한 번에 산 뒤 가격이 내려가는 상황";
  }
  return `기준 가격에서 ${input.maxAdverseMovePct}% 벗어나면 다시 확인`;
}

function reflectionForStep(
  step: GuidedTradeStep,
  input: DecisionConversationInput,
): string {
  if (step === 1) {
    return `${input.subjectLabel} 종목을 ${input.intent === "BUY" ? "사고" : "팔고"} 싶은 상황으로 이해했어요.`;
  }
  if (step === 2) {
    return input.intent === "BUY"
      ? `${formatKrw(input.budgetKrw ?? 0)} 안에서 실행 방법을 비교할게요.`
      : `보유한 ${(input.holdingQuantity ?? 0).toLocaleString("ko-KR")}주를 기준으로 비교할게요.`;
  }
  if (step === 3) {
    return `${DEADLINE_LABELS[input.deadline]} 결정해야 하는 상황으로 이해했어요.`;
  }
  if (step === 4) {
    return input.regretPriority === "MISSED_OPPORTUNITY"
      ? "기다리는 동안 계획한 수량을 놓치는 상황을 더 피하고 싶으시군요."
      : "한 번에 확인한 뒤 가격이 내려가는 상황을 더 피하고 싶으시군요.";
  }
  return `기준 가격에서 ${input.maxAdverseMovePct}% 벗어나면 멈추고 다시 확인하는 계획으로 정리할게요.`;
}

function questionForStep(
  step: GuidedTradeStep,
  intent: DecisionConversationInput["intent"],
): string {
  if (step === 1) return "지금은 사는 방법과 파는 방법 중 무엇을 고민하나요?";
  if (step === 2) {
    return intent === "BUY"
      ? "얼마 안에서 매수 방법을 비교할까요?"
      : "보유한 몇 주를 기준으로 비교할까요?";
  }
  if (step === 3) return "언제까지 결정해야 하나요?";
  if (step === 4) return "두 상황 중 무엇을 더 피하고 싶나요?";
  return "가격이 얼마나 달라지면 멈추고 다시 볼까요?";
}

function isStepReady(
  step: GuidedTradeStep,
  input: DecisionConversationInput,
): boolean {
  if (step === 2) {
    return input.intent === "BUY"
      ? Number(input.budgetKrw) > 0
      : Number(input.holdingQuantity) > 0;
  }
  if (step === 5) {
    return Number.isFinite(input.maxAdverseMovePct) && input.maxAdverseMovePct > 0;
  }
  return true;
}

export function GuidedTradeAgent({
  open,
  input,
  step,
  completedSteps,
  loading,
  errorMessage,
  onInputChange,
  onContinue,
  onBack,
  onClose,
}: GuidedTradeAgentProps) {
  if (!open) return null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onContinue();
  }

  const previousSteps = completedSteps.filter((item) => item < step);
  const latestCompletedStep = previousSteps[previousSteps.length - 1];

  return (
    <aside className="guided-agent guided-agent--stepper" aria-labelledby="guided-agent-title">
      <header className="guided-agent__header">
        <div>
          <div className="guided-agent__identity">
            <span className="agent-ai-badge" aria-hidden="true">AI</span>
            <span>
              <strong>AI 매매 동반자</strong>
              <small>{loading ? "설명 확인 중" : `${step}단계 · ${STEP_LABELS[step]}`}</small>
            </span>
          </div>
          <h2 id="guided-agent-title">한 번에 하나씩 같이 정리할게요</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="가이드 닫기">
          닫기
        </button>
      </header>

      <div className="guided-agent__progress-wrap">
        <div className="guided-agent__progress-copy">
          <span>{step} / 5</span>
          <strong>{STEP_LABELS[step]}</strong>
        </div>
        <div className="guided-agent__progress" aria-label={`전체 5단계 중 ${step}단계`}>
          {[1, 2, 3, 4, 5].map((item) => (
            <span
              key={item}
              className={item <= step ? "is-active" : undefined}
              aria-label={`${item}단계${item === step ? " · 현재" : item < step ? " · 완료" : ""}`}
            />
          ))}
        </div>
      </div>

      {latestCompletedStep ? (
        <div className="guided-agent__latest" role="status" aria-live="polite">
          <span>방금 답변 · {answerForStep(latestCompletedStep, input)}</span>
          <p>{reflectionForStep(latestCompletedStep, input)}</p>
        </div>
      ) : null}

      <form className="guided-agent__form guided-agent__form--single-step" onSubmit={submit}>
        <section className="guided-agent__step-card" aria-labelledby="guided-agent-question">
          <span>{STEP_LABELS[step]}</span>
          <h3 id="guided-agent-question">{questionForStep(step, input.intent)}</h3>

          {step === 1 ? (
            <div className="guided-agent__choices guided-agent__intent-choices" role="group" aria-label="매수 또는 매도">
              {(["BUY", "SELL"] as const).map((intent) => (
                <button
                  key={intent}
                  type="button"
                  className="chip"
                  aria-pressed={input.intent === intent}
                  onClick={() =>
                    onInputChange((current) => ({
                      ...current,
                      intent,
                      budgetKrw: intent === "BUY" ? current.budgetKrw ?? 10_000_000 : null,
                      holdingQuantity: intent === "SELL" ? current.holdingQuantity ?? 100 : null,
                    }))
                  }
                >
                  <strong>{intent === "BUY" ? "사고 싶어요" : "팔고 싶어요"}</strong>
                  <span>{intent === "BUY" ? "예산 안에서 살 방법 비교" : "보유수량 안에서 팔 방법 비교"}</span>
                </button>
              ))}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="guided-agent__field-stack">
              <label>
                <span>{input.intent === "BUY" ? "사용할 예산" : "현재 보유수량"}</span>
                <input
                  type={input.intent === "BUY" ? "text" : "number"}
                  inputMode="numeric"
                  min={input.intent === "BUY" ? undefined : 1}
                  step={input.intent === "BUY" ? undefined : 1}
                  value={
                    input.intent === "BUY"
                      ? formatWholeNumberInput(input.budgetKrw)
                      : input.holdingQuantity ?? ""
                  }
                  onChange={(event) => {
                    const value = input.intent === "BUY"
                      ? parseWholeNumberInput(event.target.value)
                      : Number(event.target.value);
                    onInputChange((current) =>
                      current.intent === "BUY"
                        ? { ...current, budgetKrw: value }
                        : { ...current, holdingQuantity: value },
                    );
                  }}
                />
              </label>
              <div className="guided-agent__choices guided-agent__quick-choices" role="group" aria-label="빠른 금액 선택">
                {(input.intent === "BUY" ? [5_000_000, 10_000_000, 20_000_000] : [50, 100, 200]).map(
                  (value) => (
                    <button
                      key={value}
                      type="button"
                      className="chip"
                      aria-pressed={
                        input.intent === "BUY"
                          ? input.budgetKrw === value
                          : input.holdingQuantity === value
                      }
                      onClick={() =>
                        onInputChange((current) =>
                          current.intent === "BUY"
                            ? { ...current, budgetKrw: value }
                            : { ...current, holdingQuantity: value },
                        )
                      }
                    >
                      {input.intent === "BUY" ? formatKrw(value) : `${value}주`}
                    </button>
                  ),
                )}
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="guided-agent__choices guided-agent__choices--grid" role="group" aria-label="실행기한">
              {(Object.keys(DEADLINE_LABELS) as Array<keyof typeof DEADLINE_LABELS>).map(
                (deadline) => (
                  <button
                    key={deadline}
                    type="button"
                    className="chip"
                    aria-pressed={input.deadline === deadline}
                    onClick={() =>
                      onInputChange((current) => ({ ...current, deadline }))
                    }
                  >
                    {DEADLINE_LABELS[deadline]}
                  </button>
                ),
              )}
            </div>
          ) : null}

          {step === 4 ? (
            <div className="guided-agent__regret-choices" role="group" aria-label="더 피하고 싶은 상황">
              <button
                type="button"
                className="chip"
                aria-pressed={input.regretPriority === "MISSED_OPPORTUNITY"}
                onClick={() =>
                  onInputChange((current) => ({
                    ...current,
                    regretPriority: "MISSED_OPPORTUNITY",
                  }))
                }
              >
                <strong>기다리다 놓치는 게 더 걱정돼요</strong>
                <span>가격이 먼저 올라 계획한 수량을 놓치는 상황</span>
              </button>
              <button
                type="button"
                className="chip"
                aria-pressed={input.regretPriority === "PRICE_RISK"}
                onClick={() =>
                  onInputChange((current) => ({
                    ...current,
                    regretPriority: "PRICE_RISK",
                  }))
                }
              >
                <strong>산 뒤 내려가는 게 더 걱정돼요</strong>
                <span>한 번에 확인한 뒤 가격이 내려가는 상황</span>
              </button>
            </div>
          ) : null}

          {step === 5 ? (
            <fieldset className="guided-agent__tolerance">
              <legend>가격이 이만큼 달라지면 다시 확인할게요</legend>
              <p>미래 가격을 정하는 값이 아니라, 처음 세운 계획을 다시 볼 범위입니다.</p>
              <div className="guided-agent__choices guided-agent__tolerance-choices" role="group" aria-label="재확인 범위">
                {[4, 8, 15].map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="chip"
                    aria-pressed={input.maxAdverseMovePct === value}
                    onClick={() =>
                      onInputChange((current) => ({
                        ...current,
                        maxAdverseMovePct: value,
                      }))
                    }
                  >
                    <strong>{value}%</strong>
                    <span>{value === 4 ? "자주 확인" : value === 8 ? "보통" : "넓게 확인"}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}
        </section>

        {errorMessage ? (
          <p className="guided-agent__error" role="alert">{errorMessage}</p>
        ) : null}

        <div className="guided-agent__actions">
          {step > 1 ? (
            <button type="button" className="btn btn--secondary" onClick={onBack} disabled={loading}>
              이전 단계
            </button>
          ) : null}
          <button type="submit" className="btn btn--primary" disabled={loading || !isStepReady(step, input)}>
            {loading ? (
              <>
                <span className="agent-ai-action-badge" aria-hidden="true">AI</span>
                공개 데이터로 설명을 확인하고 있어요…
              </>
            ) : step === 5 ? "AI로 실행안 비교하기" : "다음 질문"}
          </button>
        </div>
      </form>
    </aside>
  );
}
