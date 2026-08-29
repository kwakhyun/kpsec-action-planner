"use client";

import type { RefObject } from "react";

import type {
  AdversarialCoreAnswer,
  AdversarialReviewRequest,
} from "@/lib/adversarial-review-contracts";
import type {
  AgentDecisionExplanation,
  DecisionConversationInput,
  DecisionEnvelope,
} from "@/lib/decision-contracts";
import type { ExecutionCoreSuccess, ExecutionPlan } from "@/lib/execution-core";
import type { MarketView } from "@/lib/market-view";

import { AdversarialReviewAgent } from "./adversarial-review-agent";
import { ExecutionOptionsPanel } from "./execution-options-panel";
import { PlanEvidencePanel } from "./plan-evidence-panel";
import {
  beginnerDelayNotice,
  concernLabel,
  formatKrw,
  type AiExplanationState,
  type ConcernMode,
} from "./security-trading-demo-model";

type SecurityPlanResultsProps = Readonly<{
  planSectionRef: RefObject<HTMLElement | null>;
  market: MarketView;
  input: DecisionConversationInput;
  concern: ConcernMode | null;
  planVisible: boolean;
  selectedPlan: ExecutionPlan | null;
  decision: ExecutionCoreSuccess | null;
  previousRegret: DecisionConversationInput["regretPriority"] | null;
  previousPreferredPlanId: ExecutionPlan["id"] | null;
  aiState: AiExplanationState;
  aiMessage: string | null;
  explanation: AgentDecisionExplanation | null;
  evidenceEnvelope: DecisionEnvelope | null;
  canPracticeOrder: boolean;
  onSelectPlan: (planId: ExecutionPlan["id"]) => void;
  onChangeRegret: (
    regret: DecisionConversationInput["regretPriority"],
  ) => void;
  onRequestAi: () => void;
  onOpenOrder: () => void;
  challengeChangeSummary: string | null;
  adversarialRequest: AdversarialReviewRequest | null;
  adversarialRequestKey: string;
  onAdversarialAnswer: (answer: AdversarialCoreAnswer) => void;
}>;

export function SecurityPlanResults({
  planSectionRef,
  market,
  input,
  concern,
  planVisible,
  selectedPlan,
  decision,
  previousRegret,
  previousPreferredPlanId,
  aiState,
  aiMessage,
  explanation,
  evidenceEnvelope,
  canPracticeOrder,
  onSelectPlan,
  onChangeRegret,
  onRequestAi,
  onOpenOrder,
  challengeChangeSummary,
  adversarialRequest,
  adversarialRequestKey,
  onAdversarialAnswer,
}: SecurityPlanResultsProps) {
  if (!planVisible || !decision) return null;

  return (
    <section ref={planSectionRef} className="execution-result-wrap studio-results">
      <header className="studio-results__heading">
        <span className="studio-kicker">실행안 비교</span>
        <h2>나에게 맞는 실행 방식을 비교해 보세요</h2>
        <p>예측이 아니라 입력한 조건을 서로 다른 실행 방식에 적용한 결과입니다.</p>
      </header>
      {concern ? (
        <div className="understood-concern">
          <div>
            <span>내가 정리한 고민</span>
            <strong>{concernLabel(concern)}</strong>
            <p>
              {input.intent === "BUY"
                ? `${formatKrw(input.budgetKrw ?? 0)} 예산으로 ${input.deadline === "NO_RUSH" ? "급하지 않게" : "정한 기한 안에"} 살 방법을 비교합니다.`
                : `${(input.holdingQuantity ?? 0).toLocaleString("ko-KR")}주를 보유한 상태에서 감당 범위와 매도 방식을 다시 확인합니다.`}
            </p>
          </div>
          <div>
            <span>계산에 사용한 공개 데이터</span>
            <strong>{formatKrw(market.quote.latestPrice)}</strong>
            <p>{beginnerDelayNotice(market.provenance.delayNotice)}</p>
          </div>
        </div>
      ) : null}
      <ExecutionOptionsPanel
        input={input}
        decision={decision}
        explanation={explanation}
        selectedPlanId={selectedPlan?.id ?? decision.preferredPlanId}
        previousRegret={previousRegret}
        previousPreferredPlanId={previousPreferredPlanId}
        aiState={aiState}
        aiMessage={aiMessage}
        canPracticeOrder={canPracticeOrder}
        aiExplanationEnabled={concern === "PRE_BUY"}
        onSelectPlan={onSelectPlan}
        onChangeRegret={onChangeRegret}
        onRequestAi={onRequestAi}
        onOpenOrder={onOpenOrder}
      />
      {challengeChangeSummary ? (
        <aside className="agentic-loop-summary" role="status">
          <strong>반대 의견에 답한 뒤 계획이 달라졌어요</strong>
          <p>{challengeChangeSummary}</p>
          <small>AI가 계획을 고친 것이 아니라, 답변을 받은 계획 계산기가 다시 계산했습니다.</small>
        </aside>
      ) : null}
      <AdversarialReviewAgent
        request={adversarialRequest}
        requestKey={adversarialRequestKey}
        onCoreRecalculate={onAdversarialAnswer}
        disabled={!adversarialRequest || aiState === "LOADING"}
        className="execution-challenge"
      />
      <details className="plan-making-summary">
        <summary>
          <span className="plan-making-summary__heading">
            <strong>이 계획은 어떻게 만들었나요?</strong>
            <small>공개 시장 데이터와 내 답변으로 수량과 금액을 계산했어요.</small>
          </span>
          <span className="plan-making-summary__toggle" aria-hidden="true">
            <span className="plan-making-summary__open-label">과정 보기</span>
            <span className="plan-making-summary__close-label">접기</span>
          </span>
        </summary>
        <ol className="plan-making-summary__steps">
          <li><strong>시장 정보 확인</strong><span>Yahoo Finance 공개 데이터의 가격, 거래량, 기준 시각을 확인했어요.</span></li>
          <li><strong>내 답변으로 계획 계산</strong><span>예산이나 보유 수량, 기한, 감당 범위로 회차별 수량과 다시 확인할 조건을 계산했어요.</span></li>
          <li data-state={aiState.toLowerCase()}>
            <strong>AI가 선택 차이를 설명</strong>
            <span>{explanationStatusText(aiState)}</span>
          </li>
        </ol>
        <p className="plan-making-summary__boundary">수량, 금액, 다시 확인할 조건은 계획 계산기가 만들며 AI는 이 값을 바꿀 수 없습니다.</p>
      </details>
      {evidenceEnvelope ? (
        <PlanEvidencePanel
          envelope={evidenceEnvelope}
          selectedPlanId={selectedPlan?.id ?? decision.preferredPlanId}
          usedTradingSessionCount={market.provenance.tradingSessionCount}
        />
      ) : null}
    </section>
  );
}

function explanationStatusText(state: AiExplanationState): string {
  if (state === "SUCCESS") {
    return "계산된 숫자를 바꾸지 않고 선택마다 무엇이 다른지 쉬운 말로 설명했어요.";
  }
  if (state === "LOADING") {
    return "계산된 숫자를 바꾸지 않는 설명인지 확인하고 있어요.";
  }
  if (state === "FAILURE") {
    return "AI 설명을 안전하게 확인하지 못해 표시하지 않았어요. 계산 결과는 그대로 볼 수 있어요.";
  }
  return "AI 설명은 아직 요청하지 않았어요. 계산 결과는 AI 없이도 확인할 수 있어요.";
}
