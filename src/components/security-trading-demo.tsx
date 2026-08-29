"use client";

import { type FormEvent, useCallback, useRef, useState } from "react";

import type { GuidedTradeStep } from "@/components/guided-trade-agent";
import {
  type PositionCoachDraft,
  type PositionCoachDraftField,
  type PositionCoachTimeAxisAction,
} from "@/components/position-coach-panel";
import type { CandlestickPeriod } from "@/components/security-candlestick-chart";
import {
  applyAdversarialAnswerToInputs,
  calculatePositionCoachForDraft,
} from "@/components/security-position-coach-model";
import {
  buildChartOverlay,
  INITIAL_INPUT,
  INITIAL_POSITION_DRAFT,
  KNOWN_SUBJECTS,
  type ConcernMode,
} from "@/components/security-trading-demo-model";
import { SecurityTradingDemoView } from "@/components/security-trading-demo-view";
import { useAiExplanation } from "@/components/use-ai-explanation";
import { useSecurityPlanPresentation } from "@/components/use-security-plan-presentation";
import { useSecurityMarketData } from "@/components/use-security-market-data";
import type { AdversarialCoreAnswer } from "@/lib/adversarial-review-contracts";
import {
  DecisionConversationInputSchema,
  type DecisionConversationInput,
} from "@/lib/decision-contracts";
import type { ExecutionPlan } from "@/lib/execution-core";
import type { MarketView } from "@/lib/market-view";
import { buildExecutionFromMarket } from "@/lib/trading-demo";
import type { TradeCoachSuccess } from "@/lib/trade-coach-contracts";

