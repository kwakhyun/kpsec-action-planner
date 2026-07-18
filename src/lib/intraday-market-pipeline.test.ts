import assert from "node:assert/strict";
import test from "node:test";

import { GET } from "../app/api/market/intraday/route";
import { IntradayMarketEnvelopeSchema } from "./intraday-market";

const SYMBOL = "005930.KS";

function yahooIntradayPayload(
  interval: "1m" | "5m",
  count: number,
): unknown {
  const step = interval === "1m" ? 60 : 300;
  const latest = Math.floor(Date.now() / 1_000) - 30;
  const timestamps = Array.from(
    { length: count },
    (_, index) => latest - (count - 1 - index) * step,
  );
  const closes = timestamps.map((_, index) => 79_000 + index * 10);
  return {
    chart: {
      result: [
        {
          meta: {
            symbol: SYMBOL,
            currency: "KRW",
            exchangeName: "KSC",
            exchangeTimezoneName: "Asia/Seoul",
            dataGranularity: interval,
            range: "1d",
          },
          timestamp: timestamps,
          indicators: {
            quote: [
              {
                open: closes.map((close) => close - 5),
                high: closes.map((close) => close + 20),
                low: closes.map((close) => close - 20),
                close: closes,
                volume: closes.map((_, index) => 100_000 + index * 100),
              },
            ],
          },
        },
      ],
      error: null,
    },
  };
}

function marketRequest(): Request {
  return new Request(
    `http://127.0.0.1/api/market/intraday?symbol=${SYMBOL}`,
  );
}

async function withFetchMock(
  mock: typeof fetch,
  run: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("충분한 1분 데이터가 있으면 5분을 호출하지 않는다", async () => {
  const calls: string[] = [];
  await withFetchMock(
    async (input) => {
      calls.push(String(input));
      return Response.json(yahooIntradayPayload("1m", 12));
    },
    async () => {
      const response = await GET(marketRequest());
      const envelope = IntradayMarketEnvelopeSchema.parse(await response.json());
      assert.equal(response.status, 200);
      assert.equal(envelope.status, "SUCCESS");
      if (envelope.status !== "SUCCESS") return;
      assert.equal(envelope.data.provenance.interval, "1m");
      assert.deepEqual(envelope.data.provenance.attemptedIntervals, ["1m"]);
      assert.equal(envelope.data.provenance.fallbackReason, null);
      assert.equal(envelope.data.provenance.synthetic, false);
    },
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0], /interval=1m/);
});

test("1분 데이터가 부족하면 5분으로 한 번만 fallback한다", async () => {
  const calls: string[] = [];
  await withFetchMock(
    async (input) => {
      const url = String(input);
      calls.push(url);
      return Response.json(
        url.includes("interval=1m")
          ? yahooIntradayPayload("1m", 11)
          : yahooIntradayPayload("5m", 12),
      );
    },
    async () => {
      const response = await GET(marketRequest());
      const envelope = IntradayMarketEnvelopeSchema.parse(await response.json());
      assert.equal(response.status, 200);
      assert.equal(envelope.status, "SUCCESS");
      if (envelope.status !== "SUCCESS") return;
      assert.equal(envelope.data.provenance.interval, "5m");
      assert.deepEqual(envelope.data.provenance.attemptedIntervals, ["1m", "5m"]);
      assert.equal(
        envelope.data.provenance.fallbackReason,
        "ONE_MINUTE_DATA_INSUFFICIENT",
      );
      assert.equal(envelope.data.provenance.synthetic, false);
    },
  );
  assert.equal(calls.length, 2);
  assert.match(calls[0], /interval=1m/);
  assert.match(calls[1], /interval=5m/);
});

test("1분·5분이 모두 부족하면 이전 성공이나 합성 값을 승계하지 않는다", async () => {
  await withFetchMock(
    async (input) =>
      Response.json(
        String(input).includes("interval=1m")
          ? yahooIntradayPayload("1m", 5)
          : yahooIntradayPayload("5m", 5),
      ),
    async () => {
      const response = await GET(marketRequest());
      const envelope = IntradayMarketEnvelopeSchema.parse(await response.json());
      assert.equal(response.status, 422);
      assert.equal(envelope.status, "FAILURE");
      if (envelope.status !== "FAILURE") return;
      assert.equal(envelope.data, null);
      assert.equal(envelope.error.code, "DATA_INSUFFICIENT");
    },
  );
});
