import { z } from "zod";

import type { DecisionConversationInput } from "./decision-contracts";
import type { ExecutionPlan } from "./execution-core";
import type { MarketView } from "./market-view";

export const DemoOrderSidecarSchema = z
  .object({
    symbol: z.string().trim().min(1).max(24),
    direction: z.enum(["BUY", "SELL"]),
    planId: z.enum(["ONE_SHOT", "STAGED_2", "STAGED_3"]),
    allocations: z
      .array(
        z.object({
          sequence: z.number().int().positive(),
          shares: z.number().int().positive(),
          amountKrw: z.number().int().nonnegative(),
          condition: z.enum(["INITIAL_REVIEW", "RECHECK_REQUIRED"]),
        }),
      )
      .min(1)
      .max(3),
    totalShares: z.number().int().positive(),
    referenceTotalAmountKrw: z.number().int().nonnegative(),
    reviewConditions: z.array(z.string().trim().min(1)).min(1),
    marketAsOf: z.string().datetime(),
    orderReview: z
      .object({
        preference: z.enum(["FAST_EXECUTION", "PRICE_CONTROL", "UNSURE"]),
        firstComparison: z.enum(["MARKET", "LIMIT", "BOTH"]),
        summary: z.string().trim().min(1),
        orderBookStatus: z.literal("NO_ORDER_BOOK"),
        limitation: z.string().trim().min(1),
      })
      .strict()
      .optional(),
    userReviewLine: z
      .object({
        label: z.string().trim().min(1),
        priceKrw: z.number().int().nonnegative(),
        meaning: z.string().trim().min(1),
      })
      .strict()
      .optional(),
    demoOnly: z.literal(true),
  })
  .strict();

export type DemoOrderSidecar = z.infer<typeof DemoOrderSidecarSchema>;

/**
 * Future order-form integration boundary. Only deterministic core values and
 * market provenance cross it; this function never submits an order and never
 * accepts AI-authored quantities or prices.
 */
export function prepareDemoOrderSidecar(
  input: DecisionConversationInput,
  market: MarketView,
  plan: ExecutionPlan,
  orderPreference?: "FAST_EXECUTION" | "PRICE_CONTROL" | "UNSURE",
  userReviewLine?: {
    label: string;
    priceKrw: number;
    meaning: string;
  },
): DemoOrderSidecar {
  const orderReview = orderPreference
    ? {
        preference: orderPreference,
        firstComparison:
          orderPreference === "FAST_EXECUTION"
            ? ("MARKET" as const)
            : orderPreference === "PRICE_CONTROL"
              ? ("LIMIT" as const)
              : ("BOTH" as const),
        summary:
          orderPreference === "FAST_EXECUTION"
            ? "빠른 거래를 우선해 시장가의 장단점을 먼저 확인합니다."
            : orderPreference === "PRICE_CONTROL"
              ? "원하는 가격을 지키는 일을 우선해 지정가의 장단점을 먼저 확인합니다."
              : "시장가와 지정가의 차이를 함께 비교한 뒤 선택합니다.",
        orderBookStatus: "NO_ORDER_BOOK" as const,
        limitation:
          "지금 시장의 주문 가격과 대기 물량을 확인하지 않아 가장 알맞은 지정가·실제 가격 차이·거래 완료 가능성을 계산하지 않습니다.",
      }
    : undefined;
  return DemoOrderSidecarSchema.parse({
    symbol: market.symbol,
    direction: input.intent,
    planId: plan.id,
    allocations: plan.allocations.map((allocation) => ({ ...allocation })),
    totalShares: plan.totalShares,
    referenceTotalAmountKrw: plan.referenceTotalAmountKrw,
    reviewConditions: plan.conditions.map(
      (condition) => `${condition.check} ${condition.passWhen}`,
    ),
    marketAsOf: market.provenance.asOf,
    ...(orderReview ? { orderReview } : {}),
    ...(userReviewLine ? { userReviewLine } : {}),
    demoOnly: true,
  });
}
