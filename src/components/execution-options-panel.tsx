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
  orderStylePreference: "FAST_EXECUTION" | "PRICE_CONTROL" | "UNSURE";
  onSelectPlan: (planId: ExecutionPlan["id"]) => void;
  onChangeRegret: (regret: DecisionConversationInput["regretPriority"]) => void;
  onRequestAi: () => void;
  onChangeOrderStyle: (
    preference: "FAST_EXECUTION" | "PRICE_CONTROL" | "UNSURE",
  ) => void;
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
  orderStylePreference,
  onSelectPlan,
  onChangeRegret,
  onRequestAi,
  onChangeOrderStyle,
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
          <span>후회 예산으로 다시 계산</span>
          <h2 id="execution-options-title">지금 입력이라면 먼저 검토할 실행안</h2>
          <p>
            결정 코어는 <strong>{planLabel(decision.preferredPlanId)}</strong>을 먼저
            비교하도록 정리했습니다.
          </p>
        </div>
        <strong className="execution-options__not-prediction">
          가격 예측이 아닌 검토 계획
        </strong>
      </header>

      {input.intent === "BUY" ? (
        <div className="execution-options__regret-switch" role="group" aria-label="후회 우선순위 바꾸기">
          <span>더 피하고 싶은 상황</span>
          <button
            type="button"
            aria-pressed={input.regretPriority === "MISSED_OPPORTUNITY"}
            onClick={() => onChangeRegret("MISSED_OPPORTUNITY")}
          >
            기다리다 놓치기
          </button>
          <button
            type="button"
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
              <small>{formatKrw(plan.referenceTotalAmountKrw)}</small>
            </button>
            <ol aria-label={`${planLabel(plan.id)} 회차별 수량`}>
              {plan.allocations.map((allocation) => (
                <li key={`${plan.id}-${allocation.sequence}`}>
                  <span>{allocation.sequence}회차</span>
                  <strong>{allocation.shares.toLocaleString("ko-KR")}주</strong>
                  <small>{formatKrw(allocation.amountKrw)}</small>
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
          <span>{explanation ? "AI가 쉽게 풀어쓴 이유" : "결정 코어가 고른 이유"}</span>
          <p>{explanation?.priorityReason ?? decision.preferredExplanation}</p>
        </div>
        {aiExplanationEnabled && aiState === "IDLE" ? (
          <button type="button" onClick={onRequestAi}>
            AI로 이유 설명받기
          </button>
        ) : null}
        {aiExplanationEnabled && aiState === "LOADING" ? <small>AI 설명을 안전하게 확인하고 있어요.</small> : null}
        {aiExplanationEnabled && aiState === "FAILURE" ? (
          <div className="execution-options__ai-error">
            <small>
              {aiMessage ?? "AI 설명을 확인하지 못해 새 설명을 표시하지 않았습니다."}
            </small>
            <button type="button" onClick={onRequestAi}>AI 설명 다시 확인</button>
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

      <section className="execution-options__order-coach" aria-labelledby="order-coach-title">
        <div>
          <span>주문 방식 코치</span>
          <h3 id="order-coach-title">무엇을 더 중요하게 생각하나요?</h3>
          <p>
            실시간 호가를 확인하지 않았습니다. 최적 지정가·예상 가격 차이·체결 가능성은 계산하지 않습니다.
          </p>
        </div>
        <div role="group" aria-label="주문 방식 우선순위">
          <button
            type="button"
            aria-pressed={orderStylePreference === "FAST_EXECUTION"}
            onClick={() => onChangeOrderStyle("FAST_EXECUTION")}
          >
            가격이 조금 달라도 빨리 거래
          </button>
          <button
            type="button"
            aria-pressed={orderStylePreference === "PRICE_CONTROL"}
            onClick={() => onChangeOrderStyle("PRICE_CONTROL")}
          >
            원하는 가격을 지키기
          </button>
          <button
            type="button"
            aria-pressed={orderStylePreference === "UNSURE"}
            onClick={() => onChangeOrderStyle("UNSURE")}
          >
            아직 잘 모르겠어요
          </button>
        </div>
        <div className="execution-options__order-coach-copy">
          <article>
            <strong>시장가</strong>
            <p>체결 가능성은 높지만 실제 가격이 달라질 수 있습니다.</p>
          </article>
          <article>
            <strong>지정가</strong>
            <p>가격을 통제하지만 거래가 완료되지 않을 수 있습니다.</p>
          </article>
        </div>
      </section>

      <button
        type="button"
        className="execution-options__order-button"
        onClick={onOpenOrder}
        disabled={!canPracticeOrder}
      >
        {canPracticeOrder
          ? selectedPlan.installmentCount === 1
            ? "일괄 주문 미리보기"
            : `${selectedPlan.installmentCount}회 분할 주문 미리보기`
          : aiState === "LOADING"
            ? "AI 설명 확인 후 주문 연습 가능"
            : "안전 확인이 끝나면 주문 연습 가능"}
      </button>
    </section>
  );
}
