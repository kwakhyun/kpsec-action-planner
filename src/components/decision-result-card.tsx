"use client";

import type { DecisionEnvelope } from "@/lib/decision-contracts";
import type { ExecutionPlan } from "@/lib/execution-core";

type DecisionResultCardProps = {
  envelope: DecisionEnvelope;
  previousEnvelope?: DecisionEnvelope | null;
  onChangeChoice: (step: 1 | 2 | 3 | 4) => void;
};

const PLAN_LABELS = {
  ONE_SHOT: "한 번에 거래하는 안",
  STAGED_2: "두 번으로 나누는 안",
  STAGED_3: "세 번으로 나누는 안",
} as const;

const DEADLINE_LABELS = {
  NOW: "지금 바로",
  TODAY: "오늘 안에",
  THIS_WEEK: "이번 주 안에",
  NO_RUSH: "기한을 두지 않고",
} as const;

const NEXT_QUESTION_LABELS = {
  NONE: null,
  CONFIRM_DEADLINE: "실행기한을 다시 확인해 주세요.",
  CONFIRM_TOLERANCE: "감당 가능한 변동 범위를 다시 확인해 주세요.",
  CONFIRM_REGRET_PRIORITY: "어떤 후회를 더 줄이고 싶은지 다시 확인해 주세요.",
} as const;

