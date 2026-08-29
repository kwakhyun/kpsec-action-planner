"use client";

import dynamic from "next/dynamic";
import {
  ArrowRight,
  ArrowsLeftRight,
  ChartBar,
  CheckCircle,
  ClockCounterClockwise,
} from "@phosphor-icons/react";

import type { ChartHistoryView } from "@/lib/chart-history";
import type { IntradayMarketView } from "@/lib/intraday-market";
import type { MarketView } from "@/lib/market-view";
import type { ExecutionPlan } from "@/lib/execution-core";

import type { PositionCoachDraft } from "./position-coach-panel";
import type {
  CandlestickPeriod,
  CandlestickPlanOverlay,
} from "./security-candlestick-chart";
import {
  exchangeLabel,
  formatKrw,
  formatVolume,
  type ConcernMode,
} from "./security-trading-demo-model";

const SecurityCandlestickChart = dynamic(() =>
  import("./security-candlestick-chart").then(
    (module) => module.SecurityCandlestickChart,
  ),
);

type SecurityMarketEvidenceProps = Readonly<{
  market: MarketView;
  subjectLabel: string;
  intraday: IntradayMarketView | null;
  intradayError: string | null;
  history: ChartHistoryView | null;
  historyError: string | null;
  chartPeriod: CandlestickPeriod;
  onChartPeriodChange: (period: CandlestickPeriod) => void;
  chartOverlay: CandlestickPlanOverlay | null;
  concern: ConcernMode | null;
  positionDraft: PositionCoachDraft;
  planVisible: boolean;
  selectedPlan: ExecutionPlan | null;
}>;

export function SecurityMarketEvidence({
  market,
  subjectLabel,
  intraday,
  intradayError,
  history,
  historyError,
  chartPeriod,
  onChartPeriodChange,
  chartOverlay,
  concern,
  positionDraft,
  planVisible,
  selectedPlan,
}: SecurityMarketEvidenceProps) {
  const changeTone =
    market.quote.change > 0
      ? "is-up"
      : market.quote.change < 0
        ? "is-down"
        : "is-flat";

  return (
    <section className="studio-evidence" aria-labelledby="security-title">
      <header className="studio-quote">
        <div className="studio-quote__title">
          <span>국내주식 · {exchangeLabel(market.provenance.exchange)}</span>
          <h1 id="security-title">{subjectLabel}</h1>
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
          <div><span>시장 근거</span><strong>가격 흐름과 거래량</strong></div>
          <span className="studio-live-label">
            <CheckCircle size={15} weight="fill" aria-hidden="true" /> 검증된 공개 데이터
          </span>
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
          onPeriodChange={onChartPeriodChange}
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
          <span className="studio-metrics__icon"><ChartBar size={20} aria-hidden="true" /></span>
          <dt><strong>거래량</strong><small>최근 완료 거래일</small></dt>
          <dd>{formatVolume(market.quote.volume)}</dd>
        </div>
        <div>
          <span className="studio-metrics__icon"><ArrowsLeftRight size={20} aria-hidden="true" /></span>
          <dt><strong>최근 20일 가격 범위</strong><small>저가에서 고가</small></dt>
          <dd>{formatKrw(market.metrics.range20d.low)} – {formatKrw(market.metrics.range20d.high)}</dd>
        </div>
        <div>
          <span className="studio-metrics__icon"><ClockCounterClockwise size={20} aria-hidden="true" /></span>
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
  );
}
