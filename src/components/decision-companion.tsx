"use client";

import { FormEvent, useId, useState } from "react";

import { DecisionResultCard } from "@/components/decision-result-card";
import {
  DecisionConversationInputSchema,
  DecisionEnvelopeSchema,
  type DecisionConversationInput,
  type DecisionEnvelope,
} from "@/lib/decision-contracts";
import {
  DECISION_DEMO_BASELINE,
  DECISION_DEMO_TOLERANCE_CHANGE,
  isRegisteredDecisionDemoInput,
  runOfflineDecisionDemo,
} from "@/lib/decision-demo";

type ConversationStep = 1 | 2 | 3 | 4;
type RequestedMode = "LIVE" | "OFFLINE_DEMO";

const DEADLINE_LABELS = {
  NOW: "지금 바로",
  TODAY: "오늘 안에",
  THIS_WEEK: "이번 주 안에",
  NO_RUSH: "급하지 않게",
} as const;

function cloneInput(input: DecisionConversationInput): DecisionConversationInput {
  return structuredClone(input);
}

function formatKrw(value: number): string {
  return `${new Intl.NumberFormat("ko-KR").format(value)}원`;
}

function recapForStep(
  step: ConversationStep,
  input: DecisionConversationInput,
): string {
  if (step === 1) {
    return `${input.subjectLabel}(${input.symbol})를 ${input.intent === "BUY" ? "사고 싶은" : "팔고 싶은"} 고민이군요.`;
  }
  if (step === 2) {
    const exposure =
      input.intent === "BUY"
        ? `${formatKrw(input.budgetKrw ?? 0)} 예산`
        : `${(input.holdingQuantity ?? 0).toLocaleString("ko-KR")}주 보유수량`;
    return `${exposure}을 두고 ${DEADLINE_LABELS[input.deadline]} 결정하려는 상황이군요.`;
  }
  if (step === 3) {
    return input.regretPriority === "PRICE_RISK"
      ? "한 시점 가격에 전체 수량이 몰리는 위험이 더 걱정되시는군요."
      : "나누어 확인하는 동안 기회를 놓치는 위험이 더 걱정되시는군요.";
  }
  return `기준 가격에서 ${input.maxAdverseMovePct}%까지 움직이는 상황을 감당 범위로 이해했어요.`;
}

function answerForStep(
  step: ConversationStep,
  input: DecisionConversationInput,
): string {
  if (step === 1) {
    return `${input.subjectLabel} · ${input.symbol} · ${input.intent === "BUY" ? "사고 싶어요" : "팔고 싶어요"}`;
  }
  if (step === 2) {
    return input.intent === "BUY"
      ? `${formatKrw(input.budgetKrw ?? 0)} · ${DEADLINE_LABELS[input.deadline]}`
      : `${(input.holdingQuantity ?? 0).toLocaleString("ko-KR")}주 · ${DEADLINE_LABELS[input.deadline]}`;
  }
  if (step === 3) {
    return input.regretPriority === "PRICE_RISK"
      ? "한 번에 거래했을 때의 가격 위험"
      : "나누는 동안 기회를 놓치는 위험";
  }
  return `${input.maxAdverseMovePct}%`;
}

function makeClientFailure(
  input: DecisionConversationInput,
  code: "CLIENT_NETWORK_ERROR" | "CLIENT_RESPONSE_ERROR",
): DecisionEnvelope {
  return DecisionEnvelopeSchema.parse({
    status: "SAFETY_PAUSE",
    generation: {
      requestedMode: "LIVE",
      mode: "LIVE",
      outcome: "FAILURE",
      failureCode: code,
      fixtureId: null,
      fixtureVersion: null,
      model: null,
    },
    market: {
      mode: "NOT_CALLED",
      outcome: "SKIPPED",
      failureCode: null,
      snapshot: null,
    },
    inputSnapshot: input,
    decision: null,
    explanation: null,
    failureMessage:
      code === "CLIENT_NETWORK_ERROR"
        ? "서버에 연결하지 못해 시장 데이터와 AI 상태를 확인할 수 없습니다."
        : "서버 답변을 안전하게 확인하지 못해 새 실행안을 표시하지 않습니다.",
  });
}

