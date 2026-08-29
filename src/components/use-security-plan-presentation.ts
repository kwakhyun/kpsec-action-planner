"use client";

import { useMemo } from "react";

import type { PositionCoachDraft } from "@/components/position-coach-panel";
import {
  buildAdversarialRequest,
  buildAdversarialRequestKey,
  sameInput,
  sameMarket,
  type AiExplanationState,
  type ConcernMode,
} from "@/components/security-trading-demo-model";
import type { AdversarialReviewRequest } from "@/lib/adversarial-review-contracts";
import type {
  DecisionConversationInput,
  DecisionEnvelope,
} from "@/lib/decision-contracts";
import { prepareDemoOrderSidecar } from "@/lib/demo-order-sidecar";
import type { ExecutionPlan } from "@/lib/execution-core";
import type { MarketView } from "@/lib/market-view";
import {
  buildExecutionFromMarket,
  localCoreEnvelope,
  preferredPlan,
} from "@/lib/trading-demo";
import type { TradeCoachSuccess } from "@/lib/trade-coach-contracts";

type UseSecurityPlanPresentationOptions = Readonly<{
  input: DecisionConversationInput;
  market: MarketView | null;
  positionCoach: TradeCoachSuccess | null;
  selectedPlanId: ExecutionPlan["id"];
  orderStylePreference: PositionCoachDraft["orderStylePreference"];
  aiState: AiExplanationState;
  aiEnvelope: DecisionEnvelope | null;
  planVisible: boolean;
  concern: ConcernMode | null;
  positionDraft: PositionCoachDraft;
}>;

export function useSecurityPlanPresentation({
  input,
  market,
  positionCoach,
  selectedPlanId,
  orderStylePreference,
  aiState,
  aiEnvelope,
  planVisible,
  concern,
  positionDraft,
}: UseSecurityPlanPresentationOptions) {
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
  const isAlignedAiEnvelope = Boolean(
    aiState === "SUCCESS" &&
      aiEnvelope &&
      market &&
      sameInput(aiEnvelope.inputSnapshot, input) &&
      sameMarket(aiEnvelope, market),
  );
  const evidenceEnvelope = isAlignedAiEnvelope ? aiEnvelope : localEnvelope;
  const verifiedExplanation = isAlignedAiEnvelope
    ? aiEnvelope?.explanation ?? null
    : null;
  const adversarialRequest = useMemo<AdversarialReviewRequest | null>(
    () =>
      buildAdversarialRequest({
        planVisible,
        market,
        decision: presentedDecision,
        selectedPlan,
        concern,
        input,
        orderStylePreference,
        positionDraft,
      }),
    [
      concern,
      input,
      market,
      orderStylePreference,
      planVisible,
      positionDraft,
      presentedDecision,
      selectedPlan,
    ],
  );
  const adversarialRequestKey = useMemo(
    () => buildAdversarialRequestKey(adversarialRequest),
    [adversarialRequest],
  );

  return {
    coreDecision,
    presentedDecision,
    selectedPlan,
    marketSupported,
    orderSidecar,
    evidenceEnvelope,
    verifiedExplanation,
    adversarialRequest,
    adversarialRequestKey,
  };
}
