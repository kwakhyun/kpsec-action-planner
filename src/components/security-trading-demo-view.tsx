"use client";

import type {
  Dispatch,
  FormEventHandler,
  RefObject,
  SetStateAction,
} from "react";
import {
  ArrowRight,
  Check,
  CheckCircle,
  Info,
  MagnifyingGlass,
  Pulse,
} from "@phosphor-icons/react";

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
import type { ChartHistoryView } from "@/lib/chart-history";
import type { DemoOrderSidecar } from "@/lib/demo-order-sidecar";
import type { IntradayMarketView } from "@/lib/intraday-market";
import type { MarketView } from "@/lib/market-view";
import type { TradeCoachSuccess } from "@/lib/trade-coach-contracts";

import { DemoOrderSheet } from "./demo-order-sheet";
import type { GuidedTradeStep } from "./guided-trade-agent";
import {
  type PositionCoachDraft,
  type PositionCoachDraftField,
  type PositionCoachTimeAxisAction,
} from "./position-coach-panel";
import { SecurityDecisionWorkspace } from "./security-decision-workspace";
import { SecurityMarketEvidence } from "./security-market-evidence";
import { SecurityPlanResults } from "./security-plan-results";
import type {
  CandlestickPeriod,
  CandlestickPlanOverlay,
} from "./security-candlestick-chart";
import {
  formatDateTime,
  JOURNEY_STEPS,
  type AiExplanationState,
  type ConcernMode,
} from "./security-trading-demo-model";

type SecurityTradingDemoViewProps = Readonly<{
  planSectionRef: RefObject<HTMLElement | null>;
  searchValue: string;
  onSearchValueChange: (value: string) => void;
  onSearch: FormEventHandler<HTMLFormElement>;
  onReloadMarket: () => void;
  market: MarketView | null;
  marketLoading: boolean;
  marketError: string | null;
  intraday: IntradayMarketView | null;
  intradayError: string | null;
  history: ChartHistoryView | null;
  historyError: string | null;
  input: DecisionConversationInput;
  onInputChange: Dispatch<SetStateAction<DecisionConversationInput>>;
  chartPeriod: CandlestickPeriod;
  onChartPeriodChange: (period: CandlestickPeriod) => void;
  chartOverlay: CandlestickPlanOverlay | null;
  concern: ConcernMode | null;
  onConcernSelect: (concern: ConcernMode) => void;
  onConcernContinue: (concern: ConcernMode) => void;
  marketSupported: boolean;
  agentOpen: boolean;
  onCloseAgent: () => void;
  positionDraft: PositionCoachDraft;
  positionCoach: TradeCoachSuccess | null;
  timeAxisDismissed: boolean;
  agentError: string | null;
  onPositionDraftChange: (
    field: PositionCoachDraftField,
    value: PositionCoachDraft[PositionCoachDraftField],
  ) => void;
  onPositionSubmit: () => void;
  onTimeAxisAction: (action: PositionCoachTimeAxisAction) => void;
  step: GuidedTradeStep;
  completedSteps: GuidedTradeStep[];
  onContinueConversation: () => void;
  onGoBack: () => void;
  planVisible: boolean;
  selectedPlan: ExecutionPlan | null;
  decision: ExecutionCoreSuccess | null;
  onReopenPlanAnswers: () => void;
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
  orderOpen: boolean;
  orderSidecar: DemoOrderSidecar | null;
  onCloseOrder: () => void;
}>;

