"use client";

import type {
  AgentDecisionExplanation,
  DecisionConversationInput,
} from "@/lib/decision-contracts";
import type {
  ExecutionCoreSuccess,
  ExecutionPlan,
} from "@/lib/execution-core";
import { planLabel } from "@/lib/trading-demo";

type ExecutionOptionsPanelProps = {
  input: DecisionConversationInput;
  decision: ExecutionCoreSuccess;
  explanation: AgentDecisionExplanation | null;
  selectedPlanId: ExecutionPlan["id"];
  previousRegret: DecisionConversationInput["regretPriority"] | null;
  previousPreferredPlanId: ExecutionPlan["id"] | null;
  aiState: "IDLE" | "LOADING" | "SUCCESS" | "FAILURE";
  aiMessage: string | null;
  canPracticeOrder: boolean;
  aiExplanationEnabled?: boolean;
  onSelectPlan: (planId: ExecutionPlan["id"]) => void;
  onChangeRegret: (regret: DecisionConversationInput["regretPriority"]) => void;
  onRequestAi: () => void;
  onOpenOrder: () => void;
};

function formatKrw(value: number): string {
  return `${new Intl.NumberFormat("ko-KR").format(Math.round(value))}원`;
}

function regretLabel(
  regret: DecisionConversationInput["regretPriority"],
): string {
  return regret === "MISSED_OPPORTUNITY"
    ? "기다리다 놓치는 후회"
    : "산 뒤 내려가는 후회";
}

