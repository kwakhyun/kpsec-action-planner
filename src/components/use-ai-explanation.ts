"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  DecisionEnvelopeSchema,
  type DecisionConversationInput,
  type DecisionEnvelope,
} from "@/lib/decision-contracts";
import type { ExecutionPlan } from "@/lib/execution-core";
import type { MarketView } from "@/lib/market-view";

import {
  sameInput,
  sameMarket,
  type AiExplanationState,
} from "./security-trading-demo-model";

type AiExplanationRequest = Readonly<{
  input: DecisionConversationInput;
  market: MarketView;
  expectedPreferredPlanId: ExecutionPlan["id"];
}>;

export function useAiExplanation() {
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<AiExplanationState>("IDLE");
  const [envelope, setEnvelope] = useState<DecisionEnvelope | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setEnvelope(null);
    setMessage(null);
    setState("IDLE");
  }, []);

  const request = useCallback(
    async ({
      input,
      market,
      expectedPreferredPlanId,
    }: AiExplanationRequest) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setState("LOADING");
      setMessage(null);
      setEnvelope(null);
      const timeoutId = window.setTimeout(() => controller.abort(), 30_000);

      try {
        const response = await fetch("/api/decision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "LIVE", input }),
          signal: controller.signal,
        });
        if (response.status === 429) {
          throw new Error(
            "잠시 요청이 몰리고 있습니다. 잠시 후 다시 시도해 주세요.",
          );
        }
        const payload: unknown = await response.json();
        const parsed = DecisionEnvelopeSchema.safeParse(payload);
        if (!parsed.success) {
          throw new Error("AI 설명 응답을 안전하게 확인하지 못했습니다.");
        }
        const nextEnvelope = parsed.data;
        if (requestIdRef.current !== requestId) return;
        setEnvelope(nextEnvelope);

        const aligned =
          response.ok &&
          nextEnvelope.status === "READY_FOR_REVIEW" &&
          nextEnvelope.generation.mode === "LIVE" &&
          nextEnvelope.generation.outcome === "SUCCESS" &&
          nextEnvelope.explanation !== null &&
          sameInput(nextEnvelope.inputSnapshot, input) &&
          sameMarket(nextEnvelope, market) &&
          nextEnvelope.decision?.preferredPlanId === expectedPreferredPlanId;
        if (!aligned) {
          setState("FAILURE");
          setMessage(
            nextEnvelope.failureMessage ??
              "화면의 공개 데이터와 AI 설명 기준이 달라 새 설명을 표시하지 않았습니다.",
          );
          return;
        }
        setState("SUCCESS");
      } catch (error: unknown) {
        if (requestIdRef.current !== requestId) return;
        setState("FAILURE");
        setMessage(
          error instanceof DOMException && error.name === "AbortError"
            ? "AI 응답이 늦어 새 설명을 만들지 않았습니다."
            : error instanceof Error
              ? error.message
              : "AI 설명을 만들지 못했습니다.",
        );
      } finally {
        window.clearTimeout(timeoutId);
        if (requestIdRef.current === requestId) abortRef.current = null;
      }
    },
    [],
  );

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  return {
    aiState: state,
    aiEnvelope: envelope,
    aiMessage: message,
    resetAiExplanation: reset,
    requestAiExplanation: request,
  };
}
