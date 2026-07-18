"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { DemoOrderSidecar } from "@/lib/demo-order-sidecar";
import type { ExecutionPlan } from "@/lib/execution-core";

export type DemoOrderSheetProps = {
  open: boolean;
  plan: ExecutionPlan | null;
  sidecar: DemoOrderSidecar | null;
  subjectLabel: string;
  onClose: () => void;
  onSimulatedComplete?: (plan: ExecutionPlan) => void;
};

type SheetView = "PREVIEW" | "CONFIRM" | "COMPLETE";

const PLAN_LABELS: Record<ExecutionPlan["id"], string> = {
  ONE_SHOT: "한 번에 확인하는 계획",
  STAGED_2: "두 번으로 나누는 계획",
  STAGED_3: "세 번으로 나누는 계획",
};

const ALLOCATION_CONDITION_LABELS: Record<
  ExecutionPlan["allocations"][number]["condition"],
  string
> = {
  INITIAL_REVIEW: "첫 회차를 검토할 때",
  RECHECK_REQUIRED: "새 가격과 중단 조건을 다시 확인한 뒤",
};

function formatKrw(value: number): string {
  return `${new Intl.NumberFormat("ko-KR").format(Math.round(value))}원`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "확인할 수 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "확인할 수 없음";
  return date.toLocaleString("ko-KR");
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("hidden"));
}

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
  const directionLabel = sidecar.direction === "BUY" ? "매수" : "매도";
  const withinBandCondition = plan.conditions.find(
    (condition) => condition.code === "WITHIN_REVIEW_BAND",
  );

  function completeSimulation() {
    if (!plan) return;
    setViewState({ planId: plan.id, view: "COMPLETE" });
    onSimulatedComplete?.(plan);
  }

  function closeSheet() {
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
                ? "모의 주문 연습을 마쳤어요"
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
              <strong>연습 완료</strong>
              <p>
                {subjectLabel} {directionLabel} 계획을 모의로 확인했습니다. 증권사 주문 화면이나
                계좌로 전송된 내용은 없습니다.
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
              </dl>
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
                  <h3 id={`${titleId}-order-style`}>주문 방식 함께 확인</h3>
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
                    실시간 호가 미확인 · {sidecar.orderReview.limitation}
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
                <aside className="demo-order-sheet__confirm" role="note">
                  <strong>마지막 확인</strong>
                  <p>
                    다음 화면도 모의 체결 화면입니다. 실제 주문 API·계좌·주문서에는 연결되지
                    않습니다.
                  </p>
                </aside>
              ) : null}
            </>
          )}
        </div>

        <footer className="demo-order-sheet__actions">
          {view === "PREVIEW" ? (
            <button
              type="button"
              className="demo-order-sheet__primary"
              onClick={() => setViewState({ planId: plan.id, view: "CONFIRM" })}
            >
              이 계획으로 주문 연습하기
            </button>
          ) : view === "CONFIRM" ? (
            <>
              <button
                type="button"
                className="demo-order-sheet__secondary"
                onClick={() => setViewState({ planId: plan.id, view: "PREVIEW" })}
              >
                이전
              </button>
              <button
                type="button"
                className="demo-order-sheet__primary"
                onClick={completeSimulation}
              >
                모의 주문 확인
              </button>
            </>
          ) : (
            <button type="button" className="demo-order-sheet__primary" onClick={closeSheet}>
              화면으로 돌아가기
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