export function SecurityTradingDemo() {
  const planSectionRef = useRef<HTMLElement>(null);
  const [input, setInput] = useState<DecisionConversationInput>(INITIAL_INPUT);
  const [chartPeriod, setChartPeriod] = useState<CandlestickPeriod>("DAY");
  const [concern, setConcern] = useState<ConcernMode | null>("PRE_BUY");
  const [positionDraft, setPositionDraft] = useState<PositionCoachDraft>(
    INITIAL_POSITION_DRAFT,
  );
  const [positionCoach, setPositionCoach] =
    useState<TradeCoachSuccess | null>(null);
  const [orderStylePreference, setOrderStylePreference] = useState<
    PositionCoachDraft["orderStylePreference"]
  >("UNSURE");
  const [timeAxisDismissed, setTimeAxisDismissed] = useState(false);
  const [challengeChangeSummary, setChallengeChangeSummary] = useState<
    string | null
  >(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [step, setStep] = useState<GuidedTradeStep>(2);
  const [completedSteps, setCompletedSteps] = useState<GuidedTradeStep[]>([]);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [planVisible, setPlanVisible] = useState(false);
  const [selectedPlanId, setSelectedPlanId] =
    useState<ExecutionPlan["id"]>("ONE_SHOT");
  const [previousRegret, setPreviousRegret] = useState<
    DecisionConversationInput["regretPriority"] | null
  >(null);
  const [previousPreferredPlanId, setPreviousPreferredPlanId] = useState<
    ExecutionPlan["id"] | null
  >(null);
  const [orderOpen, setOrderOpen] = useState(false);
  const {
    aiState,
    aiEnvelope,
    aiMessage,
    resetAiExplanation,
    requestAiExplanation,
  } = useAiExplanation();

  const resetPlannerForMarket = useCallback(() => {
    resetAiExplanation();
    setChartPeriod("DAY");
    setConcern("PRE_BUY");
    setPositionCoach(null);
    setTimeAxisDismissed(false);
    setChallengeChangeSummary(null);
    setPlanVisible(false);
    setAgentOpen(false);
    setCompletedSteps([]);
    setOrderOpen(false);
    setPreviousRegret(null);
    setPreviousPreferredPlanId(null);
  }, [resetAiExplanation]);

  const handleMarketLoaded = useCallback((nextMarket: MarketView) => {
    const subjectLabel = KNOWN_SUBJECTS[nextMarket.symbol] ?? nextMarket.symbol;
    setInput((current) => ({
      ...current,
      subjectLabel,
      symbol: nextMarket.symbol,
    }));
  }, []);

  const {
    searchValue,
    setSearchValue,
    market,
    marketLoading,
    marketError,
    intraday,
    intradayError,
    history,
    historyError,
    loadMarket,
  } = useSecurityMarketData({
    initialSymbol: INITIAL_INPUT.symbol,
    onBeforeLoad: resetPlannerForMarket,
    onMarketLoaded: handleMarketLoaded,
  });

  const {
    coreDecision,
    presentedDecision,
    selectedPlan,
    marketSupported,
    orderSidecar,
    evidenceEnvelope,
    verifiedExplanation,
    adversarialRequest,
    adversarialRequestKey,
  } = useSecurityPlanPresentation({
    input,
    market,
    positionCoach,
    selectedPlanId,
    orderStylePreference,
    aiState,
    aiEnvelope,
    planVisible,
    concern,
    positionDraft,
  });

  function searchMarket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadMarket(searchValue);
  }

  function openAgent(intent: DecisionConversationInput["intent"]) {
    if (!market || !marketSupported) return;
    resetAiExplanation();
    setInput((current) => ({
      ...current,
      intent,
      budgetKrw: intent === "BUY" ? current.budgetKrw ?? 10_000_000 : null,
      holdingQuantity: intent === "SELL" ? current.holdingQuantity ?? 100 : null,
    }));
    setCompletedSteps([1]);
    setStep(2);
    setAgentError(null);
    setPlanVisible(false);
    setPreviousRegret(null);
    setAgentOpen(true);
  }

  function openConcern(nextConcern: ConcernMode) {
    if (!market || !marketSupported) return;
    setConcern(nextConcern);
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 60);
    setTimeAxisDismissed(false);
    setPositionCoach(null);
    setChallengeChangeSummary(null);
    if (nextConcern === "PRE_BUY") {
      openAgent("BUY");
      return;
    }

    resetAiExplanation();
    setInput((current) => ({
      ...current,
      intent: "SELL",
      budgetKrw: null,
      holdingQuantity:
        Number(positionDraft.holdingQuantity) > 0
          ? Number(positionDraft.holdingQuantity)
          : 100,
    }));
    setPlanVisible(false);
    setOrderOpen(false);
    setAgentError(null);
    setAgentOpen(true);
  }

  function changePositionDraft(
    field: PositionCoachDraftField,
    value: PositionCoachDraft[PositionCoachDraftField],
  ) {
    setPositionDraft((current) => ({ ...current, [field]: value }));
    setPositionCoach(null);
    setPlanVisible(false);
    setOrderOpen(false);
    setChallengeChangeSummary(null);
  }

  function buildPositionCoachResult(
    draft: PositionCoachDraft,
    period: CandlestickPeriod,
    sourceInput: DecisionConversationInput = input,
  ): TradeCoachSuccess | null {
    if (!market || !concern || concern === "PRE_BUY") return null;
    const result = calculatePositionCoachForDraft({
      draft,
      period,
      input: sourceInput,
      market,
      concern,
      intraday,
    });
    if (!result.ok) {
      setAgentError(result.reasons[0]?.message ?? "입력 내용을 다시 확인해 주세요.");
      return null;
    }
    return result;
  }

  function submitPositionCoach() {
    const result = buildPositionCoachResult(positionDraft, chartPeriod);
    if (!result) return;
    const nextInput = DecisionConversationInputSchema.safeParse({
      ...input,
      intent: "SELL",
      budgetKrw: null,
      holdingQuantity: result.inputSnapshot.holdingQuantity,
      deadline: result.inputSnapshot.deadline,
      maxAdverseMovePct: result.inputSnapshot.maxLossPercent,
      regretPriority:
        result.inputSnapshot.regretPriority === "PRICE_RISK"
          ? "PRICE_RISK"
          : "MISSED_OPPORTUNITY",
    });
    if (!nextInput.success) {
      setAgentError(nextInput.error.issues[0]?.message ?? "입력 내용을 다시 확인해 주세요.");
      return;
    }
    setAgentError(null);
    setInput(nextInput.data);
    setPositionCoach(result);
    setOrderStylePreference(result.inputSnapshot.orderStylePreference);
    setSelectedPlanId(result.execution.preferredPlanId);
    setPlanVisible(true);
    resetAiExplanation();
    window.setTimeout(
      () => planSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      80,
    );
  }

  function selectChartPeriod(nextPeriod: CandlestickPeriod) {
    setChartPeriod(nextPeriod);
    setTimeAxisDismissed(false);
    if (positionCoach && concern && concern !== "PRE_BUY") {
      const nextResult = buildPositionCoachResult(positionDraft, nextPeriod);
      if (nextResult) setPositionCoach(nextResult);
    }
  }

  function handleTimeAxisAction(action: PositionCoachTimeAxisAction) {
    if (action === "WIDEN_TO_DAILY") {
      selectChartPeriod("DAY");
      return;
    }
    if (action === "REVIEW_ORIGINAL_PLAN") {
      setTimeAxisDismissed(true);
      planSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setTimeAxisDismissed(true);
  }

  function applyAdversarialAnswer(answer: AdversarialCoreAnswer) {
    if (!market || !coreDecision || !concern) return;
    const change = applyAdversarialAnswerToInputs(
      answer,
      input,
      positionDraft,
      concern,
    );
    const nextInput = change.input;
    const nextDraft = change.draft;
    if (change.orderStylePreference) {
      setOrderStylePreference(change.orderStylePreference);
    }
    const nextDecision = buildExecutionFromMarket(nextInput, market);
    if (!nextDecision) throw new Error("계획 계산기가 새 입력을 계산하지 못했습니다.");
    setPreviousRegret(input.regretPriority);
    setPreviousPreferredPlanId(coreDecision.preferredPlanId);
    setInput(nextInput);
    setPositionDraft(nextDraft);
    if (concern !== "PRE_BUY") {
      const result = buildPositionCoachResult(nextDraft, chartPeriod, nextInput);
      if (!result) throw new Error("보유 계획을 다시 계산하지 못했습니다.");
      setPositionCoach(result);
      setSelectedPlanId(result.execution.preferredPlanId);
    } else {
      setSelectedPlanId(nextDecision.preferredPlanId);
    }
    resetAiExplanation();
    setChallengeChangeSummary(change.summary);
  }

  function editStep(target: GuidedTradeStep) {
    resetAiExplanation();
    setStep(target);
    setCompletedSteps((current) => current.filter((item) => item < target));
    setAgentError(null);
    setPlanVisible(false);
  }

  function reopenPlanAnswers() {
    setAgentOpen(true);
    editStep(2);
  }

  function goBack() {
    const target = Math.max(1, step - 1) as GuidedTradeStep;
    editStep(target);
  }

  function continueConversation() {
    const parsed = DecisionConversationInputSchema.safeParse(input);
    if (!parsed.success) {
      setAgentError(parsed.error.issues[0]?.message ?? "입력 내용을 확인해 주세요.");
      return;
    }
    setAgentError(null);
    setCompletedSteps((current) =>
      current.includes(step) ? current : [...current, step].sort(),
    );

    if (step < 5) {
      setStep((step + 1) as GuidedTradeStep);
      return;
    }
    if (!market || !coreDecision) {
      setAgentError("검증된 공개 데이터로 실행안을 계산할 수 없습니다.");
      return;
    }

    setSelectedPlanId(coreDecision.preferredPlanId);
    setPlanVisible(true);
    setAgentOpen(false);
    resetAiExplanation();
    window.setTimeout(
      () => planSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      80,
    );
  }


  function changeRegret(
    nextRegret: DecisionConversationInput["regretPriority"],
  ) {
    if (!market || nextRegret === input.regretPriority) return;
    resetAiExplanation();
    const previousDecision = coreDecision;
    const nextInput = { ...input, regretPriority: nextRegret };
    const nextDecision = buildExecutionFromMarket(nextInput, market);
    if (!nextDecision) return;

    setPreviousRegret(input.regretPriority);
    setPreviousPreferredPlanId(previousDecision?.preferredPlanId ?? null);
    setInput(nextInput);
    if (concern && concern !== "PRE_BUY") {
      const nextCoach = buildPositionCoachResult(positionDraft, chartPeriod, nextInput);
      if (nextCoach) {
        setPositionCoach(nextCoach);
        setSelectedPlanId(nextCoach.execution.preferredPlanId);
      }
    } else {
      setSelectedPlanId(nextDecision.preferredPlanId);
    }
    setChallengeChangeSummary(null);
  }

  const chartOverlay = buildChartOverlay(
    planVisible,
    selectedPlan,
    positionCoach?.reviewLines.loss?.reviewPriceKrw ?? null,
  );
  const canPracticeOrder = Boolean(
    market && coreDecision && aiState !== "FAILURE",
  );
  const closeAgent = useCallback(() => setAgentOpen(false), []);
  const closeOrder = useCallback(() => setOrderOpen(false), []);

  return (
    <SecurityTradingDemoView
      planSectionRef={planSectionRef}
      searchValue={searchValue}
      onSearchValueChange={setSearchValue}
      onSearch={searchMarket}
      onReloadMarket={() => void loadMarket(searchValue)}
      market={market}
      marketLoading={marketLoading}
      marketError={marketError}
      intraday={intraday}
      intradayError={intradayError}
      history={history}
      historyError={historyError}
      input={input}
      onInputChange={setInput}
      chartPeriod={chartPeriod}
      onChartPeriodChange={selectChartPeriod}
      chartOverlay={chartOverlay}
      concern={concern}
      onConcernSelect={setConcern}
      onConcernContinue={openConcern}
      marketSupported={marketSupported}
      agentOpen={agentOpen}
      onCloseAgent={closeAgent}
      positionDraft={positionDraft}
      positionCoach={positionCoach}
      timeAxisDismissed={timeAxisDismissed}
      agentError={agentError}
      onPositionDraftChange={changePositionDraft}
      onPositionSubmit={submitPositionCoach}
      onTimeAxisAction={handleTimeAxisAction}
      step={step}
      completedSteps={completedSteps}
      onContinueConversation={continueConversation}
      onGoBack={goBack}
      planVisible={planVisible}
      selectedPlan={selectedPlan}
      decision={presentedDecision}
      onReopenPlanAnswers={reopenPlanAnswers}
      previousRegret={previousRegret}
      previousPreferredPlanId={previousPreferredPlanId}
      aiState={aiState}
      aiMessage={aiMessage}
      explanation={verifiedExplanation}
      evidenceEnvelope={evidenceEnvelope}
      canPracticeOrder={canPracticeOrder}
      onSelectPlan={setSelectedPlanId}
      onChangeRegret={changeRegret}
      onRequestAi={() => {
        if (!market || !presentedDecision) return;
        void requestAiExplanation({
          input,
          market,
          expectedPreferredPlanId:
            coreDecision?.preferredPlanId ?? presentedDecision.preferredPlanId,
        });
      }}
      onOpenOrder={() => setOrderOpen(true)}
      challengeChangeSummary={challengeChangeSummary}
      adversarialRequest={adversarialRequest}
      adversarialRequestKey={adversarialRequestKey}
      onAdversarialAnswer={applyAdversarialAnswer}
      orderOpen={orderOpen}
      orderSidecar={orderSidecar}
      onCloseOrder={closeOrder}
    />
  );
}
