"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowRight,
  ArrowsLeftRight,
  ChartBar,
  Check,
  CheckCircle,
  ClockCounterClockwise,
  Info,
  LockKey,
  MagnifyingGlass,
  Pulse,
  ShieldCheck,
  ShoppingCartSimple,
  Sparkle,
  TrendDown,
} from "@phosphor-icons/react";

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
  ChartHistoryEnvelopeSchema,
  type ChartHistoryView,
} from "@/lib/chart-history";
import {
  MarketViewEnvelopeSchema,
  type MarketView,
} from "@/lib/market-view";
import {
  buildExecutionFromMarket,
  localCoreEnvelope,
  planLabel,
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

const JOURNEY_STEPS = [
  [1, "시장 이해", "데이터로 현재 상황 파악"],
  [2, "상황 정리", "나의 고민과 조건 입력"],
  [3, "실행안 비교", "실행 계획을 비교하고 결정"],
] as const;

const INITIAL_POSITION_DRAFT: PositionCoachDraft = {
  averageCostKrw: "300000",
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
  if (period !== "MINUTE" || !intraday) return "DAILY";
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

function exchangeLabel(exchange: string | null): string {
  if (exchange === "KSC" || exchange === "KRX") return "한국거래소";
  return exchange ?? "거래소 확인 불가";
}

function beginnerDelayNotice(notice: string): string {
  return notice.replace(
    "실시간 호가가 아닙니다.",
    "지금 주문 가능한 가격을 보여주는 데이터가 아닙니다.",
  );
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
  const historyAbortRef = useRef<AbortController | null>(null);
  const aiRequestIdRef = useRef(0);
  const aiAbortRef = useRef<AbortController | null>(null);
  const [searchValue, setSearchValue] = useState(INITIAL_INPUT.symbol);
  const [input, setInput] = useState<DecisionConversationInput>(INITIAL_INPUT);
  const [market, setMarket] = useState<MarketView | null>(null);
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [intraday, setIntraday] = useState<IntradayMarketView | null>(null);
  const [intradayError, setIntradayError] = useState<string | null>(null);
  const [history, setHistory] = useState<ChartHistoryView | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
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
                  label: "내가 다시 확인할 손실 가격",
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
          label: "최근 20일 가격 흔들림 참고값",
          observation: `최근 20일 가격 흔들림 참고값은 ${market.metrics.volatility20dPct.toFixed(1)}%입니다.`,
          sourceLabel: "Yahoo Finance 하루 단위 데이터에서 서버 계산",
        },
        {
          id: "MARKET_RANGE_20D",
          label: "최근 20일 가격 범위",
          observation: `${formatKrw(market.metrics.range20d.low)}부터 ${formatKrw(market.metrics.range20d.high)}까지 관찰됐습니다.`,
          sourceLabel: "Yahoo Finance 하루 단위 데이터에서 서버 계산",
        },
        {
          id: "MARKET_RELATIVE_VOLUME_20D",
          label: "평소 대비 최근 거래량",
          observation: `최근 거래량은 이전 평균의 ${market.metrics.relativeVolume20d?.toFixed(2) ?? "확인 불가"}배입니다.`,
          sourceLabel: "Yahoo Finance 하루 단위 데이터에서 서버 계산",
        },
      ],
      currentPlan: {
        ...presentedDecision,
        preferredPlanId: selectedPlan.id,
        preferredExplanation:
          selectedPlan.id === presentedDecision.preferredPlanId
            ? presentedDecision.preferredExplanation
            : "사용자가 비교를 위해 이 실행안을 직접 선택했습니다. 수량과 조건은 계획 계산기가 계산한 값입니다.",
      },
      dataContext: {
        asOf: market.provenance.asOf,
        fetchedAt: market.provenance.fetchedAt,
        limitations: [
          market.provenance.delayNotice,
          "지금 시장의 주문 가격과 대기 물량은 확인하지 않았습니다.",
          "과거 공개 데이터로 미래 가격이나 수익을 예측하지 않습니다.",
        ],
      },
      missingInformation: [
        "지금 시장의 주문 가격과 거래 완료 가능성",
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

  const loadHistory = useCallback(
    async (symbol: string, parentRequestId: number) => {
      historyAbortRef.current?.abort();
      const controller = new AbortController();
      historyAbortRef.current = controller;
      setHistory(null);
      setHistoryError(null);

      try {
        const response = await fetch(
          `/api/market/history?symbol=${encodeURIComponent(symbol)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const payload: unknown = await response.json();
        const parsed = ChartHistoryEnvelopeSchema.safeParse(payload);
        if (!parsed.success) {
          throw new Error("장기 차트 데이터 응답을 확인할 수 없습니다.");
        }
        if (marketRequestIdRef.current !== parentRequestId) return;
        if (parsed.data.status === "FAILURE") {
          setHistoryError(parsed.data.error.message);
          return;
        }
        setHistory(parsed.data.data);
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (marketRequestIdRef.current !== parentRequestId) return;
        setHistoryError(
          error instanceof Error && error.message
            ? error.message
            : "주·월·년 단위 장기 공개 데이터를 확인하지 못했습니다.",
        );
      } finally {
        if (historyAbortRef.current === controller) {
          historyAbortRef.current = null;
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
      historyAbortRef.current?.abort();
      setMarket(null);
      setIntraday(null);
      setIntradayError(null);
      setHistory(null);
      setHistoryError(null);
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
    historyAbortRef.current?.abort();
    setHistory(null);
    setHistoryError(null);
    setChartPeriod("DAY");
    setConcern("PRE_BUY");
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
      void loadHistory(nextMarket.symbol, requestId);
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
  }, [loadHistory, loadIntraday]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void loadMarket(INITIAL_INPUT.symbol);
    }, 0);
    return () => {
      window.clearTimeout(timerId);
      marketAbortRef.current?.abort();
      intradayAbortRef.current?.abort();
      historyAbortRef.current?.abort();
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
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 60);
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
    let nextInput: DecisionConversationInput = { ...input };
    let nextDraft: PositionCoachDraft = { ...positionDraft };
    let summary = "답변을 반영해 같은 계획 계산기로 실행안을 다시 계산했습니다.";

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
      summary = "감당 가능한 손실 범위로 다시 확인할 가격과 나누는 비중을 다시 계산했습니다.";
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
              label: positionCoach ? "내가 다시 확인할 손실 가격" : "손실 감당 기준",
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
  const journeyStep = planVisible ? 3 : agentOpen ? 2 : 1;

  return (
    <div className={`trade-demo studio-app${agentOpen ? " is-agent-open" : ""}${planVisible ? " has-plan" : ""}`}>
      <a className="skip-link" href="#planner-main">본문 바로가기</a>
      <header className="studio-header">
        <a className="studio-brand" href="#planner-main" aria-label="Action Planner 홈">
          <span className="studio-brand__mark" aria-hidden="true">AP</span>
          <span className="studio-brand__copy">
            <strong>Action Planner</strong>
            <small>초보 투자자를 위한 실행 계획</small>
          </span>
        </a>

        <form className="studio-search" role="search" onSubmit={searchMarket}>
          <MagnifyingGlass size={20} weight="regular" aria-hidden="true" />
          <label htmlFor="security-search-input" className="sr-only">종목 코드 검색</label>
          <input
            id="security-search-input"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value.toUpperCase())}
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
            const state = item < journeyStep ? "complete" : item === journeyStep ? "active" : "upcoming";
            return (
              <li key={item} data-state={state} aria-current={state === "active" ? "step" : undefined}>
                <span className="studio-journey__number" aria-hidden="true">
                  {state === "complete" ? <Check size={16} weight="bold" /> : item}
                </span>
                <span>
                  <strong>{title}</strong>
                  <small>{description}</small>
                </span>
              </li>
            );
          })}
        </ol>
      </nav>

      <main id="planner-main" className="studio-workspace">
        {marketLoading ? (
          <section className="studio-state" role="status">
            <span className="studio-state__icon"><Pulse size={28} weight="regular" aria-hidden="true" /></span>
            <div>
              <strong>공개 시장 데이터를 확인하고 있어요</strong>
              <p>가격을 추정하지 않고 검증이 끝날 때까지 기다립니다.</p>
            </div>
          </section>
        ) : null}

        {!marketLoading && marketError ? (
          <section className="studio-state studio-state--error" role="alert">
            <span className="studio-state__icon"><Info size={28} weight="regular" aria-hidden="true" /></span>
            <div>
              <strong>공개 데이터를 표시하지 못했어요</strong>
              <p>{marketError}</p>
              <button type="button" className="studio-button studio-button--secondary" onClick={() => void loadMarket(searchValue)}>
                다시 확인
              </button>
            </div>
          </section>
        ) : null}

        {!marketLoading && market ? (
          <>
            <section className="studio-evidence" aria-labelledby="security-title">
              <header className="studio-quote">
                <div className="studio-quote__title">
                  <span>국내주식 · {exchangeLabel(market.provenance.exchange)}</span>
                  <h1 id="security-title">{input.subjectLabel}</h1>
                  <p>{market.symbol}</p>
                </div>
                <div className="studio-quote__price">
                  <strong>{formatKrw(market.quote.latestPrice)}</strong>
                  <span className={changeTone}>
                    {market.quote.change > 0 ? "+" : ""}{formatKrw(market.quote.change)}
                    <i aria-hidden="true">·</i>
                    {market.quote.changePct > 0 ? "+" : ""}{market.quote.changePct.toFixed(2)}%
                  </span>
                </div>
              </header>

              <section className="studio-chart" aria-label="가격 흐름 근거">
                <header className="studio-section-heading">
                  <div>
                    <span>시장 근거</span>
                    <strong>가격 흐름과 거래량</strong>
                  </div>
                  <span className="studio-live-label"><CheckCircle size={15} weight="fill" aria-hidden="true" /> 검증된 공개 데이터</span>
                </header>
                <SecurityCandlestickChart
                  dailyBars={market.bars}
                  intraday={intraday}
                  intradayUnavailableReason={intradayError}
                  history={history}
                  historyUnavailableReason={historyError}
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
                  defaultPeriod="DAY"
                  height={250}
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
              </section>

              <dl className="studio-metrics">
                <div>
                  <span className="studio-metrics__icon"><ChartBar size={20} weight="regular" aria-hidden="true" /></span>
                  <dt><strong>거래량</strong><small>최근 완료 거래일</small></dt>
                  <dd>{formatVolume(market.quote.volume)}</dd>
                </div>
                <div>
                  <span className="studio-metrics__icon"><ArrowsLeftRight size={20} weight="regular" aria-hidden="true" /></span>
                  <dt><strong>최근 20일 가격 범위</strong><small>저가에서 고가</small></dt>
                  <dd>{formatKrw(market.metrics.range20d.low)} – {formatKrw(market.metrics.range20d.high)}</dd>
                </div>
                <div>
                  <span className="studio-metrics__icon"><ClockCounterClockwise size={20} weight="regular" aria-hidden="true" /></span>
                  <dt><strong>평소 대비 최근 거래량</strong><small>최근 20일 평균 기준</small></dt>
                  <dd>{market.metrics.relativeVolume20d?.toFixed(2) ?? "–"}배</dd>
                </div>
              </dl>

              <footer className="studio-source">
                <span>Yahoo Finance · 최근 3개월 · {market.provenance.tradingSessionCount}개 거래일</span>
                <a href={market.provenance.sourceUrl} target="_blank" rel="noreferrer">
                  원본 출처 <ArrowRight size={14} weight="bold" aria-hidden="true" />
                </a>
              </footer>
            </section>

            <section className="studio-decision" aria-label="상황 정리와 실행 계획">
              {planVisible && selectedPlan ? (
                <aside className="agent-complete studio-complete" aria-labelledby="agent-complete-title" aria-live="polite">
                  <div className="studio-complete__icon"><CheckCircle size={32} weight="fill" aria-hidden="true" /></div>
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
                      onClick={() => planSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    >
                      실행안 비교하기 <ArrowRight size={18} weight="bold" aria-hidden="true" />
                    </button>
                    <button type="button" className="studio-button studio-button--secondary" onClick={reopenPlanAnswers}>
                      입력 조건 다시 정리하기
                    </button>
                  </div>
                  <small className="agent-complete__boundary"><LockKey size={15} weight="regular" aria-hidden="true" /> 가격과 수량은 계획 계산기가 만들며 AI가 바꾸지 않습니다.</small>
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
                    onChange={changePositionDraft}
                    onSubmit={submitPositionCoach}
                    onClose={closeAgent}
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
                    onClose={closeAgent}
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
                    <span className="studio-ai-label"><Sparkle size={20} weight="fill" aria-hidden="true" /> AI 플래너</span>
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
                    <button
                      type="button"
                      aria-pressed={concern === "PRE_BUY"}
                      onClick={() => setConcern("PRE_BUY")}
                      disabled={!marketSupported}
                    >
                      <span className="studio-concerns__icon studio-concerns__icon--buy"><ShoppingCartSimple size={28} weight="regular" aria-hidden="true" /></span>
                      <span className="studio-concerns__copy"><strong>살까 고민돼요</strong><small>예산 안에서 살 방법을 비교하고 싶어요.</small></span>
                      <span className="studio-concerns__check" aria-hidden="true">{concern === "PRE_BUY" ? <Check size={18} weight="bold" /> : null}</span>
                    </button>
                    <button
                      type="button"
                      aria-pressed={concern === "HOLDING_ANXIETY"}
                      onClick={() => setConcern("HOLDING_ANXIETY")}
                      disabled={!marketSupported}
                    >
                      <span className="studio-concerns__icon studio-concerns__icon--hold"><ShieldCheck size={28} weight="regular" aria-hidden="true" /></span>
                      <span className="studio-concerns__copy"><strong>샀는데 불안해요</strong><small>현재 계획과 다시 볼 기준을 확인하고 싶어요.</small></span>
                      <span className="studio-concerns__check" aria-hidden="true">{concern === "HOLDING_ANXIETY" ? <Check size={18} weight="bold" /> : null}</span>
                    </button>
                    <button
                      type="button"
                      aria-pressed={concern === "SELL_TIMING"}
                      onClick={() => setConcern("SELL_TIMING")}
                      disabled={!marketSupported}
                    >
                      <span className="studio-concerns__icon studio-concerns__icon--sell"><TrendDown size={28} weight="regular" aria-hidden="true" /></span>
                      <span className="studio-concerns__copy"><strong>팔 시점을 고민하고 있어요</strong><small>전량과 분할 매도 방법을 비교하고 싶어요.</small></span>
                      <span className="studio-concerns__check" aria-hidden="true">{concern === "SELL_TIMING" ? <Check size={18} weight="bold" /> : null}</span>
                    </button>
                  </div>

                  <footer className="studio-decision__footer">
                    <div className="studio-selection-summary">
                      <CheckCircle size={20} weight="fill" aria-hidden="true" />
                      <span><small>선택한 고민</small><strong>{concern ? concernLabel(concern) : "아직 선택하지 않았어요"}</strong></span>
                    </div>
                    <div className="studio-privacy-note"><LockKey size={18} weight="regular" aria-hidden="true" /><span>입력 내용은 계획 계산에만 사용됩니다.</span></div>
                    <button
                      type="button"
                      className="studio-button studio-button--primary"
                      disabled={!marketSupported || !concern}
                      onClick={() => concern && openConcern(concern)}
                    >
                      선택하고 계속하기 <ArrowRight size={18} weight="bold" aria-hidden="true" />
                    </button>
                  </footer>
                </div>
              )}
            </section>

            {planVisible && presentedDecision ? (
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
                  decision={presentedDecision}
                  explanation={verifiedExplanation}
                  selectedPlanId={selectedPlan?.id ?? presentedDecision.preferredPlanId}
                  previousRegret={previousRegret}
                  previousPreferredPlanId={previousPreferredPlanId}
                  aiState={aiState}
                  aiMessage={aiMessage}
                  canPracticeOrder={canPracticeOrder}
                  aiExplanationEnabled={concern === "PRE_BUY"}
                  onSelectPlan={setSelectedPlanId}
                  onChangeRegret={changeRegret}
                  onRequestAi={() =>
                    void requestAiExplanation(
                      input,
                      market,
                      coreDecision?.preferredPlanId ?? presentedDecision.preferredPlanId,
                    )
                  }
                  onOpenOrder={() => setOrderOpen(true)}
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
                  onCoreRecalculate={applyAdversarialAnswer}
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
                      <span>
                        {aiState === "SUCCESS"
                          ? "계산된 숫자를 바꾸지 않고 선택마다 무엇이 다른지 쉬운 말로 설명했어요."
                          : aiState === "LOADING"
                            ? "계산된 숫자를 바꾸지 않는 설명인지 확인하고 있어요."
                            : aiState === "FAILURE"
                              ? "AI 설명을 안전하게 확인하지 못해 표시하지 않았어요. 계산 결과는 그대로 볼 수 있어요."
                              : "AI 설명은 아직 요청하지 않았어요. 계산 결과는 AI 없이도 확인할 수 있어요."}
                      </span>
                    </li>
                  </ol>
                  <p className="plan-making-summary__boundary">수량, 금액, 다시 확인할 조건은 계획 계산기가 만들며 AI는 이 값을 바꿀 수 없습니다.</p>
                </details>

                {evidenceEnvelope ? (
                  <PlanEvidencePanel
                    envelope={evidenceEnvelope}
                    selectedPlanId={selectedPlan?.id ?? presentedDecision.preferredPlanId}
                    usedTradingSessionCount={market.provenance.tradingSessionCount}
                  />
                ) : null}
              </section>
            ) : null}
          </>
        ) : null}
      </main>

      <footer className="studio-footer">
        <span><Info size={16} weight="regular" aria-hidden="true" /> Action Planner는 종목 추천, 미래 가격 예측, 실제 주문을 제공하지 않습니다.</span>
        <strong>나의 판단을 더 선명하게 만드는 의사결정 도구</strong>
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
