"use client";

import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle,
  LockKey,
  ShieldCheck,
  ShoppingCartSimple,
  Sparkle,
  TrendDown,
} from "@phosphor-icons/react";

import type { DecisionConversationInput } from "@/lib/decision-contracts";
import type { ExecutionPlan } from "@/lib/execution-core";
import type { MarketView } from "@/lib/market-view";
import { planLabel } from "@/lib/trading-demo";
import type { TradeCoachSuccess } from "@/lib/trade-coach-contracts";

import { GuidedTradeAgent, type GuidedTradeStep } from "./guided-trade-agent";
import {
  PositionCoachPanel,
  type PositionCoachDraft,
  type PositionCoachDraftField,
  type PositionCoachTimeAxisAction,
} from "./position-coach-panel";
import {
  concernLabel,
  formatKrw,
  type AiExplanationState,
  type ConcernMode,
} from "./security-trading-demo-model";

type SecurityDecisionWorkspaceProps = Readonly<{
  planSectionRef: RefObject<HTMLElement | null>;
  market: MarketView;
  input: DecisionConversationInput;
  onInputChange: Dispatch<SetStateAction<DecisionConversationInput>>;
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
  onReopenPlanAnswers: () => void;
  aiState: AiExplanationState;
}>;

export function SecurityDecisionWorkspace({
  planSectionRef,
  market,
  input,
  onInputChange,
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
  onReopenPlanAnswers,
  aiState,
}: SecurityDecisionWorkspaceProps) {
  const changeTone =
    market.quote.change > 0
      ? "is-up"
      : market.quote.change < 0
        ? "is-down"
        : "is-flat";

  return (
    <section className="studio-decision" aria-label="상황 정리와 실행 계획">
      {planVisible && selectedPlan ? (
        <aside
          className="agent-complete studio-complete"
          aria-labelledby="agent-complete-title"
          aria-live="polite"
        >
          <div className="studio-complete__icon">
            <CheckCircle size={32} weight="fill" aria-hidden="true" />
          </div>
          <span className="studio-kicker">상황 정리 완료</span>
          <h2 id="agent-complete-title">비교할 실행안을 준비했어요</h2>
          <p>수익을 예측한 추천이 아니라, 내가 정한 예산과 감당 범위 안에서 실행 방법을 나란히 보여드립니다.</p>
          <dl className="agent-complete__summary">
            <div><dt>현재 선택</dt><dd>{planLabel(selectedPlan.id)}</dd></div>
            <div><dt>총수량</dt><dd>{selectedPlan.totalShares.toLocaleString("ko-KR")}주</dd></div>
            <div><dt>기준금액</dt><dd>{formatKrw(selectedPlan.referenceTotalAmountKrw)}</dd></div>
          </dl>
          <div className="agent-complete__actions">
            <button
              type="button"
              className="studio-button studio-button--primary"
              onClick={() =>
                planSectionRef.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                })
              }
            >
              실행안 비교하기 <ArrowRight size={18} weight="bold" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="studio-button studio-button--secondary"
              onClick={onReopenPlanAnswers}
            >
              입력 조건 다시 정리하기
            </button>
          </div>
          <small className="agent-complete__boundary">
            <LockKey size={15} aria-hidden="true" /> 가격과 수량은 계획 계산기가 만들며 AI가 바꾸지 않습니다.
          </small>
        </aside>
      ) : agentOpen ? (
        concern === "HOLDING_ANXIETY" || concern === "SELL_TIMING" ? (
          <PositionCoachPanel
            key={concern}
            concern={concern}
            value={positionDraft}
            result={positionCoach}
            disabled={false}
            hideTimeAxis={timeAxisDismissed}
            errorMessage={agentError}
            onChange={onPositionDraftChange}
            onSubmit={onPositionSubmit}
            onClose={onCloseAgent}
            onTimeAxisAction={onTimeAxisAction}
          />
        ) : (
          <GuidedTradeAgent
            open={agentOpen}
            input={input}
            step={step}
            completedSteps={completedSteps}
            loading={aiState === "LOADING"}
            errorMessage={agentError}
            onInputChange={onInputChange}
            onContinue={onContinueConversation}
            onBack={onGoBack}
            onClose={onCloseAgent}
          />
        )
      ) : (
        <div className="studio-decision__start">
          <div className="studio-mobile-quote" aria-label="선택한 종목 요약">
            <span>{input.subjectLabel} · {market.symbol}</span>
            <strong>{formatKrw(market.quote.latestPrice)}</strong>
            <small className={changeTone}>
              {market.quote.change > 0 ? "+" : ""}{formatKrw(market.quote.change)} · {market.quote.changePct > 0 ? "+" : ""}{market.quote.changePct.toFixed(2)}%
            </small>
          </div>
          <header className="studio-decision__intro">
            <span className="studio-ai-label">
              <Sparkle size={20} weight="fill" aria-hidden="true" /> AI 플래너
            </span>
            <p>공개된 시장 정보와 내가 정한 감당 범위를 바탕으로, 세 가지 상황별 실행안을 비교해 드릴게요.</p>
            <h2>지금 어떤 판단을<br />정리할까요?</h2>
            <small>현재 상황과 고민에 가장 가까운 항목을 선택해 주세요.</small>
          </header>
          {!marketSupported ? (
            <p className="market-support-warning" role="note">
              원화 가격과 평균 거래량을 함께 확인할 수 있는 종목에서 실행안을 계산할 수 있습니다.
            </p>
          ) : null}
          <div className="studio-concerns" role="group" aria-label="현재 가장 고민되는 상황">
            <ConcernButton
              active={concern === "PRE_BUY"}
              disabled={!marketSupported}
              icon={<ShoppingCartSimple size={28} aria-hidden="true" />}
              iconTone="buy"
              title="살까 고민돼요"
              description="예산 안에서 살 방법을 비교하고 싶어요."
              onClick={() => onConcernSelect("PRE_BUY")}
            />
            <ConcernButton
              active={concern === "HOLDING_ANXIETY"}
              disabled={!marketSupported}
              icon={<ShieldCheck size={28} aria-hidden="true" />}
              iconTone="hold"
              title="샀는데 불안해요"
              description="현재 계획과 다시 볼 기준을 확인하고 싶어요."
              onClick={() => onConcernSelect("HOLDING_ANXIETY")}
            />
            <ConcernButton
              active={concern === "SELL_TIMING"}
              disabled={!marketSupported}
              icon={<TrendDown size={28} aria-hidden="true" />}
              iconTone="sell"
              title="팔 시점을 고민하고 있어요"
              description="전량과 분할 매도 방법을 비교하고 싶어요."
              onClick={() => onConcernSelect("SELL_TIMING")}
            />
          </div>
          <footer className="studio-decision__footer">
            <div className="studio-selection-summary">
              <CheckCircle size={20} weight="fill" aria-hidden="true" />
              <span><small>선택한 고민</small><strong>{concern ? concernLabel(concern) : "아직 선택하지 않았어요"}</strong></span>
            </div>
            <div className="studio-privacy-note">
              <LockKey size={18} aria-hidden="true" /><span>입력 내용은 계획 계산에만 사용됩니다.</span>
            </div>
            <button
              type="button"
              className="studio-button studio-button--primary"
              disabled={!marketSupported || !concern}
              onClick={() => concern && onConcernContinue(concern)}
            >
              선택하고 계속하기 <ArrowRight size={18} weight="bold" aria-hidden="true" />
            </button>
          </footer>
        </div>
      )}
    </section>
  );
}

type ConcernButtonProps = Readonly<{
  active: boolean;
  disabled: boolean;
  icon: React.ReactNode;
  iconTone: "buy" | "hold" | "sell";
  title: string;
  description: string;
  onClick: () => void;
}>;

function ConcernButton({
  active,
  disabled,
  icon,
  iconTone,
  title,
  description,
  onClick,
}: ConcernButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
    >
      <span className={`studio-concerns__icon studio-concerns__icon--${iconTone}`}>
        {icon}
      </span>
      <span className="studio-concerns__copy"><strong>{title}</strong><small>{description}</small></span>
      <span className="studio-concerns__check" aria-hidden="true">
        {active ? <Check size={18} weight="bold" /> : null}
      </span>
    </button>
  );
}
