"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { DemoOrderSidecar } from "@/lib/demo-order-sidecar";
import type { ExecutionPlan } from "@/lib/execution-core";
import {
  ALLOCATION_CONDITION_LABELS,
  EMPTY_PRACTICE_CHECKS,
  focusableElements,
  formatOrderDateTime as formatDateTime,
  formatOrderKrw as formatKrw,
  PLAN_LABELS,
  type PracticeChecks,
  type SheetView,
} from "./demo-order-sheet-model";

export type DemoOrderSheetProps = {
  open: boolean;
  plan: ExecutionPlan | null;
  sidecar: DemoOrderSidecar | null;
  subjectLabel: string;
  onClose: () => void;
  onSimulatedComplete?: (plan: ExecutionPlan) => void;
};


export function DemoOrderSheet({
  open,
  plan,
  sidecar,
  subjectLabel,
  onClose,
  onSimulatedComplete,
}: DemoOrderSheetProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const practiceRef = useRef<HTMLElement>(null);
  const [practiceChecks, setPracticeChecks] = useState<PracticeChecks>(
    EMPTY_PRACTICE_CHECKS,
  );
  const [viewState, setViewState] = useState<{
    planId: ExecutionPlan["id"] | null;
    view: SheetView;
  }>({ planId: null, view: "PREVIEW" });

  useEffect(() => {
    if (!open || !plan || !sidecar) return;

    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setViewState({ planId: null, view: "PREVIEW" });
        onClose();
        return;
      }

      if (event.key !== "Tab" || !dialog) return;
      const elements = focusableElements(dialog);
      if (elements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [open, plan, sidecar, onClose]);

  if (!open || !plan || !sidecar) return null;

  const view = viewState.planId === plan.id ? viewState.view : "PREVIEW";
  const activePlanId = plan.id;
  const directionLabel = sidecar.direction === "BUY" ? "매수" : "매도";
  const withinBandCondition = plan.conditions.find(
    (condition) => condition.code === "WITHIN_REVIEW_BAND",
  );
  const checkedCount = Object.values(practiceChecks).filter(Boolean).length;
  const allPracticeChecksDone = checkedCount === 3;
  const firstAllocation = sidecar.allocations[0];
  const nextAllocation = sidecar.allocations[1];
  const primaryStopCondition = plan.stopConditions[0];

  function startPractice() {
    setPracticeChecks(EMPTY_PRACTICE_CHECKS);
    setViewState({ planId: activePlanId, view: "CONFIRM" });
    window.requestAnimationFrame(() => {
      practiceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function togglePracticeCheck(key: keyof PracticeChecks) {
    setPracticeChecks((current) => ({ ...current, [key]: !current[key] }));
  }

  function completeSimulation() {
    if (!plan) return;
    setViewState({ planId: plan.id, view: "COMPLETE" });
    onSimulatedComplete?.(plan);
  }

  function closeSheet() {
    setPracticeChecks(EMPTY_PRACTICE_CHECKS);
    setViewState({ planId: null, view: "PREVIEW" });
    onClose();
  }

  return (
    <div className="demo-order-sheet" data-testid="demo-order-sheet">
      <div className="demo-order-sheet__backdrop" aria-hidden="true" />
      <div
        ref={dialogRef}
        className="demo-order-sheet__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={view === "COMPLETE" ? undefined : descriptionId}
        tabIndex={-1}
      >
        <header className="demo-order-sheet__header">
          <div>
            <strong className="demo-order-sheet__badge">
              해커톤 데모 · 실제 주문 없음
            </strong>
            <h2 id={titleId}>
              {view === "COMPLETE"
                ? "주문 전 확인 연습 결과"
                : view === "CONFIRM"
                  ? "실행 전에 직접 확인해 볼게요"
                : plan.installmentCount === 1
                  ? "일괄 주문 미리보기"
                  : "분할 주문 미리보기"}
            </h2>
          </div>
          <button
            type="button"
            className="demo-order-sheet__close"
            onClick={closeSheet}
            aria-label="모의 주문 미리보기 닫기"
          >
            닫기
          </button>
        </header>

        <div className="demo-order-sheet__body" aria-live="polite">
          {view === "COMPLETE" ? (
            <section className="demo-order-sheet__complete" data-testid="demo-order-complete">
              <strong>세 가지를 모두 확인했어요</strong>
              <p>
                {subjectLabel} {directionLabel} 계획에서 수량·데이터 시각·실제 주문 아님을 직접
                확인했습니다. 증권사나 계좌로 전송된 내용은 없습니다.
              </p>
              <dl className="demo-order-sheet__completion-summary">
                <div>
                  <dt>연습한 계획</dt>
                  <dd>{PLAN_LABELS[plan.id]}</dd>
                </div>
                <div>
                  <dt>총수량</dt>
                  <dd>{sidecar.totalShares.toLocaleString("ko-KR")}주</dd>
                </div>
                <div>
                  <dt>기준 가격으로 계산한 총금액</dt>
                  <dd>{formatKrw(sidecar.referenceTotalAmountKrw)}</dd>
                </div>
                <div>
                  <dt>확인한 항목</dt>
                  <dd>3개 모두 확인</dd>
                </div>
              </dl>

              <section className="demo-order-sheet__practice-result">
                <h3>실제로 실행하기 전, 이렇게 이어가세요</h3>
                <ol>
                  {firstAllocation ? (
                    <li>
                      <span>첫 회차</span>
                      <strong>
                        {firstAllocation.shares.toLocaleString("ko-KR")}주 ·{" "}
                        {formatKrw(firstAllocation.amountKrw)}
                      </strong>
                      <small>실제 주문 화면에서 수량과 주문 방식을 다시 확인합니다.</small>
                    </li>
                  ) : null}
                  {nextAllocation ? (
                    <li>
                      <span>다음 회차 전</span>
                      <strong>{withinBandCondition?.check ?? "시장 데이터와 중단 조건을 다시 확인합니다."}</strong>
                      <small>처음 계산한 수량을 자동으로 주문하지 않습니다.</small>
                    </li>
                  ) : null}
                  {primaryStopCondition ? (
                    <li className="demo-order-sheet__practice-stop">
                      <span>여기서는 멈춤</span>
                      <strong>{primaryStopCondition.trigger}</strong>
                      <small>{primaryStopCondition.reason}</small>
                    </li>
                  ) : null}
                </ol>
              </section>

              <aside className="demo-order-sheet__integration-boundary">
                <strong>실제 서비스에서는</strong>
                <p>
                  이 계획의 회차별 수량을 주문서에 불러올 수 있습니다. 주문 방식·가격·최종
                  실행은 실제 주문 화면에서 사용자가 다시 확인하고 승인해야 합니다.
                </p>
              </aside>
            </section>
          ) : (
            <>
              <p id={descriptionId} className="demo-order-sheet__notice">
                최근 완료 거래일 가격으로 계산한 연습용 계획입니다. 실제 체결 가격과 금액은
                달라질 수 있으며 어떤 주문도 전송하지 않습니다.
              </p>

              <dl className="demo-order-sheet__summary">
                <div>
                  <dt>종목</dt>
                  <dd>{subjectLabel} · {sidecar.symbol}</dd>
                </div>
                <div>
                  <dt>구분</dt>
                  <dd>{directionLabel}</dd>
                </div>
                <div>
                  <dt>실행 계획</dt>
                  <dd>{PLAN_LABELS[plan.id]}</dd>
                </div>
                <div>
                  <dt>데이터 기준 시각</dt>
                  <dd>
                    {sidecar.marketAsOf ? (
                      <time dateTime={sidecar.marketAsOf}>
                        {formatDateTime(sidecar.marketAsOf)}
                      </time>
                    ) : (
                      "확인할 수 없음"
                    )}
                  </dd>
                </div>
              </dl>

              <section className="demo-order-sheet__plan" aria-labelledby={`${titleId}-allocations`}>
                <div className="demo-order-sheet__section-heading">
                  <h3 id={`${titleId}-allocations`}>회차별 연습 계획</h3>
                  <span>{plan.installmentCount}회</span>
                </div>
                <ol className="demo-order-sheet__allocations">
                  {sidecar.allocations.map((allocation) => (
                    <li
                      className="demo-order-sheet__allocation"
                      key={`${plan.id}-${allocation.sequence}`}
                    >
                      <div>
                        <strong>{allocation.sequence}회차</strong>
                        <span>{ALLOCATION_CONDITION_LABELS[allocation.condition]}</span>
                      </div>
                      <dl>
                        <div>
                          <dt>수량</dt>
                          <dd>{allocation.shares.toLocaleString("ko-KR")}주</dd>
                        </div>
                        <div>
                          <dt>예상 금액</dt>
                          <dd>{formatKrw(allocation.amountKrw)}</dd>
                        </div>
                      </dl>
                      {allocation.condition === "RECHECK_REQUIRED" && withinBandCondition ? (
                        <p className="demo-order-sheet__condition">
                          다시 확인: {withinBandCondition.check}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </section>

              <dl className="demo-order-sheet__totals">
                <div>
                  <dt>총수량</dt>
                  <dd>{sidecar.totalShares.toLocaleString("ko-KR")}주</dd>
                </div>
                <div>
                  <dt>기준 가격으로 계산한 총금액</dt>
                  <dd>{formatKrw(sidecar.referenceTotalAmountKrw)}</dd>
                </div>
                {plan.unallocatedBudgetKrw !== null ? (
                  <div>
                    <dt>남겨 둔 예산</dt>
                    <dd>{formatKrw(plan.unallocatedBudgetKrw)}</dd>
                  </div>
                ) : null}
                {plan.remainingHoldingQuantity !== null ? (
                  <div>
                    <dt>계획 후 남는 보유수량</dt>
                    <dd>{plan.remainingHoldingQuantity.toLocaleString("ko-KR")}주</dd>
                  </div>
                ) : null}
              </dl>

              {sidecar.orderReview ? (
                <section className="demo-order-sheet__recheck" aria-labelledby={`${titleId}-order-style`}>
                  <h3 id={`${titleId}-order-style`}>주문 방식은 여기서 확인해요</h3>
                  <p>선택한 실행안을 주문으로 연습하기 전에, 속도와 가격 중 무엇을 더 중요하게 볼지 확인합니다.</p>
                  <p>
                    <strong>
                      {sidecar.orderReview.firstComparison === "MARKET"
                        ? "시장가를 먼저 비교"
                        : sidecar.orderReview.firstComparison === "LIMIT"
                          ? "지정가를 먼저 비교"
                          : "시장가와 지정가를 함께 비교"}
                    </strong>
                  </p>
                  <p>{sidecar.orderReview.summary}</p>
                  <p className="demo-order-sheet__condition">
                    지금 주문 가능한 가격은 확인하지 못했어요 · {sidecar.orderReview.limitation}
                  </p>
                </section>
              ) : null}

              {sidecar.userReviewLine ? (
                <section className="demo-order-sheet__recheck" aria-labelledby={`${titleId}-user-review-line`}>
                  <h3 id={`${titleId}-user-review-line`}>{sidecar.userReviewLine.label}</h3>
                  <p>
                    <strong>{formatKrw(sidecar.userReviewLine.priceKrw)}</strong>
                  </p>
                  <p>{sidecar.userReviewLine.meaning}</p>
                </section>
              ) : null}

              <section className="demo-order-sheet__recheck" aria-labelledby={`${titleId}-recheck`}>
                <h3 id={`${titleId}-recheck`}>실행 전 다시 확인할 조건</h3>
                <ul>
                  {plan.conditions.map((condition) => (
                    <li key={condition.code}>
                      <strong>{condition.check}</strong>
                      <span>{condition.passWhen}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="demo-order-sheet__recheck" aria-labelledby={`${titleId}-stop`}>
                <h3 id={`${titleId}-stop`}>여기서는 멈추고 다시 확인</h3>
                <ul>
                  {plan.stopConditions.slice(0, 2).map((condition) => (
                    <li key={condition.code}>
                      <strong>{condition.trigger}</strong>
                      <span>{condition.reason}</span>
                    </li>
                  ))}
                </ul>
              </section>

              {view === "CONFIRM" ? (
                <section
                  ref={practiceRef}
                  className="demo-order-sheet__practice-checklist"
                  aria-labelledby={`${titleId}-practice`}
                >
                  <p className="demo-order-sheet__practice-eyebrow">주문 전 확인 연습</p>
                  <h3 id={`${titleId}-practice`}>아래 내용을 직접 확인해 주세요</h3>
                  <p className="demo-order-sheet__practice-description">
                    실제 주문을 넣는 기능이 아닙니다. 계획을 주문서에 옮기기 전에 놓치기 쉬운
                    세 가지를 확인하는 체크리스트입니다.
                  </p>
                  <div className="demo-order-sheet__practice-checks">
                    <label>
                      <input
                        type="checkbox"
                        checked={practiceChecks.planValues}
                        onChange={() => togglePracticeCheck("planValues")}
                      />
                      <span>
                        <strong>수량과 금액이 내가 고른 계획과 같아요</strong>
                        <small>
                          총 {sidecar.totalShares.toLocaleString("ko-KR")}주 ·{" "}
                          {formatKrw(sidecar.referenceTotalAmountKrw)}
                        </small>
                      </span>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={practiceChecks.marketTime}
                        onChange={() => togglePracticeCheck("marketTime")}
                      />
                      <span>
                        <strong>가격을 언제 확인한 데이터인지 봤어요</strong>
                        <small>{formatDateTime(sidecar.marketAsOf)} 기준 · 실제 체결 가격은 달라질 수 있음</small>
                      </span>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={practiceChecks.demoBoundary}
                        onChange={() => togglePracticeCheck("demoBoundary")}
                      />
                      <span>
                        <strong>이 화면에서는 실제 주문이 전송되지 않음을 확인했어요</strong>
                        <small>계좌·주문 API에 연결되지 않은 해커톤 연습 화면입니다.</small>
                      </span>
                    </label>
                  </div>
                  <p className="demo-order-sheet__practice-progress" aria-live="polite">
                    {checkedCount}/3 확인 완료
                  </p>
                </section>
              ) : (
                <section className="demo-order-sheet__practice-intro" aria-labelledby={`${titleId}-intro`}>
                  <p className="demo-order-sheet__practice-eyebrow">버튼을 누르면 하는 일</p>
                  <h3 id={`${titleId}-intro`}>실제 주문 전에 세 가지를 확인해 봅니다</h3>
                  <ol>
                    <li><strong>수량·금액</strong><span>고른 계획과 같은지 확인</span></li>
                    <li><strong>데이터 시각</strong><span>오래된 가격으로 실행하지 않는지 확인</span></li>
                    <li><strong>다음 행동</strong><span>다음 회차 조건과 멈출 조건을 확인</span></li>
                  </ol>
                  <p>체크리스트 연습만 진행하며 실제 주문은 전송되지 않습니다.</p>
                </section>
              )}
            </>
          )}
        </div>

        <footer className="demo-order-sheet__actions">
          {view === "PREVIEW" ? (
            <button
              type="button"
              className="demo-order-sheet__primary btn btn--primary"
              onClick={startPractice}
            >
              주문 전 체크리스트 시작하기
            </button>
          ) : view === "CONFIRM" ? (
            <>
              <button
                type="button"
                className="demo-order-sheet__secondary btn btn--secondary"
                onClick={() => setViewState({ planId: plan.id, view: "PREVIEW" })}
              >
                이전
              </button>
              <button
                type="button"
                className="demo-order-sheet__primary btn btn--primary"
                onClick={completeSimulation}
                disabled={!allPracticeChecksDone}
              >
                {allPracticeChecksDone ? "확인 결과 보기" : `${checkedCount}/3 확인 후 결과 보기`}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="demo-order-sheet__secondary btn btn--secondary"
                onClick={() => setViewState({ planId: plan.id, view: "CONFIRM" })}
              >
                체크리스트 다시 보기
              </button>
              <button type="button" className="demo-order-sheet__primary btn btn--primary" onClick={closeSheet}>
                계획 화면으로 돌아가기
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