export function SecurityTradingDemoView({
  planSectionRef,
  searchValue,
  onSearchValueChange,
  onSearch,
  onReloadMarket,
  market,
  marketLoading,
  marketError,
  intraday,
  intradayError,
  history,
  historyError,
  input,
  onInputChange,
  chartPeriod,
  onChartPeriodChange,
  chartOverlay,
  concern,
  onConcernSelect,
  onConcernContinue,
  marketSupported,
  agentOpen,
  onCloseAgent,
  positionDraft,
  positionCoach,
  timeAxisDismissed,
  agentError,
  onPositionDraftChange,
  onPositionSubmit,
  onTimeAxisAction,
  step,
  completedSteps,
  onContinueConversation,
  onGoBack,
  planVisible,
  selectedPlan,
  decision,
  onReopenPlanAnswers,
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
  orderOpen,
  orderSidecar,
  onCloseOrder,
}: SecurityTradingDemoViewProps) {
  const journeyStep = planVisible ? 3 : agentOpen ? 2 : 1;
  return (
    <div
      className={`trade-demo studio-app${agentOpen ? " is-agent-open" : ""}${planVisible ? " has-plan" : ""}`}
    >
      <a className="skip-link" href="#planner-main">본문 바로가기</a>
      <header className="studio-header">
        <a className="studio-brand" href="#planner-main" aria-label="Action Planner 홈">
          <span className="studio-brand__mark" aria-hidden="true">AP</span>
          <span className="studio-brand__copy">
            <strong>Action Planner</strong>
            <small>초보 투자자를 위한 실행 계획</small>
          </span>
        </a>
        <form className="studio-search" role="search" onSubmit={onSearch}>
          <MagnifyingGlass size={20} weight="regular" aria-hidden="true" />
          <label htmlFor="security-search-input" className="sr-only">종목 코드 검색</label>
          <input
            id="security-search-input"
            value={searchValue}
            onChange={(event) => onSearchValueChange(event.target.value.toUpperCase())}
            placeholder="종목 코드 또는 이름 검색"
          />
          <button type="submit" disabled={marketLoading} aria-label="종목 조회">
            <span>조회</span>
            <ArrowRight size={17} weight="bold" aria-hidden="true" />
          </button>
        </form>
        <div className="studio-data-status" aria-live="polite">
          <CheckCircle size={20} weight="fill" aria-hidden="true" />
          <span>
            <small>공개 데이터 기준</small>
            <strong>{market ? formatDateTime(market.provenance.asOf) : "확인 중"}</strong>
          </span>
        </div>
      </header>

      <nav className="studio-journey" aria-label="실행 계획 진행 단계">
        <ol>
          {JOURNEY_STEPS.map(([item, title, description]) => {
            const state =
              item < journeyStep
                ? "complete"
                : item === journeyStep
                  ? "active"
                  : "upcoming";
            return (
              <li
                key={item}
                data-state={state}
                aria-current={state === "active" ? "step" : undefined}
              >
                <span className="studio-journey__number" aria-hidden="true">
                  {state === "complete" ? <Check size={16} weight="bold" /> : item}
                </span>
                <span><strong>{title}</strong><small>{description}</small></span>
              </li>
            );
          })}
        </ol>
      </nav>

      <main id="planner-main" className="studio-workspace">
        {marketLoading ? (
          <section className="studio-state" role="status">
            <span className="studio-state__icon">
              <Pulse size={28} weight="regular" aria-hidden="true" />
            </span>
            <div>
              <strong>공개 시장 데이터를 확인하고 있어요</strong>
              <p>가격을 추정하지 않고 검증이 끝날 때까지 기다립니다.</p>
            </div>
          </section>
        ) : null}

        {!marketLoading && marketError ? (
          <section className="studio-state studio-state--error" role="alert">
            <span className="studio-state__icon">
              <Info size={28} weight="regular" aria-hidden="true" />
            </span>
            <div>
              <strong>공개 데이터를 표시하지 못했어요</strong>
              <p>{marketError}</p>
              <button
                type="button"
                className="studio-button studio-button--secondary"
                onClick={onReloadMarket}
              >
                다시 확인
              </button>
            </div>
          </section>
        ) : null}

        {!marketLoading && market ? (
          <>
            <SecurityMarketEvidence
              market={market}
              subjectLabel={input.subjectLabel}
              intraday={intraday}
              intradayError={intradayError}
              history={history}
              historyError={historyError}
              chartPeriod={chartPeriod}
              onChartPeriodChange={onChartPeriodChange}
              chartOverlay={chartOverlay}
              concern={concern}
              positionDraft={positionDraft}
              planVisible={planVisible}
              selectedPlan={selectedPlan}
            />

            <SecurityDecisionWorkspace
              planSectionRef={planSectionRef}
              market={market}
              input={input}
              onInputChange={onInputChange}
              concern={concern}
              onConcernSelect={onConcernSelect}
              onConcernContinue={onConcernContinue}
              marketSupported={marketSupported}
              agentOpen={agentOpen}
              onCloseAgent={onCloseAgent}
              positionDraft={positionDraft}
              positionCoach={positionCoach}
              timeAxisDismissed={timeAxisDismissed}
              agentError={agentError}
              onPositionDraftChange={onPositionDraftChange}
              onPositionSubmit={onPositionSubmit}
              onTimeAxisAction={onTimeAxisAction}
              step={step}
              completedSteps={completedSteps}
              onContinueConversation={onContinueConversation}
              onGoBack={onGoBack}
              planVisible={planVisible}
              selectedPlan={selectedPlan}
              onReopenPlanAnswers={onReopenPlanAnswers}
              aiState={aiState}
            />

            <SecurityPlanResults
              planSectionRef={planSectionRef}
              market={market}
              input={input}
              concern={concern}
              planVisible={planVisible}
              selectedPlan={selectedPlan}
              decision={decision}
              previousRegret={previousRegret}
              previousPreferredPlanId={previousPreferredPlanId}
              aiState={aiState}
              aiMessage={aiMessage}
              explanation={explanation}
              evidenceEnvelope={evidenceEnvelope}
              canPracticeOrder={canPracticeOrder}
              onSelectPlan={onSelectPlan}
              onChangeRegret={onChangeRegret}
              onRequestAi={onRequestAi}
              onOpenOrder={onOpenOrder}
              challengeChangeSummary={challengeChangeSummary}
              adversarialRequest={adversarialRequest}
              adversarialRequestKey={adversarialRequestKey}
              onAdversarialAnswer={onAdversarialAnswer}
            />
          </>
        ) : null}
      </main>

      <footer className="studio-footer">
        <span><Info size={16} aria-hidden="true" /> Action Planner는 종목 추천, 미래 가격 예측, 실제 주문을 제공하지 않습니다.</span>
        <strong>나의 판단을 더 선명하게 만드는 의사결정 도구</strong>
      </footer>
      <DemoOrderSheet
        open={orderOpen}
        plan={selectedPlan}
        sidecar={orderSidecar}
        subjectLabel={input.subjectLabel}
        onClose={onCloseOrder}
      />
    </div>
  );
}
