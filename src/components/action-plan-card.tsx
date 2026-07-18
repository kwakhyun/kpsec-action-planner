import type { PlanEnvelope } from "@/lib/contracts";
import {
  CHOICE_LABELS,
  evidenceDisplayLabel,
  FAILURE_MESSAGES,
  fieldPathLabel,
  generationSummary,
  humanizePlanText,
  MODE_LABELS,
  OUTCOME_LABELS,
  SAFETY_MESSAGES,
  STATUS_LABELS,
} from "@/lib/presentation";

type ActionPlanCardProps = {
  envelope: PlanEnvelope;
  title?: string;
  eyebrow?: string;
};

function EmptyMessage({ children }: { children: string }) {
  return <p className="empty-message">{children}</p>;
}

function EvidenceReferences({
  references,
  evidence,
}: {
  references: string[];
  evidence: PlanEnvelope["plan"]["userEvidence"];
}) {
  return (
    <div className="evidence-reference" aria-label="이 항목의 근거">
      <span>이 항목의 근거</span>
      <ul className="evidence-ref-list">
        {references.map((reference) => (
          <li
            className={reference === "MISSING_INFORMATION" ? "is-missing" : ""}
            key={reference}
          >
            {evidenceDisplayLabel(reference, evidence)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ActionPlanCard({
  envelope,
  title = "다음 행동 정리",
  eyebrow,
}: ActionPlanCardProps) {
  const { generation, plan, safetyOverride } = envelope;
  const isFailure = generation.outcome === "FAILURE";
  const isReady = plan.status === "READY_FOR_REVIEW";
  const titleKey = title.replace(/[^a-zA-Z0-9가-힣]+/g, "-");
  const summaryChecks = plan.orderedChecks.slice(0, 3);
  const summaryGate = plan.decisionGates[0];
  const summaryStop = plan.stopConditions[0];
  const summaryDelta = plan.counterfactuals[0];
  const evidence = plan.userEvidence;
  const show = (value: string) => humanizePlanText(value, evidence);

  const notice = generation.failureCode
    ? FAILURE_MESSAGES[generation.failureCode]
    : safetyOverride
      ? SAFETY_MESSAGES[safetyOverride]
      : generation.outcome === "SKIPPED"
        ? "필수 내용을 먼저 확인해야 해서 새 분석을 시작하지 않았습니다."
        : null;

  return (
    <article
      className={`plan-card plan-card--${plan.status.toLowerCase()}`}
      aria-labelledby={`plan-title-${titleKey}`}
      data-status={plan.status}
    >
      <header className="plan-card__header">
        <div className="plan-card__heading">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h2 id={`plan-title-${titleKey}`}>{title}</h2>
          <p className="plan-card__scope">
            투자 결론이 아니라, 직접 확인할 순서와 멈춰야 할 조건입니다.
          </p>
        </div>

        <div className="plan-card__badges" aria-label="분석과 현재 상태">
          <span
            className={`provenance-badge provenance-badge--${generation.mode.toLowerCase()}`}
            data-testid="generation-mode"
          >
            {MODE_LABELS[generation.mode]}
          </span>
          <span
            className={`provenance-badge provenance-badge--${generation.outcome.toLowerCase()}`}
            data-testid="generation-outcome"
          >
            {OUTCOME_LABELS[generation.outcome]}
          </span>
          <span
            className={`status-badge status-badge--${plan.status.toLowerCase()}`}
            data-testid="plan-status"
          >
            {STATUS_LABELS[plan.status]}
          </span>
          {isReady ? <span className="not-order-badge">주문 준비 완료가 아님</span> : null}
        </div>
      </header>

      {isFailure || generation.outcome === "SKIPPED" || safetyOverride ? (
        <aside className="generation-notice" aria-label="분석 상태 안내">
          <strong>{generationSummary(generation)}</strong>
          {notice ? <span data-testid="failure-message">{notice}</span> : null}
          <span>이전 성공 결과나 준비된 예시를 현재 결과처럼 보여주지 않았습니다.</span>
        </aside>
      ) : null}

      <section className="presentation-summary" data-testid="presentation-summary">
        <header className="presentation-summary__header">
          <div>
            <p className="plan-section__eyebrow">한눈에 보는 다음 행동</p>
            <h3>{generationSummary(generation)}</h3>
          </div>
        </header>

        <ol className="summary-flow" aria-label="다음 행동 요약">
          <li className="summary-flow__item">
            <span className="summary-flow__number" aria-hidden="true">1</span>
            <section>
              <h4>지금 상태</h4>
              <strong>{STATUS_LABELS[plan.status]}</strong>
              <p>{show(plan.currentSituation.intentSummary)}</p>
              <div className="condition-change">
                <span className="condition-change__label">조건을 하나 바꿔 보기</span>
                <strong data-testid="changed-field">
                  {fieldPathLabel(summaryDelta.fieldPath, evidence)}
                </strong>
                <p className="counterfactual-item__change">
                  <span>{show(summaryDelta.from)}</span>
                  <span aria-hidden="true">→</span>
                  <span>{show(summaryDelta.to)}</span>
                </p>
                <p>{show(summaryDelta.impact)}</p>
              </div>
            </section>
          </li>

          <li className="summary-flow__item">
            <span className="summary-flow__number" aria-hidden="true">2</span>
            <section>
              <h4>가장 먼저 할 일</h4>
              {summaryChecks.length > 0 ? (
                <ol className="summary-checks">
                  {summaryChecks.map((check) => (
                    <li key={`${check.order}-${check.check}`}>
                      <strong>{show(check.check)}</strong>
                      <EvidenceReferences
                        references={check.evidenceRefs}
                        evidence={evidence}
                      />
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyMessage>
                  지금은 새 행동을 제시하지 않습니다. 먼저 부족한 정보를 확인해 주세요.
                </EmptyMessage>
              )}
            </section>
          </li>

          <li className="summary-flow__item">
            <span className="summary-flow__number" aria-hidden="true">3</span>
            <section>
              <h4>왜 확인해야 하는지</h4>
              <ul className="bullet-list summary-reasons">
                {plan.reasons.slice(0, 3).map((reason, index) => (
                  <li key={`${reason}-${index}`}>{show(reason)}</li>
                ))}
              </ul>
            </section>
          </li>

          <li className="summary-flow__item">
            <span className="summary-flow__number" aria-hidden="true">4</span>
            <section>
              <h4>진행 전에 확인할 조건</h4>
              {summaryGate ? (
                <div className="summary-item">
                  <strong>{show(summaryGate.question)}</strong>
                  <p>
                    <b>진행할 수 있는 조건:</b> {show(summaryGate.passCondition)}
                  </p>
                  <EvidenceReferences
                    references={summaryGate.evidenceRefs}
                    evidence={evidence}
                  />
                </div>
              ) : (
                <EmptyMessage>
                  진행 조건을 만들 만큼 정보가 충분하지 않습니다.
                </EmptyMessage>
              )}
            </section>
          </li>

          <li className="summary-flow__item">
            <span className="summary-flow__number" aria-hidden="true">5</span>
            <section>
              <h4>여기서 멈춰야 하는 조건</h4>
              <div className="summary-item summary-item--stop">
                <strong>{show(summaryStop.trigger)}</strong>
                <p>{show(summaryStop.reason)}</p>
                <p>
                  <b>다시 살펴볼 수 있는 조건:</b> {show(summaryStop.resumeWhen)}
                </p>
              </div>
            </section>
          </li>

          <li className="summary-flow__item">
            <span className="summary-flow__number" aria-hidden="true">6</span>
            <section>
              <h4>내가 선택할 다음 행동</h4>
              <p>{show(plan.finalChoice.prompt)}</p>
              <ul className="choice-list" aria-label="내가 선택할 수 있는 다음 행동">
                {plan.finalChoice.options.map((option) => (
                  <li key={option}>{CHOICE_LABELS[option]}</li>
                ))}
              </ul>
            </section>
          </li>
        </ol>
      </section>

      <details className="plan-details">
        <summary data-testid="detail-toggle">
          <span>자세히 살펴보기</span>
          <small>입력한 정보와 확인 방법을 차례로 볼 수 있어요</small>
        </summary>

        <ol className="plan-flow" aria-label="다음 행동 상세 설명">
          <li className="plan-section">
            <div className="plan-section__number" aria-hidden="true">1</div>
            <section aria-labelledby={`situation-${titleKey}`}>
              <p className="plan-section__eyebrow">지금 상황</p>
              <h3 id={`situation-${titleKey}`}>입력한 내용과 아직 확인하지 않은 정보를 나눠 봅니다</h3>
              <p>{show(plan.currentSituation.intentSummary)}</p>

              <div className="fact-list" aria-label="입력한 내용">
                {plan.currentSituation.confirmedFacts.length > 0 ? (
                  plan.currentSituation.confirmedFacts.map((fact, index) => (
                    <article className="fact-item" key={`${fact.statement}-${index}`}>
                      <p>{show(fact.statement)}</p>
                      <div className="fact-item__labels">
                        <span>직접 입력한 정보</span>
                        <span>앱에서 따로 확인하지 않음</span>
                      </div>
                    </article>
                  ))
                ) : (
                  <EmptyMessage>입력에서 바로 확인할 수 있는 내용이 없습니다.</EmptyMessage>
                )}
              </div>

              {evidence.length > 0 ? (
                <div className="fact-list" aria-label="판단에 참고한 정보">
                  {evidence.map((item, index) => (
                    <article className="fact-item" key={item.id}>
                      <strong>참고 정보 {index + 1}</strong>
                      <p>{show(item.statement)}</p>
                      <p className="fact-item__source">
                        {item.sourceLabel}
                        {item.observedAt ? ` · ${item.observedAt}` : " · 확인한 날짜 없음"}
                      </p>
                      <div className="fact-item__labels">
                        <span>직접 입력한 정보</span>
                        <span>앱에서 따로 확인하지 않음</span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
          </li>

          <li className="plan-section">
            <div className="plan-section__number" aria-hidden="true">2</div>
            <section aria-labelledby={`reasons-${titleKey}`}>
              <p className="plan-section__eyebrow">확인하는 이유</p>
              <h3 id={`reasons-${titleKey}`}>왜 이 순서로 살펴봐야 하나요?</h3>
              <ul className="bullet-list">
                {plan.reasons.map((reason, index) => (
                  <li key={`${reason}-${index}`}>{show(reason)}</li>
                ))}
              </ul>
              <h4 className="subsection-title">아직 모르는 것</h4>
              <ul className="bullet-list bullet-list--unknown">
                {plan.uncertainties.map((uncertainty, index) => (
                  <li key={`${uncertainty}-${index}`}>{show(uncertainty)}</li>
                ))}
              </ul>
            </section>
          </li>

          <li className="plan-section">
            <div className="plan-section__number" aria-hidden="true">3</div>
            <section aria-labelledby={`checks-${titleKey}`}>
              <p className="plan-section__eyebrow">순서대로 확인할 것</p>
              <h3 id={`checks-${titleKey}`}>한 번에 하나씩 확인해 보세요</h3>
              {plan.orderedChecks.length > 0 ? (
                <ol className="check-list">
                  {plan.orderedChecks.map((item) => (
                    <li key={`${item.order}-${item.check}`}>
                      <div className="check-list__order">{item.order}</div>
                      <div>
                        <strong>{show(item.check)}</strong>
                        <EvidenceReferences references={item.evidenceRefs} evidence={evidence} />
                        <dl className="detail-list">
                          <div><dt>왜 필요한가요?</dt><dd>{show(item.why)}</dd></div>
                          <div><dt>어떻게 확인하나요?</dt><dd>{show(item.howToVerify)}</dd></div>
                          <div><dt>언제 끝나나요?</dt><dd>{show(item.doneWhen)}</dd></div>
                        </dl>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyMessage>먼저 부족한 정보를 확인해 주세요.</EmptyMessage>
              )}
            </section>
          </li>

          <li className="plan-section">
            <div className="plan-section__number" aria-hidden="true">4</div>
            <section aria-labelledby={`gates-${titleKey}`}>
              <p className="plan-section__eyebrow">진행 전에 확인할 조건</p>
              <h3 id={`gates-${titleKey}`}>이 조건을 확인하기 전에는 다음 단계로 가지 마세요</h3>
              {plan.decisionGates.length > 0 ? (
                <div className="gate-list">
                  {plan.decisionGates.map((gate, index) => (
                    <article className="gate-item" key={`${gate.question}-${index}`}>
                      <strong>{show(gate.question)}</strong>
                      <EvidenceReferences references={gate.evidenceRefs} evidence={evidence} />
                      <dl className="detail-list">
                        <div><dt>진행할 수 있는 조건</dt><dd>{show(gate.passCondition)}</dd></div>
                        <div><dt>조건을 확인했다면</dt><dd>{show(gate.onPass)}</dd></div>
                        <div><dt>확인하지 못했다면</dt><dd>{show(gate.onFail)}</dd></div>
                      </dl>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyMessage>진행 조건을 만들 만큼 정보가 충분하지 않습니다.</EmptyMessage>
              )}
            </section>
          </li>

          <li className="plan-section">
            <div className="plan-section__number" aria-hidden="true">5</div>
            <section aria-labelledby={`stop-${titleKey}`}>
              <p className="plan-section__eyebrow">멈춰야 하는 조건</p>
              <h3 id={`stop-${titleKey}`}>이 상황에서는 먼저 멈추고 확인하세요</h3>
              <div className="stop-list">
                {plan.stopConditions.map((condition, index) => (
                  <article className="stop-item" key={`${condition.trigger}-${index}`}>
                    <strong>{show(condition.trigger)}</strong>
                    <dl className="detail-list">
                      <div><dt>멈추는 이유</dt><dd>{show(condition.reason)}</dd></div>
                      <div><dt>다시 살펴볼 수 있는 조건</dt><dd>{show(condition.resumeWhen)}</dd></div>
                    </dl>
                  </article>
                ))}
              </div>
              <div className="counterfactual-list">
                <article className="counterfactual-item">
                  <div className="counterfactual-item__title">
                    <strong>조건을 하나 바꿔 보기</strong>
                    <span>{fieldPathLabel(summaryDelta.fieldPath, evidence)}</span>
                  </div>
                  <p className="counterfactual-item__change">
                    <span>{show(summaryDelta.from)}</span>
                    <span aria-hidden="true">→</span>
                    <span>{show(summaryDelta.to)}</span>
                  </p>
                  <p>{show(summaryDelta.impact)}</p>
                </article>
              </div>
            </section>
          </li>

          <li className="plan-section">
            <div className="plan-section__number" aria-hidden="true">6</div>
            <section aria-labelledby={`choice-${titleKey}`}>
              <p className="plan-section__eyebrow">내가 선택할 다음 행동</p>
              <h3 id={`choice-${titleKey}`}>마지막 선택은 내가 직접 합니다</h3>
              <p>{show(plan.finalChoice.prompt)}</p>
              <ul className="choice-list" aria-label="내가 선택할 수 있는 다음 행동">
                {plan.finalChoice.options.map((option) => (
                  <li key={option}>{CHOICE_LABELS[option]}</li>
                ))}
              </ul>

              {plan.nextQuestions.length > 0 ? (
                <div className="next-questions">
                  <h4>정보를 더 채우기 위한 질문</h4>
                  <ol>
                    {plan.nextQuestions.map((question, index) => (
                      <li key={`${question}-${index}`}>{show(question)}</li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </section>
          </li>
        </ol>
      </details>

      <details className="technical-details">
        <summary data-testid="technical-toggle">기술 상세</summary>
        <div className="technical-details__content">
          <p>아래 값은 검증과 문제 해결을 위한 내부 표시입니다.</p>
          <dl>
            <div><dt>요청한 분석 방법</dt><dd><code>{generation.requestedMode}</code> — {MODE_LABELS[generation.requestedMode]}</dd></div>
            <div><dt>실제로 사용한 방법</dt><dd><code>{generation.mode}</code> — {MODE_LABELS[generation.mode]}</dd></div>
            <div><dt>분석 결과</dt><dd><code>{generation.outcome}</code> — {OUTCOME_LABELS[generation.outcome]}</dd></div>
            <div><dt>내부 상태</dt><dd><code>{plan.status}</code> — {STATUS_LABELS[plan.status]}</dd></div>
            {generation.failureCode ? (
              <div><dt>실패 코드</dt><dd data-testid="failure-code"><code>{generation.failureCode}</code> — {FAILURE_MESSAGES[generation.failureCode]}</dd></div>
            ) : null}
            {safetyOverride ? (
              <div><dt>안전을 위해 바뀐 결과</dt><dd data-testid="safety-override"><code>{safetyOverride}</code> — {SAFETY_MESSAGES[safetyOverride]}</dd></div>
            ) : null}
            {generation.fixtureId ? (
              <div><dt>준비된 예시 식별자</dt><dd><code>{generation.fixtureId}</code></dd></div>
            ) : null}
            {generation.fixtureVersion ? (
              <div><dt>준비된 예시 버전</dt><dd><code>{generation.fixtureVersion}</code></dd></div>
            ) : null}
            <div><dt>바뀐 입력 경로</dt><dd><code>{summaryDelta.fieldPath}</code> — {fieldPathLabel(summaryDelta.fieldPath, evidence)}</dd></div>
          </dl>

          {evidence.length > 0 ? (
            <div className="technical-evidence">
              <strong>참고 정보 연결</strong>
              <ul>
                {evidence.map((item, index) => (
                  <li key={item.id}>참고 정보 {index + 1}: <code>{item.id}</code></li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </details>
    </article>
  );
}
