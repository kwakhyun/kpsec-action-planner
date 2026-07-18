"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";

import type { DecisionConversationInput } from "@/lib/decision-contracts";

export type GuidedTradeStep = 1 | 2 | 3 | 4;

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
  onEdit: (step: GuidedTradeStep) => void;
  onClose: () => void;
};

const DEADLINE_LABELS = {
  NOW: "지금 바로",
  TODAY: "오늘 안에",
  THIS_WEEK: "이번 주 안에",
  NO_RUSH: "급하지 않아요",
} as const;

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
  return input.regretPriority === "MISSED_OPPORTUNITY"
    ? "기다리다 가격이 올라 놓치는 후회"
    : "한 번에 산 뒤 가격이 내려가는 후회";
}

function reflectionForStep(
  step: GuidedTradeStep,
  input: DecisionConversationInput,
): string {
  if (step === 1) {
    return `${input.subjectLabel} 종목을 ${input.intent === "BUY" ? "사고" : "팔고"} 싶은 상황이군요.`;
  }
  if (step === 2) {
    return input.intent === "BUY"
      ? `${formatKrw(input.budgetKrw ?? 0)} 안에서 실행 방법을 비교해 볼게요.`
      : `보유한 ${(input.holdingQuantity ?? 0).toLocaleString("ko-KR")}주를 기준으로 비교해 볼게요.`;
  }
  if (step === 3) {
    return `${DEADLINE_LABELS[input.deadline]} 결정해야 하는 상황으로 이해했어요.`;
  }
  return input.regretPriority === "MISSED_OPPORTUNITY"
    ? "가격이 먼저 올라 계획한 수량을 놓치는 쪽이 더 걱정되시는군요."
    : "한 번에 확인한 뒤 가격이 내려가는 쪽이 더 걱정되시는군요.";
}

function questionForStep(
  step: GuidedTradeStep,
  intent: DecisionConversationInput["intent"],
): string {
  if (step === 1) return "매수와 매도 중 어떤 고민인가요?";
  if (step === 2) {
    return intent === "BUY"
      ? "얼마 안에서 매수 방법을 비교할까요?"
      : "보유한 몇 주를 기준으로 비교할까요?";
  }
  if (step === 3) return "언제까지 결정해야 하나요?";
  return "두 가지 후회 중 무엇을 더 피하고 싶나요?";
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
  onEdit,
  onClose,
}: GuidedTradeAgentProps) {
  if (!open) return null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onContinue();
  }

  return (
    <aside className="guided-agent" aria-labelledby="guided-agent-title">
      <header className="guided-agent__header">
        <div>
          <span>가이드형 매매 동반자</span>
          <h2 id="guided-agent-title">실행 방법을 같이 비교해 볼게요</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="가이드 닫기">
          닫기
        </button>
      </header>

      <div className="guided-agent__progress" aria-label={`전체 4단계 중 ${step}단계`}>
        {[1, 2, 3, 4].map((item) => (
          <span
            key={item}
            className={item <= step ? "is-active" : undefined}
            aria-hidden="true"
          />
        ))}
      </div>

      <div className="guided-agent__conversation" role="log" aria-live="polite">
        {completedSteps.map((completedStep) => (
          <div className="guided-agent__turn" key={completedStep}>
            <div className="guided-agent__answer">
              <span>내 답변</span>
              <p>{answerForStep(completedStep, input)}</p>
              <button type="button" onClick={() => onEdit(completedStep)} disabled={loading}>
                수정
              </button>
            </div>
            <div className="guided-agent__reflection">
              <span>동반자</span>
              <p>{reflectionForStep(completedStep, input)}</p>
            </div>
          </div>
        ))}

        {!completedSteps.includes(step) ? (
          <div className="guided-agent__question">
            <span>{step} / 4</span>
            <p>{questionForStep(step, input.intent)}</p>
          </div>
        ) : null}
      </div>

      <form className="guided-agent__form" onSubmit={submit}>
        {step === 1 ? (
          <div className="guided-agent__choices" role="group" aria-label="매수 또는 매도">
            {(["BUY", "SELL"] as const).map((intent) => (
              <button
                key={intent}
                type="button"
                aria-pressed={input.intent === intent}
                onClick={() =>
                  onInputChange((current) => ({
                    ...current,
                    intent,
                    budgetKrw: intent === "BUY" ? current.budgetKrw ?? 10_000_000 : null,
                    holdingQuantity:
                      intent === "SELL" ? current.holdingQuantity ?? 100 : null,
                  }))
                }
              >
                {intent === "BUY" ? "매수 고민" : "매도 고민"}
              </button>
            ))}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="guided-agent__field-stack">
            <label>
              <span>{input.intent === "BUY" ? "사용할 예산" : "현재 보유수량"}</span>
              <input
                type="number"
                min={input.intent === "BUY" ? 10_000 : 1}
                step={input.intent === "BUY" ? 10_000 : 1}
                value={
                  input.intent === "BUY"
                    ? input.budgetKrw ?? ""
                    : input.holdingQuantity ?? ""
                }
                onChange={(event) => {
                  const value = Number(event.target.value);
                  onInputChange((current) =>
                    current.intent === "BUY"
                      ? { ...current, budgetKrw: value }
                      : { ...current, holdingQuantity: value },
                  );
                }}
              />
            </label>
            <div className="guided-agent__choices" role="group" aria-label="빠른 금액 선택">
              {(input.intent === "BUY" ? [5_000_000, 10_000_000, 20_000_000] : [50, 100, 200]).map(
                (value) => (
                  <button
                    key={value}
                    type="button"
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
          <div className="guided-agent__field-stack">
            <div className="guided-agent__regret-choices" role="group" aria-label="더 피하고 싶은 후회">
              <button
                type="button"
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
            <fieldset className="guided-agent__tolerance">
              <legend>재확인 기준</legend>
              <p>기준 가격에서 이 범위를 벗어나면 멈추고 다시 봅니다.</p>
              <div className="guided-agent__choices" role="group" aria-label="재확인 범위">
                {[4, 8, 15].map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={input.maxAdverseMovePct === value}
                    onClick={() =>
                      onInputChange((current) => ({
                        ...current,
                        maxAdverseMovePct: value,
                      }))
                    }
                  >
                    {value}%
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        ) : null}

        {errorMessage ? (
          <p className="guided-agent__error" role="alert">{errorMessage}</p>
        ) : null}

        <div className="guided-agent__actions">
          {step > 1 ? (
            <button type="button" onClick={onBack} disabled={loading}>
              이전
            </button>
          ) : null}
          <button type="submit" disabled={loading}>
            {loading ? "공개 데이터와 설명을 확인하고 있어요…" : step === 4 ? "실행안 만들기" : "계속"}
          </button>
        </div>
      </form>
    </aside>
  );
}
