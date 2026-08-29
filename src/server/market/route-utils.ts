import "server-only";

import { z } from "zod";

export const MARKET_NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
} as const;

export const MarketSymbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(24)
  .regex(/^[A-Z0-9.^=-]+$/);

type CommonMarketFailureCode =
  | "INVALID_SYMBOL"
  | "DATA_PROVIDER_FAILURE"
  | "DATA_SCHEMA_FAILURE"
  | "DATA_INSUFFICIENT"
  | "DATA_STALE";

export function marketFailureStatus(code: CommonMarketFailureCode): number {
  if (code === "INVALID_SYMBOL") return 400;
  if (code === "DATA_INSUFFICIENT") return 422;
  if (code === "DATA_STALE") return 503;
  return 502;
}