function formatKrw(value: number): string {
  return `${new Intl.NumberFormat("ko-KR").format(Math.round(value))}원`;
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function withObjectParticle(label: string): string {
  const lastCharacter = label.at(-1);
  if (!lastCharacter) return label;
  const codePoint = lastCharacter.charCodeAt(0);
  if (codePoint < 0xac00 || codePoint > 0xd7a3) return `${label}을(를)`;
  return `${label}${(codePoint - 0xac00) % 28 === 0 ? "를" : "을"}`;
}

function planById(
  envelope: DecisionEnvelope,
  id: "ONE_SHOT" | "STAGED_2" | "STAGED_3",
): ExecutionPlan | null {
  return envelope.decision?.plans.find((plan) => plan.id === id) ?? null;
}

function concernSummary(envelope: DecisionEnvelope): string {
  const input = envelope.inputSnapshot;
  if (!input) return "입력한 고민을 안전하게 확인하지 못했습니다.";

  const exposure =
    input.intent === "BUY"
      ? `${formatKrw(input.budgetKrw ?? 0)} 예산으로 사고 싶은 상황`
      : `${new Intl.NumberFormat("ko-KR").format(input.holdingQuantity ?? 0)}주를 팔고 싶은 상황`;
  const regret =
    input.regretPriority === "PRICE_RISK"
      ? "한 시점 가격에 몰리는 위험"
      : "나누는 동안 기회를 놓치는 위험";

  return `${withObjectParticle(input.subjectLabel)} ${exposure}이며, ${DEADLINE_LABELS[input.deadline]} 결정하려고 합니다. ${regret}을 더 걱정하고 ${formatPercent(input.maxAdverseMovePct)}까지 감당할 수 있다고 입력했습니다.`;
}

function PlanPanel({ plan, preferred }: { plan: ExecutionPlan; preferred: boolean }) {
  return (
    <article className={`decision-plan${preferred ? " decision-plan--preferred" : ""}`}>
      <header className="decision-plan__header">
        <div>
          <span>{preferred ? "우선 검토" : "비교안"}</span>
          <h4>{PLAN_LABELS[plan.id]}</h4>
        </div>
        <strong>{plan.totalShares.toLocaleString("ko-KR")}주</strong>
      </header>
      <ol className="allocation-list" aria-label={`${PLAN_LABELS[plan.id]} 수량 배분`}>
        {plan.allocations.map((allocation) => (
          <li key={`${plan.id}-${allocation.sequence}`}>
            <span>{allocation.sequence}번째 확인</span>
            <strong>{allocation.shares.toLocaleString("ko-KR")}주</strong>
            <small>{formatKrw(allocation.amountKrw)}</small>
          </li>
        ))}
      </ol>
      <p className="decision-plan__note">
        최근 완료 거래일 종가 기준 계획 비교값이며 실제 체결 수량·금액이 아닙니다.
      </p>
    </article>
  );
}

export function DecisionResultCard({
  envelope,
  previousEnvelope = null,
  onChangeChoice,
}: DecisionResultCardProps) {
  const input = envelope.inputSnapshot;
  const market = envelope.market.snapshot;
  const decision = envelope.decision;
  const explanation = envelope.explanation;
  const oneShot = planById(envelope, "ONE_SHOT");
  const staged =
    planById(envelope, "STAGED_3") ?? planById(envelope, "STAGED_2");
  const preferred = decision
    ? planById(envelope, decision.preferredPlanId)
    : null;
  const previousStaged = previousEnvelope
    ? (planById(previousEnvelope, "STAGED_3") ??
      planById(previousEnvelope, "STAGED_2"))
    : null;
  const nextQuestion = explanation
    ? NEXT_QUESTION_LABELS[explanation.nextQuestionKey]
    : null;

  return (
    <article className="decision-card" data-testid="decision-result">
      <header className="decision-card__status">
        <div>
          <span className="eyebrow">후회 예산 기반 실행 비교</span>
          <h3 data-testid="decision-status">
            {envelope.status === "READY_FOR_REVIEW"
              ? "우선 검토할 실행안을 정리했어요"
              : "지금은 멈추고 다시 확인해 주세요"}
          </h3>
        </div>
        <span className={`status-pill status-pill--${envelope.status.toLowerCase()}`}>
          {envelope.generation.mode === "LIVE"
            ? "AI와 공개 데이터"
            : envelope.generation.mode === "OFFLINE_DEMO"
              ? "합성 예시"
              : "분석 중단"}
        </span>
      </header>

      {envelope.failureMessage ? (
        <section className="decision-alert" role="alert" data-testid="decision-failure">
          <strong>{envelope.failureMessage}</strong>
          <p>이전 성공 결과나 합성 결과로 자동 대체하지 않았습니다.</p>
        </section>
      ) : null}

      {previousEnvelope?.inputSnapshot && input ? (
        <aside className="decision-delta" data-testid="tolerance-delta">
          <strong>감당 범위를 바꿔 다시 계산했습니다</strong>
          <span>
            {formatPercent(previousEnvelope.inputSnapshot.maxAdverseMovePct)} →{" "}
            {formatPercent(input.maxAdverseMovePct)}
          </span>
          {previousStaged && staged ? (
            <small>
              나누어 거래할 때 첫 확인 수량{" "}
              {previousStaged.allocations[0].shares.toLocaleString("ko-KR")}주 →{" "}
              {staged.allocations[0].shares.toLocaleString("ko-KR")}주, 재확인선도 함께 변경
            </small>
          ) : null}
        </aside>
      ) : null}

      <ol className="decision-story" aria-label="매수·매도 고민 정리 결과">
        <li>
          <span className="decision-story__number">1</span>
          <section>
            <p className="plan-section__eyebrow">제가 이해한 고민</p>
            <h4>사용자가 직접 입력한 내용</h4>
            <p>{concernSummary(envelope)}</p>
            {explanation ? <p className="agent-reflection">“{explanation.understoodConcern}”</p> : null}
          </section>
        </li>

        <li>
          <span className="decision-story__number">2</span>
          <section>
            <p className="plan-section__eyebrow">지금 확인한 시장 상황</p>
            {market ? (
              <>
                <h4>{market.synthetic ? "합성 시장 예시" : "Yahoo Finance 공개 데이터"}</h4>
                <dl className="market-metrics">
                  <div>
                    <dt>최근 완료 거래일 종가</dt>
                    <dd>{formatKrw(market.metrics.latestPrice)}</dd>
                  </div>
                  <div>
                    <dt>최근 변동성</dt>
                    <dd>{formatPercent(market.metrics.volatility20dPct)}</dd>
                  </div>
                  <div>
                    <dt>최근 고저 범위</dt>
                    <dd>
                      {formatKrw(market.metrics.range20d.low)}–
                      {formatKrw(market.metrics.range20d.high)}
                    </dd>
                  </div>
                  <div>
                    <dt>평균 대비 거래량</dt>
                    <dd>
                      {market.metrics.relativeVolume20d === null
                        ? "계산 불가"
                        : `${market.metrics.relativeVolume20d.toFixed(2)}배`}
                    </dd>
                  </div>
                </dl>
                <p className="market-note">
                  기준시각 {new Date(market.asOf).toLocaleString("ko-KR")} · {market.delayNotice}
                </p>
              </>
            ) : (
              <p className="empty-message">검증된 시장 데이터가 없어 새 시장 사실을 만들지 않았습니다.</p>
            )}
          </section>
        </li>

        <li>
          <span className="decision-story__number">3</span>
          <section>
            <p className="plan-section__eyebrow">한 번에 거래하기 vs 나누어 거래하기</p>
            {oneShot && staged ? (
              <div className="decision-plan-grid">
                <PlanPanel
                  plan={oneShot}
                  preferred={decision?.preferredPlanId === oneShot.id && envelope.status === "READY_FOR_REVIEW"}
                />
                <PlanPanel
                  plan={staged}
                  preferred={decision?.preferredPlanId === staged.id && envelope.status === "READY_FOR_REVIEW"}
                />
              </div>
            ) : (
              <p className="empty-message">검증된 가격과 수량이 없어 비교안을 계산하지 않았습니다.</p>
            )}
          </section>
        </li>

        <li>
          <span className="decision-story__number">4</span>
          <section>
            <p className="plan-section__eyebrow">우선 검토할 실행안</p>
            {preferred && explanation && envelope.status === "READY_FOR_REVIEW" ? (
              <>
                <h4 data-testid="preferred-plan">{PLAN_LABELS[preferred.id]}</h4>
                <p>{explanation.priorityReason}</p>
              </>
            ) : (
              <p className="empty-message">
                데이터와 AI 설명을 모두 안전하게 확인하기 전에는 우선안을 제시하지 않습니다.
              </p>
            )}
          </section>
        </li>

        <li>
          <span className="decision-story__number">5</span>
          <section>
            <p className="plan-section__eyebrow">왜 이 안인가</p>
            {explanation ? (
              <div className="tradeoff-grid">
                <article>
                  <strong>한 번에 확인할 때</strong>
                  <p>{explanation.oneShotBenefit}</p>
                  <p>{explanation.oneShotRisk}</p>
                </article>
                <article>
                  <strong>나누어 확인할 때</strong>
                  <p>{explanation.stagedBenefit}</p>
                  <p>{explanation.stagedRisk}</p>
                </article>
              </div>
            ) : (
              <p className="empty-message">안전하게 확인된 AI 설명이 없습니다.</p>
            )}
          </section>
        </li>

        <li>
          <span className="decision-story__number">6</span>
          <section>
            <p className="plan-section__eyebrow">이 조건에서는 멈추고 다시 확인</p>
            {preferred ? (
              <>
                <div className="review-line">
                  <span>재확인선 · 자동 주문가가 아님</span>
                  <strong>
                    {formatKrw(preferred.reviewLine.lowerReviewPriceKrw)}–
                    {formatKrw(preferred.reviewLine.upperReviewPriceKrw)}
                  </strong>
                </div>
                <ul className="stop-condition-list">
                  {preferred.stopConditions.map((condition) => (
                    <li key={condition.code}>
                      <strong>{condition.trigger}</strong>
                      <span>{condition.reason}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="empty-message">시장 데이터를 새로 확인한 뒤 다시 계산해 주세요.</p>
            )}
          </section>
        </li>

        <li>
          <span className="decision-story__number">7</span>
          <section>
            <p className="plan-section__eyebrow">다른 선택으로 바꾸기</p>
            {nextQuestion ? <p className="decision-followup">{nextQuestion}</p> : null}
            <div className="change-choice-row">
              <button type="button" className="secondary-button" onClick={() => onChangeChoice(2)}>
                금액·기한 바꾸기
              </button>
              <button type="button" className="secondary-button" onClick={() => onChangeChoice(3)}>
                더 걱정되는 위험 바꾸기
              </button>
              <button type="button" className="secondary-button" onClick={() => onChangeChoice(4)}>
                감당 범위 바꾸기
              </button>
            </div>
          </section>
        </li>
      </ol>

      <p className="decision-boundary">
        과거 변동 지표와 사용자 입력을 비교한 검토안입니다. 미래 가격·수익을 예측하지 않으며 주문을 실행하지 않습니다.
      </p>

      <details className="technical-details">
        <summary>기술 상세</summary>
        <dl className="decision-technical-grid">
          <div><dt>분석 방법</dt><dd>{envelope.generation.mode}</dd></div>
          <div><dt>분석 결과</dt><dd>{envelope.generation.outcome}</dd></div>
          <div><dt>시장 데이터</dt><dd>{envelope.market.mode} / {envelope.market.outcome}</dd></div>
          {envelope.generation.failureCode ? (
            <div><dt>실패 분류</dt><dd data-testid="decision-failure-code">{envelope.generation.failureCode}</dd></div>
          ) : null}
          {envelope.generation.model ? (
            <div><dt>모델</dt><dd>{envelope.generation.model}</dd></div>
          ) : null}
          {envelope.generation.fixtureId ? (
            <div><dt>합성 예시</dt><dd>{envelope.generation.fixtureId} / {envelope.generation.fixtureVersion}</dd></div>
          ) : null}
          {market?.sourceUrl ? (
            <div>
              <dt>원본</dt>
              <dd><a href={market.sourceUrl} target="_blank" rel="noreferrer">Yahoo Finance 응답 URL</a></dd>
            </div>
          ) : null}
        </dl>
      </details>
    </article>
  );
}
