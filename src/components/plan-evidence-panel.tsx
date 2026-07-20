import type { DecisionEnvelope } from "@/lib/decision-contracts";
import type { ExecutionPlan } from "@/lib/execution-core";

export type PlanEvidencePanelProps = {
  envelope: DecisionEnvelope;
  selectedPlanId?: ExecutionPlan["id"] | null;
  usedTradingSessionCount?: number | null;
};

const INTENT_LABELS = {
  BUY: "매수 고민",
  SELL: "매도 고민",
} as const;

const DEADLINE_LABELS = {
  NOW: "지금 바로",
  TODAY: "오늘 안에",
  THIS_WEEK: "이번 주 안에",
  NO_RUSH: "급하지 않게",
} as const;

const REGRET_LABELS = {
  PRICE_RISK: "산 뒤 가격이 내려가는 후회를 더 줄이기",
  MISSED_OPPORTUNITY: "기다리다 기회를 놓치는 후회를 더 줄이기",
} as const;

const PLAN_LABELS: Record<ExecutionPlan["id"], string> = {
  ONE_SHOT: "한 번에 확인하는 계획",
  STAGED_2: "두 번으로 나누는 계획",
  STAGED_3: "세 번으로 나누는 계획",
};

function formatKrw(value: number): string {
  return `${new Intl.NumberFormat("ko-KR").format(Math.round(value))}원`;
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "확인할 수 없음" : date.toLocaleString("ko-KR");
}

function evidencePlan(
  envelope: DecisionEnvelope,
  selectedPlanId: ExecutionPlan["id"] | null | undefined,
): ExecutionPlan | null {
  if (!envelope.decision) return null;
  return (
    envelope.decision.plans.find(
      (plan) => plan.id === (selectedPlanId ?? envelope.decision?.preferredPlanId),
    ) ?? null
  );
}

