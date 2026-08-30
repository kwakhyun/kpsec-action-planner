"use client";

import { useEffect, useRef, useState } from "react";

import {
  AdversarialReviewEnvelopeSchema,
  type AdversarialAnswerKey,
  type AdversarialCoreAnswer,
  type AdversarialQuestionKey,
  type AdversarialReviewRequest,
  type AdversarialReviewResult,
} from "@/lib/adversarial-review-contracts";

import styles from "./adversarial-review-agent.module.css";

type QuickAnswer = {
  key: AdversarialAnswerKey;
  label: string;
};

const QUICK_ANSWERS: Record<AdversarialQuestionKey, QuickAnswer[]> = {
  CONFIRM_REGRET_PRIORITY: [
    { key: "PRICE_RISK", label: "산 뒤 내려가는 상황이 더 걱정돼요" },
    { key: "MISSED_OPPORTUNITY", label: "기회를 놓치는 상황이 더 걱정돼요" },
  ],
  CONFIRM_DEADLINE: [
    { key: "NOW", label: "지금 바로" },
    { key: "TODAY", label: "오늘 안에" },
    { key: "THIS_WEEK", label: "이번 주 안에" },
    { key: "NO_RUSH", label: "급하지 않아요" },
  ],
  CONFIRM_LOSS_TOLERANCE: [
    { key: "TIGHTER", label: "감당 범위를 더 줄일게요" },
    { key: "KEEP_CURRENT", label: "지금 범위를 유지할게요" },
    { key: "WIDER", label: "더 넓은 움직임도 감당할게요" },
  ],
  CONFIRM_ORDER_PRIORITY: [
    { key: "FAST_EXECUTION", label: "빨리 거래하는 게 더 중요해요" },
    { key: "PRICE_CONTROL", label: "원하는 가격을 지키는 게 더 중요해요" },
    { key: "UNSURE", label: "아직 잘 모르겠어요" },
  ],
  CONFIRM_HOLDING_HORIZON: [
    { key: "DAYS", label: "며칠" },
    { key: "WEEKS", label: "몇 주" },
    { key: "MONTHS", label: "몇 달" },
    { key: "YEARS", label: "일 년 이상" },
  ],
  CONFIRM_EXIT_STYLE: [
    { key: "ONE_SHOT", label: "한 번에 정리하는 안" },
    { key: "STAGED", label: "나누어 정리하는 안" },
  ],
};

type Props = {
  request: AdversarialReviewRequest | null;
  requestKey: string;
  onCoreRecalculate: (
    answer: AdversarialCoreAnswer,
  ) => void | Promise<void>;
  disabled?: boolean;
  className?: string;
};

type LoadState = "IDLE" | "LOADING" | "SUCCESS" | "FAILURE";

export function AdversarialReviewAgent({
  request,
  requestKey,
  onCoreRecalculate,
  disabled = false,
  className,
}: Props) {
  return (
    <AdversarialReviewSession
      key={requestKey}
      request={request}
      onCoreRecalculate={onCoreRecalculate}
      disabled={disabled}
      className={className}
    />
  );
}

type SessionProps = Omit<Props, "requestKey">;