export function ExecutionOptionsPanel({
  input,
  decision,
  explanation,
  selectedPlanId,
  previousRegret,
  previousPreferredPlanId,
  aiState,
  aiMessage,
  canPracticeOrder,
  aiExplanationEnabled = true,
  onSelectPlan,
  onChangeRegret,
  onRequestAi,
  onOpenOrder,
}: ExecutionOptionsPanelProps) {
  const selectedPlan =
    decision.plans.find((plan) => plan.id === selectedPlanId) ??
    decision.plans[0];
  if (!selectedPlan) return null;

  return (
    <section className="execution-options" aria-labelledby="execution-options-title">
      <header className="execution-options__header">
        <div>
          <span>내가 더 걱정한 상황을 반영했어요</span>
          <h2 id="execution-options-title">먼저 비교해 볼 방법</h2>
          <p>
            입력한 답변을 기준으로 <strong>{planLabel(decision.preferredPlanId)}</strong>을
            먼저 보여드려요.
          </p>
        </div>
        <strong className="execution-options__not-prediction">
          미래 가격을 예측한 결과가 아니에요
        </strong>
      </header>

      {input.intent === "BUY" ? (
        <div className="execution-options__regret-switch" role="group" aria-label="후회 우선순위 바꾸기">
          <span>더 피하고 싶은 상황</span>
          <button
            type="button"
            className="chip"
            aria-pressed={input.regretPriority === "MISSED_OPPORTUNITY"}
            onClick={() => onChangeRegret("MISSED_OPPORTUNITY")}
          >
            기다리다 놓치기
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={input.regretPriority === "PRICE_RISK"}
            onClick={() => onChangeRegret("PRICE_RISK")}
          >
            산 뒤 내려가기
          </button>
        </div>
      ) : null}

      {input.intent === "BUY" && previousRegret && previousRegret !== input.regretPriority ? (
        <details className="execution-options__counterfactual" open>
          <summary>왜 이 계획이 달라졌나요?</summary>
          <p>
            더 피하고 싶은 상황을 <strong>{regretLabel(previousRegret)}</strong>에서{" "}
            <strong>{regretLabel(input.regretPriority)}</strong>로 바꿨습니다.
            {previousPreferredPlanId && previousPreferredPlanId !== decision.preferredPlanId
              ? ` 그래서 우선안이 ${planLabel(previousPreferredPlanId)}에서 ${planLabel(decision.preferredPlanId)}으로 바뀌었습니다.`
              : " 총수량은 유지하고 먼저 확인할 비중과 재확인 조건을 다시 계산했습니다."}
          </p>
        </details>
      ) : null}

      <div className="execution-options__plans">
        {decision.plans.map((plan) => (
          <article
            key={plan.id}
            className={`execution-option${selectedPlanId === plan.id ? " is-selected" : ""}${decision.preferredPlanId === plan.id ? " is-preferred" : ""}`}
          >
            <button
              type="button"
              aria-pressed={selectedPlanId === plan.id}
              onClick={() => onSelectPlan(plan.id)}
            >
              <span>{decision.preferredPlanId === plan.id ? "우선 검토" : "비교안"}</span>
              <h3>{planLabel(plan.id)}</h3>
              <strong>{plan.totalShares.toLocaleString("ko-KR")}주</strong>
              <small className="execution-option__total-amount">
                <span>기준금액</span>
                <strong>{formatKrw(plan.referenceTotalAmountKrw)}</strong>
              </small>
            </button>
            <ol aria-label={`${planLabel(plan.id)} 회차별 수량`}>
              {plan.allocations.map((allocation) => (
                <li key={`${plan.id}-${allocation.sequence}`}>
                  <span>{allocation.sequence}회차</span>
                  <strong>{allocation.shares.toLocaleString("ko-KR")}주</strong>
                  <small className="execution-option__allocation-amount">
                    {formatKrw(allocation.amountKrw)}
                  </small>
                </li>
              ))}
            </ol>
            <p>{plan.benefits[0]}</p>
            <p className="execution-option__risk">감수할 점 · {plan.tradeoffs[0]}</p>
          </article>
        ))}
      </div>

      <div className="execution-options__explanation">
        <div>
          <span>{explanation ? "AI가 쉽게 설명한 이유" : "이 방법을 먼저 보여드리는 이유"}</span>
          <p>{explanation?.priorityReason ?? decision.preferredExplanation}</p>
        </div>
        {aiExplanationEnabled && aiState === "IDLE" ? (
          <button type="button" className="btn btn--secondary" onClick={onRequestAi}>
            AI에게 쉽게 설명받기
          </button>
        ) : null}
        {aiExplanationEnabled && aiState === "LOADING" ? <small>AI가 쉬운 설명을 정리하고 있어요.</small> : null}
        {aiExplanationEnabled && aiState === "FAILURE" ? (
          <div className="execution-options__ai-error">
            <small>
              {aiMessage ?? "AI가 쉬운 설명을 만들지 못했습니다. 계산된 비교안은 바뀌지 않았어요."}
            </small>
            <button type="button" className="btn btn--secondary" onClick={onRequestAi}>쉬운 설명 다시 받아보기</button>
          </div>
        ) : null}
      </div>

      <div className="execution-options__review-line">
        <span>이 범위를 벗어나면 멈추고 다시 확인</span>
        <strong>
          {formatKrw(selectedPlan.reviewLine.lowerReviewPriceKrw)} –{" "}
          {formatKrw(selectedPlan.reviewLine.upperReviewPriceKrw)}
        </strong>
        <p>{selectedPlan.reviewLine.meaning}</p>
      </div>

      <div className="execution-options__order-action">
        <p>시장가와 지정가의 차이는 주문 미리보기에서 선택한 계획과 함께 확인할 수 있어요.</p>
        <button
          type="button"
          className="execution-options__order-button btn btn--primary"
          onClick={onOpenOrder}
          disabled={!canPracticeOrder}
        >
          {canPracticeOrder
            ? selectedPlan.installmentCount === 1
              ? "일괄 주문 미리보기"
              : `${selectedPlan.installmentCount}회 분할 주문 미리보기`
            : aiState === "LOADING"
              ? "설명이 준비되면 주문 연습 가능"
              : "쉬운 설명을 다시 확인하면 주문 연습 가능"}
        </button>
      </div>
    </section>
  );
}
