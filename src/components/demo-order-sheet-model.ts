import type { DemoOrderSidecar } from "@/lib/demo-order-sidecar";
import type { ExecutionPlan } from "@/lib/execution-core";

export type SheetView = "PREVIEW" | "CONFIRM" | "COMPLETE";

export type PracticeChecks = {
  planValues: boolean;
  marketTime: boolean;
  demoBoundary: boolean;
};

export const EMPTY_PRACTICE_CHECKS: PracticeChecks = {
  planValues: false,
  marketTime: false,
  demoBoundary: false,
};

export const PLAN_LABELS: Record<ExecutionPlan["id"], string> = {
  ONE_SHOT: "한 번에 확인하는 계획",
  STAGED_2: "두 번으로 나누는 계획",
  STAGED_3: "세 번으로 나누는 계획",
};

export const ALLOCATION_CONDITION_LABELS: Record<
  DemoOrderSidecar["allocations"][number]["condition"],
  string
> = {
  INITIAL_REVIEW: "첫 회차를 검토할 때",
  RECHECK_REQUIRED: "새 가격과 중단 조건을 다시 확인한 뒤",
};

export function formatOrderKrw(value: number): string {
  return `${new Intl.NumberFormat("ko-KR").format(Math.round(value))}원`;
}

export function formatOrderDateTime(value: string | null): string {
  if (!value) return "확인할 수 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "확인할 수 없음";
  return date.toLocaleString("ko-KR");
}

export function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("hidden"));
}