function AdversarialReviewSession({
  request,
  onCoreRecalculate,
  disabled = false,
  className,
}: SessionProps) {
  const [loadState, setLoadState] = useState<LoadState>("IDLE");
  const [result, setResult] = useState<AdversarialReviewResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [answering, setAnswering] = useState(false);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      requestIdRef.current += 1;
      abortRef.current?.abort();
    },
    [],
  );

  async function requestReview() {
    if (!request || disabled || loadState === "LOADING") return;

    setLoadState("LOADING");
    setResult(null);
    setMessage(null);
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const timeoutId = window.setTimeout(() => controller.abort(), 35_000);

    try {
      const response = await fetch("/api/adversarial-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 429) {
        throw new Error("잠시 요청이 몰리고 있습니다. 잠시 후 다시 시도해 주세요.");
      }
      const payload: unknown = await response.json();
      const parsed = AdversarialReviewEnvelopeSchema.safeParse(payload);
      if (requestIdRef.current !== requestId) return;
      if (!parsed.success) {
        setLoadState("FAILURE");
        setMessage("AI 응답 형식을 확인하지 못해 새 반대 의견을 표시하지 않았습니다.");
        return;
      }

      if (
        !response.ok ||
        parsed.data.status !== "READY_FOR_REVIEW" ||
        parsed.data.result === null ||
        parsed.data.inputSnapshot === null ||
        JSON.stringify(parsed.data.inputSnapshot) !== JSON.stringify(request)
      ) {
        setLoadState("FAILURE");
        setMessage(
          parsed.data.failureMessage ??
            "AI가 새 반대 의견을 만들지 못했습니다. 기존 계획은 바꾸지 않았습니다.",
        );
        return;
      }

      setResult(parsed.data.result);
      setLoadState("SUCCESS");
    } catch (error: unknown) {
      if (requestIdRef.current !== requestId) return;
      setLoadState("FAILURE");
      setResult(null);
      setMessage(
        error instanceof DOMException && error.name === "AbortError"
          ? "AI 응답이 늦어 새 반대 의견을 만들지 않았습니다."
          : error instanceof Error
            ? error.message
          : "네트워크에 연결하지 못해 새 반대 의견을 만들지 않았습니다.",
      );
    } finally {
      window.clearTimeout(timeoutId);
      if (requestIdRef.current === requestId) abortRef.current = null;
    }
  }

  async function chooseAnswer(
    questionKey: AdversarialQuestionKey,
    answerKey: AdversarialAnswerKey,
  ) {
    if (answering) return;
    setAnswering(true);
    setMessage(null);
    try {
      await onCoreRecalculate({ questionKey, answerKey });
      setMessage(
        "답변을 계획 계산기에 전달했습니다. 새 실행안은 AI가 아니라 계획 계산기가 다시 계산합니다.",
      );
    } catch {
      setMessage(
        "답변을 반영해 실행안을 다시 계산하지 못했습니다. 기존 계획은 그대로 유지합니다.",
      );
    } finally {
      setAnswering(false);
    }
  }

  const factLabels = new Map(
    request?.facts.map((fact) => [fact.id, fact.label]) ?? [],
  );

  return (
    <section className={className} aria-labelledby="adversarial-review-title">
      <div className={styles.challengeCard}>
        <div>
          <div className={styles.challengeAiIdentity}>
            <span className={styles.challengeAiBadge} aria-hidden="true">
              AI
            </span>
            <span>
              <strong>AI 다른 관점</strong>
              <small>
                {loadState === "LOADING"
                  ? "검증된 사실을 읽는 중"
                  : loadState === "SUCCESS"
                    ? "검토 완료"
                    : "사실 범위 안에서만 질문"}
              </small>
            </span>
          </div>
          <p className={styles.challengeEyebrow}>한 번 더 생각해 보기</p>
          <h3 id="adversarial-review-title">
            이 계획의 반대 의견도 들어볼까요?
          </h3>
          <p className={styles.challengeIntro}>
            확인된 시장 정보와 지금 입력한 조건만 사용합니다. AI는 계획을
            직접 바꾸지 않습니다.
          </p>
        </div>

        <button
          type="button"
          className={`${styles.challengeCta} btn btn--primary`}
          onClick={requestReview}
          disabled={!request || disabled || loadState === "LOADING"}
        >
          {loadState === "LOADING"
            ? "반대 의견을 확인하고 있어요…"
            : "이 계획의 반대 의견도 들어볼까요?"}
        </button>

        {loadState === "LOADING" ? (
          <div className={styles.challengeThinking} role="status">
            <span aria-hidden="true">AI</span>
            <p>시장 정보와 내 조건에서 놓친 가정을 확인하고 있어요.</p>
          </div>
        ) : null}

        <div aria-live="polite" aria-atomic="true">
          {loadState === "FAILURE" && message ? (
            <div
              className={`${styles.challengeMessage} ${styles.challengeMessageError}`}
              role="alert"
            >
              <strong>새 의견을 사용하지 않았어요</strong>
              <span>{message}</span>
            </div>
          ) : null}

          {result ? (
            <div className={styles.challengeResult}>
              <div>
                <p className={styles.challengeSectionLabel}>
                  가장 강한 반대 의견
                </p>
                <ol className={styles.challengeList}>
                  {result.counterarguments.map((item, index) => (
                    <li key={`${item.argument}-${index}`}>
                      <p>{item.argument}</p>
                      <small>
                        확인한 근거:{" "}
                        {item.factIds
                          .map((id) => factLabels.get(id) ?? "확인된 시장 정보")
                          .join(", ")}
                      </small>
                    </li>
                  ))}
                </ol>
              </div>

              <div className={styles.challengeAssumption}>
                <p className={styles.challengeSectionLabel}>
                  아직 확인하지 않은 가정
                </p>
                <p>{result.unverifiedAssumption}</p>
              </div>

              <div className={styles.challengeQuestion}>
                <p className={styles.challengeSectionLabel}>
                  계획을 다시 비교할 질문
                </p>
                <strong>{result.question}</strong>
                <p>{result.whatWouldChangePlan}</p>
                <div className={styles.challengeAnswers} aria-label="빠른 답변">
                  {QUICK_ANSWERS[result.questionKey].map((answer) => (
                    <button
                      type="button"
                      className="chip"
                      key={answer.key}
                      onClick={() => chooseAnswer(result.questionKey, answer.key)}
                      disabled={answering}
                    >
                      {answer.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {loadState !== "FAILURE" && message ? (
            <div className={styles.challengeMessage} role="status">
              {message}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
