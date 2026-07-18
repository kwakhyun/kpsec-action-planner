"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { DemoOrderSheet } from "@/components/demo-order-sheet";
import { AdversarialReviewAgent } from "@/components/adversarial-review-agent";
import { ExecutionOptionsPanel } from "@/components/execution-options-panel";
import {
  GuidedTradeAgent,
  type GuidedTradeStep,
} from "@/components/guided-trade-agent";
import { PlanEvidencePanel } from "@/components/plan-evidence-panel";
import {
  PositionCoachPanel,
  type PositionCoachDraft,
  type PositionCoachDraftField,
  type PositionCoachTimeAxisAction,
} from "@/components/position-coach-panel";
import {
  SecurityCandlestickChart,
  type CandlestickPeriod,
} from "@/components/security-candlestick-chart";
import {
  AdversarialReviewRequestSchema,
  type AdversarialCoreAnswer,
  type AdversarialReviewRequest,
} from "@/lib/adversarial-review-contracts";
import {
  DecisionConversationInputSchema,
  DecisionEnvelopeSchema,
  type DecisionConversationInput,
  type DecisionEnvelope,
} from "@/lib/decision-contracts";
import { prepareDemoOrderSidecar } from "@/lib/demo-order-sidecar";
import type { ExecutionPlan } from "@/lib/execution-core";
import {
  IntradayMarketEnvelopeSchema,
  type IntradayMarketView,
} from "@/lib/intraday-market";
import {
  MarketViewEnvelopeSchema,
  type MarketView,
} from "@/lib/market-view";
import {
  buildExecutionFromMarket,
  localCoreEnvelope,
  preferredPlan,
} from "@/lib/trading-demo";
import type { TradeCoachSuccess } from "@/lib/trade-coach-contracts";
import { calculateTradeCoach } from "@/lib/trade-coach-core";

const INITIAL_INPUT: DecisionConversationInput =
  DecisionConversationInputSchema.parse({
    subjectLabel: "삼성전자",
    symbol: "005930.KS",
    intent: "BUY",
    budgetKrw: 10_000_000,
    holdingQuantity: null,
    deadline: "THIS_WEEK",
    regretPriority: "MISSED_OPPORTUNITY",
    maxAdverseMovePct: 8,
  });

const KNOWN_SUBJECTS: Record<string, string> = {
  "005930.KS": "삼성전자",
  "000660.KS": "SK하이닉스",
};

type ConcernMode = "PRE_BUY" | "HOLDING_ANXIETY" | "SELL_TIMING";

const INITIAL_POSITION_DRAFT: PositionCoachDraft = {
  averageCostKrw: "70000",
  holdingQuantity: "100",
  horizon: "WEEKS",
  deadline: "THIS_WEEK",
  maxLossPercent: "8",
  profitCriterionPercent: "",
  sellPlanPreference: "UNSURE",
  orderStylePreference: "UNSURE",
};

function chartInterval(
  period: CandlestickPeriod,
  intraday: IntradayMarketView | null,
): "ONE_MINUTE" | "FIVE_MINUTES" | "DAILY" {
  if (period !== "1D" || !intraday) return "DAILY";
  return intraday.provenance.interval === "1m" ? "ONE_MINUTE" : "FIVE_MINUTES";
}

function concernLabel(concern: ConcernMode): string {
  if (concern === "PRE_BUY") return "살까 고민되는 상황";
  if (concern === "HOLDING_ANXIETY") return "산 뒤 가격 움직임이 불안한 상황";
  return "팔 시점을 고민하는 상황";
}

function formatKrw(value: number): string {
  return `${new Intl.NumberFormat("ko-KR").format(Math.round(value))}원`;
}