export function PlanEvidencePanel({
  envelope,
  selectedPlanId = null,
  usedTradingSessionCount = null,
}: PlanEvidencePanelProps) {
  const input = envelope.inputSnapshot;
  const market = envelope.market.snapshot;
  const decision = envelope.decision;
  const explanation = envelope.explanation;
  const selectedPlan = evidencePlan(envelope, selectedPlanId);

  return (
    <details className="plan-evidence-panel" data-testid="plan-evidence-panel">
      <summary className="plan-evidence-panel__summary">
        <span>
          <strong>이 계획을 만든 근거</strong>
          <small>입력한 내용, 공개 시장 데이터, 계산과 AI 설명을 나누어 볼 수 있어요.</small>
        </span>
        <span className="plan-evidence-panel__summary-action" aria-hidden="true">
          자세히 보기
        </span>
      </summary>

      <div className="plan-evidence-panel__content">
        <p className="plan-evidence-panel__boundary">
          시장 숫자와 실행 수량은 검증된 데이터와 계획 계산기가 만들고, AI는 그 선택의 차이만
          쉬운 말로 설명합니다.
        </p>

        <section className="plan-evidence-panel__group" aria-labelledby="evidence-user-input">
          <header className="plan-evidence-panel__group-heading">
            <span>사용자가 알려준 내용</span>
            <strong id="evidence-user-input">직접 입력</strong>
          </header>
          {input ? (
            <dl className="plan-evidence-panel__grid">
              <div>
                <dt>종목</dt>
                <dd>{input.subjectLabel} · {input.symbol}</dd>
              </div>
              <div>
                <dt>고민</dt>
                <dd>{INTENT_LABELS[input.intent]}</dd>
              </div>
              <div>
                <dt>{input.intent === "BUY" ? "사용할 예산" : "보유수량"}</dt>
                <dd>
                  {input.intent === "BUY"
                    ? formatKrw(input.budgetKrw ?? 0)
                    : `${(input.holdingQuantity ?? 0).toLocaleString("ko-KR")}주`}
                </dd>
              </div>
              <div>
                <dt>실행기한</dt>
                <dd>{DEADLINE_LABELS[input.deadline]}</dd>
              </div>
              <div>
                <dt>더 줄이고 싶은 후회</dt>
                <dd>{REGRET_LABELS[input.regretPriority]}</dd>
              </div>
              <div>
                <dt>감당 범위</dt>
                <dd>{formatPercent(input.maxAdverseMovePct)}</dd>
              </div>
            </dl>
          ) : (
            <p className="plan-evidence-panel__empty">안전하게 확인된 사용자 입력이 없습니다.</p>
          )}
        </section>

        <section className="plan-evidence-panel__group" aria-labelledby="evidence-market-data">
          <header className="plan-evidence-panel__group-heading">
            <span>시장에 대해 확인한 내용</span>
            <strong id="evidence-market-data">
              {market?.synthetic ? "합성 예시" : "공개 시장 데이터"}
            </strong>
          </header>
          {market ? (
            <>
              <dl className="plan-evidence-panel__grid">
                <div>
                  <dt>출처</dt>
                  <dd>{market.synthetic ? "해커톤용 합성 데이터" : market.provider}</dd>
                </div>
                <div>
                  <dt>데이터 기준 시각</dt>
                  <dd><time dateTime={market.asOf}>{formatDateTime(market.asOf)}</time></dd>
                </div>
                <div>
                  <dt>조회 시각</dt>
                  <dd><time dateTime={market.fetchedAt}>{formatDateTime(market.fetchedAt)}</time></dd>
                </div>
                <div>
                  <dt>조회 구간</dt>
                  <dd>최근 3개월 · 하루 간격</dd>
                </div>
                {usedTradingSessionCount !== null ? (
                  <div>
                    <dt>검증에 사용한 거래일</dt>
                    <dd>{usedTradingSessionCount.toLocaleString("ko-KR")}일</dd>
                  </div>
                ) : null}
                <div>
                  <dt>최근 완료 거래일 종가</dt>
                  <dd>{formatKrw(market.metrics.latestPrice)}</dd>
                </div>
                <div>
                  <dt>최근 20일 가격 흔들림 참고값</dt>
                  <dd>{formatPercent(market.metrics.volatility20dPct)}</dd>
                </div>
                <div>
                  <dt>최근 20일 가장 낮은 가격–높은 가격</dt>
                  <dd>
                    {formatKrw(market.metrics.range20d.low)}–
                    {formatKrw(market.metrics.range20d.high)} · 폭 {formatPercent(market.metrics.range20d.percent)}
                  </dd>
                </div>
                <div>
                  <dt>평소 대비 최근 거래량</dt>
                  <dd>
                    {market.metrics.relativeVolume20d === null
                      ? "계산할 수 없음"
                      : `${market.metrics.relativeVolume20d.toFixed(2)}배`}
                  </dd>
                </div>
              </dl>
              <p className="plan-evidence-panel__delay">{market.delayNotice}</p>
              {!market.synthetic && market.sourceUrl ? (
                <a
                  className="plan-evidence-panel__source-link"
                  href={market.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Yahoo Finance 원본 응답 보기
                </a>
              ) : null}
            </>
          ) : (
            <p className="plan-evidence-panel__empty">
              검증된 시장 데이터가 없어 가격이나 지표를 추정하지 않았습니다.
            </p>
          )}
        </section>

        <section className="plan-evidence-panel__group" aria-labelledby="evidence-decision-core">
          <header className="plan-evidence-panel__group-heading">
            <span>계획으로 계산한 내용</span>
            <strong id="evidence-decision-core">계획 계산기</strong>
          </header>
          {decision && selectedPlan ? (
            <>
              <dl className="plan-evidence-panel__grid">
                <div>
                  <dt>현재 선택한 계획</dt>
                  <dd>{PLAN_LABELS[selectedPlan.id]}</dd>
                </div>
                <div>
                  <dt>비교한 계획 수</dt>
                  <dd>{decision.plans.length}개</dd>
                </div>
                <div>
                  <dt>계획 총수량</dt>
                  <dd>{selectedPlan.totalShares.toLocaleString("ko-KR")}주</dd>
                </div>
                <div>
                  <dt>기준 가격으로 계산한 총금액</dt>
                  <dd>{formatKrw(selectedPlan.referenceTotalAmountKrw)}</dd>
                </div>
                <div>
                  <dt>재확인 구간</dt>
                  <dd>
                    {formatKrw(selectedPlan.reviewLine.lowerReviewPriceKrw)}–
                    {formatKrw(selectedPlan.reviewLine.upperReviewPriceKrw)}
                  </dd>
                </div>
              </dl>
              <ol className="plan-evidence-panel__allocations" aria-label="계획 계산기가 계산한 회차별 수량">
                {selectedPlan.allocations.map((allocation) => (
                  <li key={`${selectedPlan.id}-${allocation.sequence}`}>
                    <span>{allocation.sequence}회차</span>
                    <strong>{allocation.shares.toLocaleString("ko-KR")}주</strong>
                    <small>{formatKrw(allocation.amountKrw)}</small>
                  </li>
                ))}
              </ol>
              <p className="plan-evidence-panel__ownership-note">
                AI는 이 수량·금액·재확인 구간을 만들거나 바꿀 수 없습니다.
              </p>
            </>
          ) : (
            <p className="plan-evidence-panel__empty">
              안전하게 검증된 입력과 시장 데이터가 없어 실행 수치를 계산하지 않았습니다.
            </p>
          )}
        </section>

        <section className="plan-evidence-panel__group" aria-labelledby="evidence-ai-explanation">
          <header className="plan-evidence-panel__group-heading">
            <span>쉽게 풀어쓴 내용</span>
            <strong id="evidence-ai-explanation">AI 설명</strong>
          </header>
          {explanation ? (
            <div className="plan-evidence-panel__explanation">
              <p>{explanation.understoodConcern}</p>
              <p>{explanation.priorityReason}</p>
              <small>
                AI는 검증된 사용자 고민과 시장 지표를 바탕으로 장단점과 이유만 설명했습니다.
              </small>
            </div>
          ) : (
            <p className="plan-evidence-panel__empty">
              안전하게 확인된 AI 설명이 없어 새 설명을 대신 만들지 않았습니다.
            </p>
          )}
        </section>

        <footer className="plan-evidence-panel__footer">
          <span>결과를 만든 방식</span>
          <strong>
            {market?.synthetic ? "합성 예시" : envelope.market.mode === "YAHOO_LIVE" ? "Yahoo Finance" : "시장 데이터 없음"}
            {envelope.generation.model ? ` · AI ${envelope.generation.model}` : " · AI 설명 없음"}
          </strong>
        </footer>
      </div>
    </details>
  );
}