function onlyToleranceChanged(
  previous: DecisionConversationInput,
  current: DecisionConversationInput,
): boolean {
  const { maxAdverseMovePct: previousTolerance, ...previousRest } = previous;
  const { maxAdverseMovePct: currentTolerance, ...currentRest } = current;
  return (
    previousTolerance !== currentTolerance &&
    JSON.stringify(previousRest) === JSON.stringify(currentRest)
  );
}

export function DecisionCompanion() {
  const fieldId = useId();
  const [mode, setMode] = useState<RequestedMode>("OFFLINE_DEMO");
  const [input, setInput] = useState<DecisionConversationInput>(() =>
    cloneInput(DECISION_DEMO_BASELINE),
  );
  const [step, setStep] = useState<ConversationStep>(1);
  const [completedSteps, setCompletedSteps] = useState<ConversationStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DecisionEnvelope | null>(null);
  const [previousResult, setPreviousResult] = useState<DecisionEnvelope | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function clearResult() {
    setResult(null);
    setPreviousResult(null);
    setMessage(null);
  }

  function selectMode(nextMode: RequestedMode) {
    if (loading || nextMode === mode) return;
    setMode(nextMode);
    clearResult();
  }

  function updateInput(mutator: (current: DecisionConversationInput) => DecisionConversationInput) {
    if (loading) return;
    setInput((current) => mutator(current));
    setResult(null);
    setMessage(null);
  }

  function completeStep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = DecisionConversationInputSchema.safeParse(input);
    if (!parsed.success) {
      const currentIssue = parsed.error.issues.find((issue) => {
        const root = issue.path[0];
        if (step === 1) return root === "subjectLabel" || root === "symbol";
        if (step === 2) return root === "budgetKrw" || root === "holdingQuantity";
        return false;
      });
      if (currentIssue) {
        setMessage(currentIssue.message);
        return;
      }
    }

    setCompletedSteps((current) =>
      current.includes(step) ? current : [...current, step].sort(),
    );
    setMessage(null);

    if (step < 4) {
      setStep((step + 1) as ConversationStep);
      return;
    }

    void generateDecision(input);
  }

  async function generateDecision(targetInput: DecisionConversationInput) {
    if (loading) return;
    const parsed = DecisionConversationInputSchema.safeParse(targetInput);
    if (!parsed.success) {
      setMessage(parsed.error.issues[0]?.message ?? "입력 내용을 확인해 주세요.");
      return;
    }

    const prior = result?.inputSnapshot && onlyToleranceChanged(result.inputSnapshot, parsed.data)
      ? result
      : null;
    setLoading(true);
    setMessage(null);
    setResult(null);
    setPreviousResult(null);

    if (mode === "OFFLINE_DEMO") {
      if (!isRegisteredDecisionDemoInput(parsed.data)) {
        setMessage(
          "합성 예시는 준비된 삼성전자 입력과 감당 범위 변경만 지원합니다. 내가 입력한 값은 ‘AI와 공개 데이터’에서 분석해 주세요.",
        );
        setLoading(false);
        return;
      }
      const scenario =
        parsed.data.maxAdverseMovePct ===
        DECISION_DEMO_TOLERANCE_CHANGE.maxAdverseMovePct
          ? "TOLERANCE_CHANGE"
          : "BASELINE";
      const envelope = runOfflineDecisionDemo(scenario);
      setPreviousResult(prior);
      setResult(envelope);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch("/api/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "LIVE", input: parsed.data }),
        signal: controller.signal,
      });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new Error("CLIENT_RESPONSE_ERROR");
      }
      const envelope = DecisionEnvelopeSchema.safeParse(body);
      if (!envelope.success) throw new Error("CLIENT_RESPONSE_ERROR");
      if (!response.ok && envelope.data.status === "READY_FOR_REVIEW") {
        throw new Error("CLIENT_RESPONSE_ERROR");
      }
      setPreviousResult(envelope.data.status === "READY_FOR_REVIEW" ? prior : null);
      setResult(envelope.data);
    } catch (error: unknown) {
      const code =
        error instanceof Error && error.message === "CLIENT_RESPONSE_ERROR"
          ? "CLIENT_RESPONSE_ERROR"
          : "CLIENT_NETWORK_ERROR";
      setPreviousResult(null);
      setResult(makeClientFailure(parsed.data, code));
    } finally {
      window.clearTimeout(timeoutId);
      setLoading(false);
    }
  }

  function restartBaseline() {
    if (loading) return;
    setInput(cloneInput(DECISION_DEMO_BASELINE));
    setStep(1);
    setCompletedSteps([]);
    clearResult();
  }

  function runToleranceChange() {
    if (loading) return;
    const nextInput = cloneInput(DECISION_DEMO_TOLERANCE_CHANGE);
    const current = result;
    setInput(nextInput);
    setStep(4);
    setCompletedSteps([1, 2, 3, 4]);
    if (current?.status === "READY_FOR_REVIEW") {
      setPreviousResult(current);
    }
    void generateDecision(nextInput);
  }

  function showDataFailure() {
    if (loading || mode !== "OFFLINE_DEMO") return;
    setPreviousResult(null);
    setResult(runOfflineDecisionDemo("DATA_FAILURE"));
    setMessage(null);
  }

  function changeChoice(targetStep: ConversationStep) {
    if (loading) return;
    setPreviousResult(result?.status === "READY_FOR_REVIEW" ? result : null);
    setResult(null);
    setStep(targetStep);
    setCompletedSteps((current) => current.filter((item) => item < targetStep));
    setMessage(null);
    document.getElementById(`${fieldId}-conversation`)?.scrollIntoView({ behavior: "smooth" });
  }

  const activeQuestion =
    step === 1
      ? "어떤 종목을 사고 싶거나 팔고 싶으신가요?"
      : step === 2
        ? input.intent === "BUY"
          ? "얼마를 언제까지 매수할지 고민하고 계신가요?"
          : "몇 주를 언제까지 매도할지 고민하고 계신가요?"
        : step === 3
          ? "두 가지 후회 중 어느 쪽을 더 줄이고 싶으신가요?"
          : "기준 가격에서 어느 정도 움직임까지 감당할 수 있나요?";

  return (
    <div className="planner-shell">
      <header className="hero companion-hero">
        <p className="hero__eyebrow">ACTION PLANNER · REGRET BUDGET</p>
        <h1 className="hero__title">매수·매도 고민을 함께 풀어볼게요</h1>
        <p className="hero__description">
          한 번에 거래할지 나누어 거래할지, 내가 더 피하고 싶은 후회를 기준으로 비교합니다.
        </p>
        <details className="hero__how">
          <summary>어떻게 판단하나요?</summary>
          <ul>
            <li>사용자가 답한 고민과 Yahoo Finance에서 확인한 시장 사실을 분리합니다.</li>
            <li>금액·수량·재확인선은 서버의 결정 코어가 계산합니다.</li>
            <li>AI는 계산을 바꾸지 않고 우선 검토할 안과 이유만 쉽게 설명합니다.</li>
          </ul>
        </details>
      </header>

      <div className="workspace-grid companion-workspace">
        <section className="panel panel--form companion-panel" aria-labelledby="companion-title">
          <header className="panel__header">
            <p className="eyebrow">최대 네 번의 질문</p>
            <h2 id="companion-title">후회 예산 찾기</h2>
            <p>정답을 맞히는 과정이 아니라 내가 더 피하고 싶은 후회를 확인하는 과정입니다.</p>
          </header>

          <fieldset className="mode-selector companion-mode">
            <legend>어떤 데이터로 볼까요?</legend>
            <div className="mode-selector__buttons">
              <button
                type="button"
                data-testid="mode-offline-demo"
                aria-pressed={mode === "OFFLINE_DEMO"}
                className={`mode-button${mode === "OFFLINE_DEMO" ? " is-active" : ""}`}
                onClick={() => selectMode("OFFLINE_DEMO")}
                disabled={loading}
              >
                <strong>합성 예시로 체험</strong>
                <span>인터넷 없이 고정된 예시를 사용해요</span>
              </button>
              <button
                type="button"
                data-testid="mode-live"
                aria-pressed={mode === "LIVE"}
                className={`mode-button${mode === "LIVE" ? " is-active" : ""}`}
                onClick={() => selectMode("LIVE")}
                disabled={loading}
              >
                <strong>AI와 공개 데이터</strong>
                <span>Yahoo Finance를 새로 확인해요</span>
              </button>
            </div>
          </fieldset>

          <div className="demo-shortcuts" aria-label="대표 시연 바로가기">
            <button type="button" className="secondary-button" onClick={restartBaseline} disabled={loading}>
              대표 예시 처음부터
            </button>
            <button
              type="button"
              className="secondary-button"
              data-testid="demo-tolerance-change"
              onClick={runToleranceChange}
              disabled={loading || !result}
            >
              감당 범위 낮춰 보기
            </button>
            <button
              type="button"
              className="secondary-button"
              data-testid="demo-data-failure"
              onClick={showDataFailure}
              disabled={loading || mode !== "OFFLINE_DEMO"}
            >
              데이터 실패 보기
            </button>
          </div>

          <div
            id={`${fieldId}-conversation`}
            className="conversation-log"
            role="log"
            aria-live="polite"
            aria-label="에이전트와 나눈 답변"
          >
            {completedSteps.map((completedStep) => (
              <div className="conversation-turn" key={completedStep}>
                <div className="chat-bubble chat-bubble--user">
                  <span>나</span>
                  <p>{answerForStep(completedStep, input)}</p>
                  <button type="button" onClick={() => changeChoice(completedStep)} disabled={loading}>
                    바꾸기
                  </button>
                </div>
                <div className="chat-bubble chat-bubble--agent">
                  <span>의사결정 동반자</span>
                  <p>{recapForStep(completedStep, input)}</p>
                </div>
              </div>
            ))}

            {!completedSteps.includes(step) ? (
              <div className="chat-bubble chat-bubble--agent chat-bubble--question">
                <span>질문 {step} / 4</span>
                <p>{activeQuestion}</p>
              </div>
            ) : null}
          </div>

          <form className="conversation-form" onSubmit={completeStep}>
            {step === 1 ? (
              <div className="conversation-fields">
                <div className="quick-choice-row">
                  <button
                    type="button"
                    className="quick-choice is-selected"
                    onClick={() =>
                      updateInput((current) => ({
                        ...current,
                        subjectLabel: "삼성전자",
                        symbol: "005930.KS",
                      }))
                    }
                  >
                    삼성전자 예시
                  </button>
                </div>
                <label className="field" htmlFor={`${fieldId}-subject`}>
                  <span>종목 이름</span>
                  <input
                    id={`${fieldId}-subject`}
                    value={input.subjectLabel}
                    onChange={(event) =>
                      updateInput((current) => ({ ...current, subjectLabel: event.target.value }))
                    }
                    placeholder="예: 삼성전자"
                  />
                </label>
                <label className="field" htmlFor={`${fieldId}-symbol`}>
                  <span>Yahoo Finance 종목 코드</span>
                  <input
                    id={`${fieldId}-symbol`}
                    value={input.symbol}
                    onChange={(event) =>
                      updateInput((current) => ({ ...current, symbol: event.target.value.toUpperCase() }))
                    }
                    placeholder="예: 005930.KS"
                  />
                  <small>현재 수직 흐름은 원화로 거래되는 국내 주식만 지원합니다.</small>
                </label>
                <div className="quick-choice-row" role="group" aria-label="매수 또는 매도 선택">
                  {(["BUY", "SELL"] as const).map((intent) => (
                    <button
                      key={intent}
                      type="button"
                      className={`quick-choice${input.intent === intent ? " is-selected" : ""}`}
                      aria-pressed={input.intent === intent}
                      onClick={() =>
                        updateInput((current) => ({
                          ...current,
                          intent,
                          budgetKrw: intent === "BUY" ? current.budgetKrw ?? 10_000_000 : null,
                          holdingQuantity: intent === "SELL" ? current.holdingQuantity ?? 100 : null,
                        }))
                      }
                    >
                      {intent === "BUY" ? "사고 싶어요" : "팔고 싶어요"}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="conversation-fields">
                {input.intent === "BUY" ? (
                  <label className="field" htmlFor={`${fieldId}-budget`}>
                    <span>사용할 예산</span>
                    <input
                      id={`${fieldId}-budget`}
                      type="number"
                      min={10_000}
                      step={10_000}
                      value={input.budgetKrw ?? ""}
                      onChange={(event) =>
                        updateInput((current) => ({
                          ...current,
                          budgetKrw: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                ) : (
                  <label className="field" htmlFor={`${fieldId}-quantity`}>
                    <span>현재 보유수량</span>
                    <input
                      id={`${fieldId}-quantity`}
                      type="number"
                      min={1}
                      step={1}
                      value={input.holdingQuantity ?? ""}
                      onChange={(event) =>
                        updateInput((current) => ({
                          ...current,
                          holdingQuantity: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                )}
                {input.intent === "BUY" ? (
                  <div className="quick-choice-row" role="group" aria-label="예산 빠른 선택">
                    {[5_000_000, 10_000_000, 20_000_000].map((budget) => (
                      <button
                        key={budget}
                        type="button"
                        className={`quick-choice${input.budgetKrw === budget ? " is-selected" : ""}`}
                        aria-pressed={input.budgetKrw === budget}
                        onClick={() => updateInput((current) => ({ ...current, budgetKrw: budget }))}
                      >
                        {formatKrw(budget)}
                      </button>
                    ))}
                  </div>
                ) : null}
                <fieldset className="choice-fieldset">
                  <legend>실행기한</legend>
                  <div className="quick-choice-row">
                    {(Object.keys(DEADLINE_LABELS) as Array<keyof typeof DEADLINE_LABELS>).map(
                      (deadline) => (
                        <button
                          key={deadline}
                          type="button"
                          className={`quick-choice${input.deadline === deadline ? " is-selected" : ""}`}
                          aria-pressed={input.deadline === deadline}
                          onClick={() => updateInput((current) => ({ ...current, deadline }))}
                        >
                          {DEADLINE_LABELS[deadline]}
                        </button>
                      ),
                    )}
                  </div>
                </fieldset>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="risk-choice-grid">
                <button
                  type="button"
                  className={`risk-choice${input.regretPriority === "PRICE_RISK" ? " is-selected" : ""}`}
                  aria-pressed={input.regretPriority === "PRICE_RISK"}
                  onClick={() =>
                    updateInput((current) => ({ ...current, regretPriority: "PRICE_RISK" }))
                  }
                >
                  <strong>한 가격에 몰릴까 봐 걱정돼요</strong>
                  <span>한 번에 거래한 뒤 가격이 움직일 때의 후회를 줄이고 싶어요.</span>
                </button>
                <button
                  type="button"
                  className={`risk-choice${input.regretPriority === "MISSED_OPPORTUNITY" ? " is-selected" : ""}`}
                  aria-pressed={input.regretPriority === "MISSED_OPPORTUNITY"}
                  onClick={() =>
                    updateInput((current) => ({
                      ...current,
                      regretPriority: "MISSED_OPPORTUNITY",
                    }))
                  }
                >
                  <strong>나누다 놓칠까 봐 걱정돼요</strong>
                  <span>기다리는 동안 계획한 수량을 다루지 못할 후회를 줄이고 싶어요.</span>
                </button>
              </div>
            ) : null}

            {step === 4 ? (
              <div className="conversation-fields">
                <label className="field" htmlFor={`${fieldId}-tolerance`}>
                  <span>감당 가능한 손실·변동 범위</span>
                  <input
                    id={`${fieldId}-tolerance`}
                    type="number"
                    min={0.5}
                    max={30}
                    step={0.5}
                    value={input.maxAdverseMovePct}
                    onChange={(event) =>
                      updateInput((current) => ({
                        ...current,
                        maxAdverseMovePct: Number(event.target.value),
                      }))
                    }
                  />
                  <small>기준 가격에서 이 범위를 벗어나면 자동 거래가 아니라 새 데이터로 다시 비교합니다.</small>
                </label>
                <div className="quick-choice-row" role="group" aria-label="감당 범위 빠른 선택">
                  {[4, 8, 15].map((tolerance) => (
                    <button
                      key={tolerance}
                      type="button"
                      className={`quick-choice${input.maxAdverseMovePct === tolerance ? " is-selected" : ""}`}
                      aria-pressed={input.maxAdverseMovePct === tolerance}
                      onClick={() =>
                        updateInput((current) => ({
                          ...current,
                          maxAdverseMovePct: tolerance,
                        }))
                      }
                    >
                      {tolerance}%
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {message ? <p className="form-note form-note--error" role="alert">{message}</p> : null}
            <button
              type="submit"
              className="primary-button conversation-submit"
              data-testid="conversation-continue"
              disabled={loading}
            >
              {loading
                ? mode === "LIVE"
                  ? "시장 데이터와 AI 설명을 확인하고 있어요…"
                  : "합성 예시를 계산하고 있어요…"
                : step === 4
                  ? mode === "LIVE"
                    ? "공개 데이터로 실행안 비교하기"
                    : "합성 예시로 실행안 비교하기"
                  : "이 답변으로 계속하기"}
            </button>
          </form>
        </section>

        <section className="panel result-panel companion-result" aria-labelledby="result-title" aria-busy={loading}>
          <header className="panel__header">
            <p className="eyebrow">실행 의사결정 비교</p>
            <h2 id="result-title">한 번에 거래할지, 나누어 거래할지</h2>
            <p>시장 사실과 사용자 고민을 구분한 뒤 금액·수량·중단 조건을 함께 보여줍니다.</p>
          </header>

          <div className="result-region" aria-live="polite">
            {loading ? (
              <div className="loading-state client-message" role="status">
                <strong>새 결과를 만들고 있어요.</strong>
                <p>이전 결과나 합성 성공을 현재 결과처럼 대신 보여주지 않습니다.</p>
              </div>
            ) : null}
            {!loading && result ? (
              <DecisionResultCard
                envelope={result}
                previousEnvelope={previousResult}
                onChangeChoice={changeChoice}
              />
            ) : null}
            {!loading && !result ? (
              <div className="empty-state">
                <p className="empty-state__index">고민 확인 → 공개 데이터 → 실행안 비교</p>
                <h3>네 가지 답변을 기다리고 있어요.</h3>
                <p>왼쪽에서 답하면 제가 이해한 고민을 되짚고, 마지막에 일괄안과 분할안을 비교합니다.</p>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <footer className="scope-footer">
        <strong>이 도구의 경계</strong>
        <p>
          종목을 고르거나 미래 가격을 예측하지 않습니다. 표시 수치는 공개 데이터와 사용자 입력으로 계산한 검토값이며 실제 주문을 실행하지 않습니다.
        </p>
      </footer>
    </div>
  );
}