function formatVolume(value: number): string {
  return `${new Intl.NumberFormat("ko-KR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)}주`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "확인할 수 없음";
  return date.toLocaleString("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sameInput(
  left: DecisionConversationInput | null,
  right: DecisionConversationInput,
): boolean {
  return left !== null && JSON.stringify(left) === JSON.stringify(right);
}

function sameMarket(envelope: DecisionEnvelope, market: MarketView): boolean {
  const snapshot = envelope.market.snapshot;
  return Boolean(
    snapshot &&
      snapshot.synthetic === false &&
      snapshot.symbol === market.symbol &&
      snapshot.asOf === market.provenance.asOf &&
      snapshot.sourceUrl === market.provenance.sourceUrl &&
      JSON.stringify(snapshot.metrics) === JSON.stringify(market.metrics),
  );
}

export function SecurityTradingDemo() {
  const planSectionRef = useRef<HTMLElement>(null);
  const marketRequestIdRef = useRef(0);
  const marketAbortRef = useRef<AbortController | null>(null);
  const intradayAbortRef = useRef<AbortController | null>(null);
  const aiRequestIdRef = useRef(0);
  const aiAbortRef = useRef<AbortController | null>(null);
  const [searchValue, setSearchValue] = useState(INITIAL_INPUT.symbol);
  const [input, setInput] = useState<DecisionConversationInput>(INITIAL_INPUT);
  const [market, setMarket] = useState<MarketView | null>(null);
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [intraday, setIntraday] = useState<IntradayMarketView | null>(null);
  const [intradayError, setIntradayError] = useState<string | null>(null);
  const [chartPeriod, setChartPeriod] = useState<CandlestickPeriod>("3M");
  const [concern, setConcern] = useState<ConcernMode | null>(null);
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
  const [aiState, setAiState] = useState<
    "IDLE" | "LOADING" | "SUCCESS" | "FAILURE"
  >("IDLE");
  const [aiEnvelope, setAiEnvelope] = useState<DecisionEnvelope | null>(null);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);

  const coreDecision = useMemo(
    () => (market ? buildExecutionFromMarket(input, market) : null),
    [input, market],
  );
  const presentedDecision = useMemo(
    () =>
      coreDecision && positionCoach
        ? {
            ...coreDecision,
            preferredPlanId: positionCoach.execution.preferredPlanId,
            preferredExplanation: positionCoach.execution.explanation,
          }
        : coreDecision,
    [coreDecision, positionCoach],
  );
  const selectedPlan = useMemo(
    () =>
      coreDecision?.plans.find((plan) => plan.id === selectedPlanId) ??
      preferredPlan(coreDecision),
    [coreDecision, selectedPlanId],
  );
  const marketSupported = Boolean(
    market &&
      market.provenance.currency === "KRW" &&
      market.metrics.relativeVolume20d !== null,
  );
  const localEnvelope = useMemo(
    () =>
      market && presentedDecision
        ? localCoreEnvelope(input, market, presentedDecision)
        : null,
    [input, market, presentedDecision],
  );
  const orderSidecar = useMemo(
    () =>
      market && selectedPlan
        ? prepareDemoOrderSidecar(
            input,
            market,
            selectedPlan,
            orderStylePreference,
            positionCoach?.reviewLines.loss
              ? {
                  label: "내가 정한 손실 재확인선",
                  priceKrw: positionCoach.reviewLines.loss.reviewPriceKrw,
                  meaning: positionCoach.reviewLines.loss.meaning,
                }
              : undefined,
          )
        : null,
    [input, market, orderStylePreference, positionCoach, selectedPlan],
  );
  const evidenceEnvelope =
    aiState === "SUCCESS" &&
    aiEnvelope &&
    market &&
    sameMarket(aiEnvelope, market) &&
    sameInput(aiEnvelope.inputSnapshot, input)
      ? aiEnvelope
      : localEnvelope;
  const verifiedExplanation =
    aiState === "SUCCESS" &&
    aiEnvelope &&
    market &&
    sameInput(aiEnvelope.inputSnapshot, input) &&
    sameMarket(aiEnvelope, market)
      ? aiEnvelope.explanation
      : null;
  const adversarialRequest = useMemo<AdversarialReviewRequest | null>(() => {
    if (!planVisible || !market || !presentedDecision || !selectedPlan || !concern) return null;
    const constraints: Array<{
      key: string;
      label: string;
      value: string | number | boolean | null;
    }> = [
      {
        key: "DEADLINE",
        label: "실행기한",
        value: input.deadline,
      },
      {
        key: "LOSS_TOLERANCE",
        label: "감당 가능한 손실 범위",
        value: input.maxAdverseMovePct,
      },
      {
        key: input.intent === "BUY" ? "BUDGET" : "HOLDING_QUANTITY",
        label: input.intent === "BUY" ? "매수 예산" : "보유수량",
        value: input.intent === "BUY" ? input.budgetKrw : input.holdingQuantity,
      },
      {
        key: "ORDER_PRIORITY",
        label: "주문 방식 우선순위",
        value: orderStylePreference,
      },
      {
        key: "SELECTED_PLAN",
        label: "지금 선택해 본 실행안",
        value: selectedPlan.id,
      },
    ];
    if (concern === "PRE_BUY") {
      constraints.push({
        key: "REGRET_PRIORITY",
        label: "더 피하고 싶은 후회",
        value: input.regretPriority,
      });
    } else {
      constraints.push(
        {
          key: "AVERAGE_COST",
          label: "평균 매수가",
          value: Number(positionDraft.averageCostKrw),
        },
        {
          key: "HOLDING_HORIZON",
          label: "예상 보유기간",
          value: positionDraft.horizon,
        },
        {
          key: "EXIT_STYLE",
          label: "매도 방식 고민",
          value: positionDraft.sellPlanPreference,
        },
      );
    }

    const candidate = {
      mode: "LIVE" as const,
      subjectLabel: input.subjectLabel,
      symbol: market.symbol,
      userInput: {
        concernMode: concern,
        intent: input.intent,
        constraints,
      },
      facts: [
        {
          id: "MARKET_LATEST_PRICE",
          label: "최근 확인 가격",
          observation: `최근 확인 가격은 ${formatKrw(market.quote.latestPrice)}입니다.`,
          sourceLabel: "Yahoo Finance 공개 데이터",
        },
        {
          id: "MARKET_VOLATILITY_20D",
          label: "최근 변동성",
          observation: `최근 변동성 계산값은 ${market.metrics.volatility20dPct.toFixed(1)}%입니다.`,
          sourceLabel: "Yahoo Finance 일봉에서 서버 계산",
        },
        {
          id: "MARKET_RANGE_20D",
          label: "최근 고저 범위",
          observation: `${formatKrw(market.metrics.range20d.low)}부터 ${formatKrw(market.metrics.range20d.high)}까지 관찰됐습니다.`,
          sourceLabel: "Yahoo Finance 일봉에서 서버 계산",
        },
        {
          id: "MARKET_RELATIVE_VOLUME_20D",
          label: "평균 대비 거래량",
          observation: `최근 거래량은 이전 평균의 ${market.metrics.relativeVolume20d?.toFixed(2) ?? "확인 불가"}배입니다.`,
          sourceLabel: "Yahoo Finance 일봉에서 서버 계산",
        },
      ],
      currentPlan: {
        ...presentedDecision,
        preferredPlanId: selectedPlan.id,
        preferredExplanation:
          selectedPlan.id === presentedDecision.preferredPlanId
            ? presentedDecision.preferredExplanation
            : "사용자가 비교를 위해 이 실행안을 직접 선택했습니다. 수량과 조건은 결정 코어가 계산한 값입니다.",
      },
      dataContext: {
        asOf: market.provenance.asOf,
        fetchedAt: market.provenance.fetchedAt,
        limitations: [
          market.provenance.delayNotice,
          "실시간 호가와 주문 잔량은 확인하지 않았습니다.",
          "과거 공개 데이터로 미래 가격이나 수익을 예측하지 않습니다.",
        ],
      },
      missingInformation: [
        "실시간 호가와 체결 가능성",
        "사용자의 전체 자산과 다른 보유 종목",
      ],
      allowedQuestionKeys:
        concern === "PRE_BUY"
          ? [
              "CONFIRM_REGRET_PRIORITY",
              "CONFIRM_DEADLINE",
              "CONFIRM_LOSS_TOLERANCE",
              "CONFIRM_ORDER_PRIORITY",
            ]
          : [
              "CONFIRM_DEADLINE",
              "CONFIRM_LOSS_TOLERANCE",
              "CONFIRM_ORDER_PRIORITY",
              "CONFIRM_HOLDING_HORIZON",
              "CONFIRM_EXIT_STYLE",
            ],
    };
    const parsed = AdversarialReviewRequestSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }, [
    concern,
    presentedDecision,
    selectedPlan,
    input,
    market,
    orderStylePreference,
    planVisible,
    positionDraft.averageCostKrw,
    positionDraft.horizon,
    positionDraft.sellPlanPreference,
  ]);
  const adversarialRequestKey = useMemo(
    () =>
      adversarialRequest
        ? JSON.stringify({
            input: adversarialRequest.userInput,
            preferred: adversarialRequest.currentPlan.preferredPlanId,
            asOf: adversarialRequest.dataContext.asOf,
          })
        : "NO_REQUEST",
    [adversarialRequest],
  );

  const loadIntraday = useCallback(
    async (symbol: string, parentRequestId: number) => {
      intradayAbortRef.current?.abort();
      const controller = new AbortController();
      intradayAbortRef.current = controller;
      setIntraday(null);
      setIntradayError(null);

      try {
        const response = await fetch(
          `/api/market/intraday?symbol=${encodeURIComponent(symbol)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const payload: unknown = await response.json();
        const parsed = IntradayMarketEnvelopeSchema.safeParse(payload);
        if (!parsed.success) {
          throw new Error("분봉 데이터 응답을 확인할 수 없습니다.");
        }
        if (marketRequestIdRef.current !== parentRequestId) return;
        if (parsed.data.status === "FAILURE") {
          setIntradayError(parsed.data.error.message);
          return;
        }
        setIntraday(parsed.data.data);
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (marketRequestIdRef.current !== parentRequestId) return;
        setIntradayError(
          error instanceof Error && error.message
            ? error.message
            : "1분·5분 공개 데이터를 확인하지 못했습니다.",
        );
      } finally {
        if (intradayAbortRef.current === controller) {
          intradayAbortRef.current = null;
        }
      }
    },
    [],
  );

  const loadMarket = useCallback(async (symbol: string) => {
    const normalizedSymbol = symbol.trim().toUpperCase();
    if (!normalizedSymbol) {
      marketRequestIdRef.current += 1;
      marketAbortRef.current?.abort();
      intradayAbortRef.current?.abort();
      setMarket(null);
      setIntraday(null);
      setIntradayError(null);
      setPlanVisible(false);
      setAgentOpen(false);
      setOrderOpen(false);
      setMarketLoading(false);
      setMarketError("종목 코드를 입력해 주세요.");
      return;
    }

    marketAbortRef.current?.abort();
    const controller = new AbortController();
    marketAbortRef.current = controller;
    const requestId = marketRequestIdRef.current + 1;
    marketRequestIdRef.current = requestId;
    aiRequestIdRef.current += 1;
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;

    setMarketLoading(true);
    setMarketError(null);
    setMarket(null);
    intradayAbortRef.current?.abort();
    setIntraday(null);
    setIntradayError(null);
    setChartPeriod("3M");
    setConcern(null);
    setPositionCoach(null);
    setChallengeChangeSummary(null);
    setPlanVisible(false);
    setAgentOpen(false);
    setOrderOpen(false);
    setAiEnvelope(null);
    setAiState("IDLE");

    try {
      const response = await fetch(
        `/api/market?symbol=${encodeURIComponent(normalizedSymbol)}`,
        { cache: "no-store", signal: controller.signal },
      );
      const payload: unknown = await response.json();
      const parsed = MarketViewEnvelopeSchema.safeParse(payload);
      if (!parsed.success) throw new Error("시장 데이터 응답을 확인할 수 없습니다.");
      if (marketRequestIdRef.current !== requestId) return;
      if (parsed.data.status === "FAILURE") {
        setMarketError(parsed.data.error.message);
        return;
      }

      const nextMarket = parsed.data.data;
      const subjectLabel = KNOWN_SUBJECTS[nextMarket.symbol] ?? nextMarket.symbol;
      setMarket(nextMarket);
      setSearchValue(nextMarket.symbol);
      setInput((current) => ({
        ...current,
        subjectLabel,
        symbol: nextMarket.symbol,
      }));
      void loadIntraday(nextMarket.symbol, requestId);
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (marketRequestIdRef.current !== requestId) return;
      setMarketError(
        error instanceof Error && error.message
          ? error.message
          : "공개 시세를 불러오지 못했습니다.",
      );
    } finally {
      if (marketRequestIdRef.current === requestId) {
        setMarketLoading(false);
        marketAbortRef.current = null;
      }
    }
  }, [loadIntraday]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void loadMarket(INITIAL_INPUT.symbol);
    }, 0);
    return () => {
      window.clearTimeout(timerId);
      marketAbortRef.current?.abort();
      intradayAbortRef.current?.abort();
      aiAbortRef.current?.abort();
    };
  }, [loadMarket]);

  function searchMarket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadMarket(searchValue);
  }

  function openAgent(intent: DecisionConversationInput["intent"]) {
    if (!market || !marketSupported) return;
    aiRequestIdRef.current += 1;
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
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
    setAiEnvelope(null);
    setAiState("IDLE");
    setPreviousRegret(null);
    setAgentOpen(true);
  }

  function openConcern(nextConcern: ConcernMode) {
    if (!market || !marketSupported) return;
    setConcern(nextConcern);
    setTimeAxisDismissed(false);
    setPositionCoach(null);
    setChallengeChangeSummary(null);
    if (nextConcern === "PRE_BUY") {
      openAgent("BUY");
      return;
    }

    aiRequestIdRef.current += 1;
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
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
    setAiEnvelope(null);
    setAiMessage(null);
    setAiState("IDLE");
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
    const averageCostKrw = Number(draft.averageCostKrw);
    const holdingQuantity = Number(draft.holdingQuantity);
    const maxLossPercent = Number(draft.maxLossPercent);
    const profitCriterionPercent = draft.profitCriterionPercent.trim()
      ? Number(draft.profitCriterionPercent)
      : null;
    const result = calculateTradeCoach({
      concern,
      subjectLabel: sourceInput.subjectLabel,
      symbol: market.symbol,
      budgetKrw: null,
      averageCostKrw,
      holdingQuantity,
      deadline: draft.deadline,
      horizon: draft.horizon,
      maxLossPercent,
      profitCriterionPercent,
      sellPlanPreference: draft.sellPlanPreference,
      regretPriority:
        draft.sellPlanPreference === "FULL"
          ? "MISSED_OPPORTUNITY"
          : "PRICE_RISK",
      orderStylePreference: draft.orderStylePreference,
      selectedChartInterval: chartInterval(period, intraday),
      market,
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
    setAiEnvelope(null);
    setAiMessage(null);
    setAiState("IDLE");
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
      selectChartPeriod("1M");
      return;
    }
    if (action === "REVIEW_ORIGINAL_PLAN") {
      planSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setTimeAxisDismissed(true);
  }

  function applyAdversarialAnswer(answer: AdversarialCoreAnswer) {
    if (!market || !coreDecision || !concern) return;
    let nextInput: DecisionConversationInput = { ...input };
    let nextDraft: PositionCoachDraft = { ...positionDraft };
    let summary = "답변을 반영해 같은 결정 코어로 실행안을 다시 계산했습니다.";

    if (answer.questionKey === "CONFIRM_REGRET_PRIORITY") {
      const regret =
        answer.answerKey === "PRICE_RISK"
          ? "PRICE_RISK"
          : "MISSED_OPPORTUNITY";
      nextInput = { ...nextInput, regretPriority: regret };
      summary =
        regret === "PRICE_RISK"
          ? "산 뒤 가격이 내려가는 걱정을 더 크게 반영해 회차별 비중을 다시 계산했습니다."
          : "기회를 놓치는 걱정을 더 크게 반영해 회차별 비중을 다시 계산했습니다.";
    } else if (answer.questionKey === "CONFIRM_DEADLINE") {
      if (["NOW", "TODAY", "THIS_WEEK", "NO_RUSH"].includes(answer.answerKey)) {
        nextInput = {
          ...nextInput,
          deadline: answer.answerKey as DecisionConversationInput["deadline"],
        };
        nextDraft = { ...nextDraft, deadline: nextInput.deadline };
        summary = "새 실행기한으로 가능한 분할 횟수와 재확인 조건을 다시 계산했습니다.";
      }
    } else if (answer.questionKey === "CONFIRM_LOSS_TOLERANCE") {
      const current = input.maxAdverseMovePct;
      const next =
        answer.answerKey === "TIGHTER"
          ? Math.max(0.5, current * 0.75)
          : answer.answerKey === "WIDER"
            ? Math.min(50, current * 1.25)
            : current;
      nextInput = { ...nextInput, maxAdverseMovePct: Math.round(next * 10) / 10 };
      nextDraft = {
        ...nextDraft,
        maxLossPercent: String(nextInput.maxAdverseMovePct),
      };
      summary = "감당 가능한 손실 범위로 재확인선과 분할 비중을 다시 계산했습니다.";
    } else if (answer.questionKey === "CONFIRM_ORDER_PRIORITY") {
      if (["FAST_EXECUTION", "PRICE_CONTROL", "UNSURE"].includes(answer.answerKey)) {
        const preference = answer.answerKey as PositionCoachDraft["orderStylePreference"];
        nextDraft = { ...nextDraft, orderStylePreference: preference };
        setOrderStylePreference(preference);
        summary = "빠른 거래와 가격 통제 중 새 우선순위로 주문 방식 설명을 다시 정리했습니다.";
      }
    } else if (answer.questionKey === "CONFIRM_HOLDING_HORIZON") {
      if (["DAYS", "WEEKS", "MONTHS", "YEARS"].includes(answer.answerKey)) {
        nextDraft = {
          ...nextDraft,
          horizon: answer.answerKey as PositionCoachDraft["horizon"],
        };
        summary = "새 보유기간과 현재 차트 시간대를 비교해 재확인 안내를 다시 계산했습니다.";
      }
    } else if (answer.questionKey === "CONFIRM_EXIT_STYLE") {
      nextDraft = {
        ...nextDraft,
        sellPlanPreference:
          answer.answerKey === "ONE_SHOT" ? "FULL" : "STAGED",
      };
      summary =
        answer.answerKey === "ONE_SHOT"
          ? "전량 매도를 먼저 비교하도록 실행안 순서를 다시 계산했습니다."
          : "나누어 매도를 먼저 비교하도록 실행안 순서를 다시 계산했습니다.";
    }

    if (concern !== "PRE_BUY") {
      nextInput = {
        ...nextInput,
        regretPriority:
          nextDraft.sellPlanPreference === "FULL"
            ? "MISSED_OPPORTUNITY"
            : "PRICE_RISK",
      };
    }
    const nextDecision = buildExecutionFromMarket(nextInput, market);
    if (!nextDecision) throw new Error("결정 코어가 새 입력을 계산하지 못했습니다.");
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
    setAiEnvelope(null);
    setAiMessage(null);
    setAiState("IDLE");
    setChallengeChangeSummary(summary);
  }

  function editStep(target: GuidedTradeStep) {
    aiRequestIdRef.current += 1;
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    setStep(target);
    setCompletedSteps((current) => current.filter((item) => item < target));
    setAgentError(null);
    setPlanVisible(false);
    setAiEnvelope(null);
    setAiState("IDLE");
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

    if (step < 4) {
      setStep((step + 1) as GuidedTradeStep);
      return;
    }
    if (!market || !coreDecision) {
      setAgentError("검증된 공개 데이터로 실행안을 계산할 수 없습니다.");
      return;
    }

    setSelectedPlanId(coreDecision.preferredPlanId);
    setPlanVisible(true);
    setAiEnvelope(null);
    setAiMessage(null);
    setAiState("IDLE");
    window.setTimeout(
      () => planSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      80,
    );
  }

  async function requestAiExplanation(
    targetInput: DecisionConversationInput,
    targetMarket: MarketView,
    expectedPreferredPlanId: ExecutionPlan["id"],
  ) {
    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;
    const requestId = aiRequestIdRef.current + 1;
    aiRequestIdRef.current = requestId;
    setAiState("LOADING");
    setAiMessage(null);
    setAiEnvelope(null);
    const timeoutId = window.setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch("/api/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "LIVE", input: targetInput }),
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      const parsed = DecisionEnvelopeSchema.safeParse(payload);
      if (!parsed.success) throw new Error("AI 설명 응답을 안전하게 확인하지 못했습니다.");
      const envelope = parsed.data;
      if (aiRequestIdRef.current !== requestId) return;
      setAiEnvelope(envelope);

      const aligned =
        response.ok &&
        envelope.status === "READY_FOR_REVIEW" &&
        envelope.generation.mode === "LIVE" &&
        envelope.generation.outcome === "SUCCESS" &&
        envelope.explanation !== null &&
        sameInput(envelope.inputSnapshot, targetInput) &&
        sameMarket(envelope, targetMarket) &&
        envelope.decision?.preferredPlanId === expectedPreferredPlanId;
      if (!aligned) {
        setAiState("FAILURE");
        setAiMessage(
          envelope.failureMessage ??
            "화면의 공개 데이터와 AI 설명 기준이 달라 새 설명을 표시하지 않았습니다.",
        );
        return;
      }
      setAiState("SUCCESS");
    } catch (error: unknown) {
      if (aiRequestIdRef.current !== requestId) return;
      setAiState("FAILURE");
      setAiMessage(
        error instanceof DOMException && error.name === "AbortError"
          ? "AI 응답이 늦어 새 설명을 만들지 않았습니다."
          : error instanceof Error
            ? error.message
            : "AI 설명을 만들지 못했습니다.",
      );
    } finally {
      window.clearTimeout(timeoutId);
      if (aiRequestIdRef.current === requestId) aiAbortRef.current = null;
    }
  }

  function changeRegret(
    nextRegret: DecisionConversationInput["regretPriority"],
  ) {
    if (!market || nextRegret === input.regretPriority) return;
    aiRequestIdRef.current += 1;
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
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
    setAiEnvelope(null);
    setAiMessage(null);
    setAiState("IDLE");
    setChallengeChangeSummary(null);
  }

  const chartOverlay =
    planVisible && selectedPlan
      ? {
          reviewBand: {
            low: selectedPlan.reviewLine.lowerReviewPriceKrw,
            high: selectedPlan.reviewLine.upperReviewPriceKrw,
            label: "멈추고 다시 확인할 범위",
          },
          markers: [
            {
              id: "reference-price",
              price: selectedPlan.reviewLine.referencePriceKrw,
              label: "계산 기준 가격",
              tone: "primary" as const,
            },
            {
              id: "loss-tolerance",
              price:
                positionCoach?.reviewLines.loss?.reviewPriceKrw ??
                selectedPlan.reviewLine.lossTolerancePriceKrw,
              label: positionCoach ? "내 손실 재확인선" : "손실 감당 기준",
              tone: "warning" as const,
            },
          ],
          stages: selectedPlan.allocations.map((allocation) => ({
            id: `${selectedPlan.id}-${allocation.sequence}`,
            label: `${allocation.sequence}회차`,
            shareLabel: `${allocation.shares.toLocaleString("ko-KR")}주`,
            weightPct:
              (allocation.shares / selectedPlan.totalShares) * 100,
          })),
        }
      : null;

  const changeTone = market
    ? market.quote.change > 0
      ? "is-up"
      : market.quote.change < 0
        ? "is-down"
        : "is-flat"
    : "is-flat";
  const canPracticeOrder = Boolean(
    market && coreDecision && aiState !== "FAILURE",
  );
  const closeAgent = useCallback(() => setAgentOpen(false), []);
  const closeOrder = useCallback(() => setOrderOpen(false), []);

  return (
    <div className={`trade-demo${agentOpen ? " is-agent-open" : ""}`}>
      <header className="trade-topbar">
        <div className="trade-topbar__brand">
          <strong>카카오페이증권 데모</strong>
          <span>해커톤 데모 · 실제 주문 없음</span>
        </div>
        <form className="security-search" role="search" onSubmit={searchMarket}>
          <label htmlFor="security-search-input" className="sr-only">종목 코드 검색</label>
          <input
            id="security-search-input"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value.toUpperCase())}
            placeholder="종목 코드 검색 · 005930.KS"
          />
          <button type="submit" disabled={marketLoading}>검색</button>
        </form>
        <div className="trade-topbar__time">
          <span>데이터 기준</span>
          <strong>{market ? formatDateTime(market.provenance.asOf) : "확인 중"}</strong>
        </div>
      </header>

      <main className="trade-layout">
        <section className="security-detail" aria-label="단일 종목 상세">
          <div className="security-quote-card">
            {marketLoading ? (
              <div className="market-loading" role="status">
                <strong>Yahoo Finance 공개 데이터를 확인하고 있어요.</strong>
                <span>가격을 추정하지 않고 검증이 끝날 때까지 기다립니다.</span>
              </div>
            ) : null}
            {!marketLoading && marketError ? (
              <div className="market-error" role="alert">
                <strong>공개 데이터를 표시하지 못했어요.</strong>
                <p>{marketError}</p>
                <button type="button" onClick={() => void loadMarket(searchValue)}>
                  다시 확인
                </button>
              </div>
            ) : null}
            {!marketLoading && market ? (
              <>
                <header className="security-quote-card__header">
                  <div>
                    <span>국내주식 · 공개 데이터 기준</span>
                    <h1>{input.subjectLabel}</h1>
                    <p>{market.symbol} · {market.provenance.exchange ?? "거래소 확인 불가"}</p>
                  </div>
                  <span className="data-freshness-badge">최근 완료 거래일</span>
                </header>

                <div className="security-quote-card__price">
                  <strong>{formatKrw(market.quote.latestPrice)}</strong>
                  <span className={changeTone}>
                    {market.quote.change > 0 ? "+" : ""}
                    {formatKrw(market.quote.change)} · {market.quote.changePct > 0 ? "+" : ""}
                    {market.quote.changePct.toFixed(2)}%
                  </span>
                </div>

                <dl className="security-quote-card__metrics">
                  <div><dt>거래량</dt><dd>{formatVolume(market.quote.volume)}</dd></div>
                  <div><dt>최근 고저</dt><dd>{formatKrw(market.metrics.range20d.low)} – {formatKrw(market.metrics.range20d.high)}</dd></div>
                  <div><dt>최근 변동성</dt><dd>{market.metrics.volatility20dPct.toFixed(1)}%</dd></div>
                  <div><dt>평균 대비 거래량</dt><dd>{market.metrics.relativeVolume20d?.toFixed(2) ?? "–"}배</dd></div>
                </dl>

                <div className="security-chart-card">
                  <SecurityCandlestickChart
                    dailyBars={market.bars}
                    intraday={intraday}
                    intradayUnavailableReason={intradayError}
                    currency={market.provenance.currency}
                    exchangeTimezone={market.provenance.exchangeTimezone}
                    period={chartPeriod}
                    onPeriodChange={selectChartPeriod}
                    averageCost={
                      concern && concern !== "PRE_BUY"
                        ? Number(positionDraft.averageCostKrw) || null
                        : null
                    }
                    observation={market.observations ?? null}
                    planOverlay={chartOverlay}
                    defaultPeriod="3M"
                  />
                  {planVisible && selectedPlan ? (
                    <div className="chart-plan-steps" aria-label="선택한 계획의 회차별 수량">
                      {selectedPlan.allocations.map((allocation) => (
                        <span key={`${selectedPlan.id}-${allocation.sequence}`}>
                          <strong>{allocation.sequence}회차</strong>
                          {allocation.shares.toLocaleString("ko-KR")}주 · 다음 회차 전 재확인
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="market-source-row">
                  <div>
                    <strong>Yahoo Finance</strong>
                    <span>{market.provenance.range} · {market.provenance.interval} · {market.provenance.tradingSessionCount}개 거래일</span>
                  </div>
                  <p>{market.provenance.delayNotice}</p>
                  <a href={market.provenance.sourceUrl} target="_blank" rel="noreferrer">원본 출처</a>
                </div>

                <div className="trade-cta-row">
                  {!marketSupported ? (
                    <p className="market-support-warning" role="note">
                      현재 수직 시연은 원화 가격과 평균 거래량을 함께 확인할 수 있는 종목에서만 실행안을 계산합니다.
                    </p>
                  ) : null}
                  <button type="button" className="trade-cta trade-cta--buy" onClick={() => openConcern("PRE_BUY")} disabled={!marketSupported}>
                    살까 고민돼요
                  </button>
                  <button type="button" className="trade-cta trade-cta--holding" onClick={() => openConcern("HOLDING_ANXIETY")} disabled={!marketSupported}>
                    샀는데 불안해요
                  </button>
                  <button type="button" className="trade-cta trade-cta--sell" onClick={() => openConcern("SELL_TIMING")} disabled={!marketSupported}>
                    팔 시점을 고민해요
                  </button>
                </div>
              </>
            ) : null}
          </div>

          {planVisible && presentedDecision && market ? (
            <section ref={planSectionRef} className="execution-result-wrap">
              {concern ? (
                <div className="understood-concern">
                  <div>
                    <span>제가 이해한 고민 · 사용자 입력</span>
                    <strong>{concernLabel(concern)}</strong>
                    <p>
                      {input.intent === "BUY"
                        ? `${formatKrw(input.budgetKrw ?? 0)} 예산으로 ${input.deadline === "NO_RUSH" ? "급하지 않게" : "정한 기한 안에"} 살 방법을 비교하고 있어요.`
                        : `${(input.holdingQuantity ?? 0).toLocaleString("ko-KR")}주를 보유한 상태에서 감당 범위와 매도 방식을 다시 확인하고 있어요.`}
                    </p>
                  </div>
                  <div>
                    <span>지금 확인한 시장 상황 · 공개 데이터</span>
                    <strong>{formatKrw(market.quote.latestPrice)}</strong>
                    <p>{market.provenance.delayNotice}</p>
                  </div>
                </div>
              ) : null}
              <ExecutionOptionsPanel
                input={input}
                decision={presentedDecision}
                explanation={verifiedExplanation}
                selectedPlanId={selectedPlan?.id ?? presentedDecision.preferredPlanId}
                previousRegret={previousRegret}
                previousPreferredPlanId={previousPreferredPlanId}
                aiState={aiState}
                aiMessage={aiMessage}
                canPracticeOrder={canPracticeOrder}
                aiExplanationEnabled={concern === "PRE_BUY"}
                orderStylePreference={orderStylePreference}
                onSelectPlan={setSelectedPlanId}
                onChangeRegret={changeRegret}
                onRequestAi={() =>
                  void requestAiExplanation(
                    input,
                    market,
                    coreDecision?.preferredPlanId ?? presentedDecision.preferredPlanId,
                  )
                }
                onChangeOrderStyle={(preference) => {
                  setOrderStylePreference(preference);
                  setPositionDraft((current) => ({
                    ...current,
                    orderStylePreference: preference,
                  }));
                  setChallengeChangeSummary(null);
                }}
                onOpenOrder={() => setOrderOpen(true)}
              />

              {challengeChangeSummary ? (
                <aside className="agentic-loop-summary" role="status">
                  <strong>반대 의견에 답한 뒤 계획이 달라졌어요</strong>
                  <p>{challengeChangeSummary}</p>
                  <small>AI가 계획을 고친 것이 아니라, 답변을 받은 결정 코어가 다시 계산했습니다.</small>
                </aside>
              ) : null}

              <AdversarialReviewAgent
                request={adversarialRequest}
                requestKey={adversarialRequestKey}
                onCoreRecalculate={applyAdversarialAnswer}
                disabled={!adversarialRequest || aiState === "LOADING"}
                className="execution-challenge"
              />

              <div className="agent-tool-flow" aria-label="계획 생성 과정">
                {[
                  { label: "공개 데이터 확인", complete: true },
                  { label: "사용자 조건 정리", complete: true },
                  { label: "실행안 계산", complete: true },
                  { label: "후회 비교", complete: true },
                  { label: "AI 설명 검증", complete: aiState === "SUCCESS" },
                  { label: "모의 주문 준비", complete: orderSidecar !== null },
                ].map((tool) => (
                  <span key={tool.label} className={tool.complete ? "is-complete" : undefined}>
                    {tool.label}
                  </span>
                ))}
              </div>

              {evidenceEnvelope ? (
                <PlanEvidencePanel
                  envelope={evidenceEnvelope}
                  selectedPlanId={selectedPlan?.id ?? presentedDecision.preferredPlanId}
                  usedTradingSessionCount={market.provenance.tradingSessionCount}
                />
              ) : null}
            </section>
          ) : null}
        </section>

        <div className="agent-rail">
          {agentOpen ? (
            concern === "HOLDING_ANXIETY" || concern === "SELL_TIMING" ? (
              <PositionCoachPanel
                concern={concern}
                value={positionDraft}
                result={positionCoach}
                selectedPlanId={selectedPlan?.id ?? null}
                disabled={false}
                hideTimeAxis={timeAxisDismissed}
                errorMessage={agentError}
                onChange={changePositionDraft}
                onSubmit={submitPositionCoach}
                onClose={closeAgent}
                onSelectPlan={setSelectedPlanId}
                onTimeAxisAction={handleTimeAxisAction}
              />
            ) : (
              <GuidedTradeAgent
                open={agentOpen}
                input={input}
                step={step}
                completedSteps={completedSteps}
                loading={aiState === "LOADING"}
                errorMessage={agentError}
                onInputChange={setInput}
                onContinue={continueConversation}
                onBack={goBack}
                onEdit={editStep}
                onClose={closeAgent}
              />
            )
          ) : (
            <aside className="agent-rail__empty">
              <span>매매 동반자</span>
              <h2>지금 어떤 고민을 함께 풀어볼까요?</h2>
              <p>공개 시장 정보와 내가 정한 감당 범위를 나눠 보고, 주문 전후의 선택을 함께 비교합니다.</p>
              <div className="agent-entry-choices">
                <button type="button" onClick={() => openConcern("PRE_BUY")} disabled={!marketSupported}>
                  살까 고민돼요
                </button>
                <button type="button" onClick={() => openConcern("HOLDING_ANXIETY")} disabled={!marketSupported}>
                  샀는데 가격이 움직여 불안해요
                </button>
                <button type="button" onClick={() => openConcern("SELL_TIMING")} disabled={!marketSupported}>
                  팔 시점을 고민하고 있어요
                </button>
              </div>
            </aside>
          )}
        </div>
      </main>

      <footer className="trade-demo-footer">
        이 화면은 해커톤 데모입니다. 종목 추천·미래 가격 예측·실제 주문을 제공하지 않습니다.
      </footer>

      <DemoOrderSheet
        open={orderOpen}
        plan={selectedPlan ?? null}
        sidecar={orderSidecar}
        subjectLabel={input.subjectLabel}
        onClose={closeOrder}
      />
    </div>
  );
}
