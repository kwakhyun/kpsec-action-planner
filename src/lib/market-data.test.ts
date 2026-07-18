import assert from "node:assert/strict";
import test from "node:test";

import {
  buildYahooChartUrl,
  calculateMarketMetrics,
  fetchYahooMarketData,
  MarketDataError,
  MarketSnapshotSchema,
  type DailyOhlcvBar,
  type MarketDataFailureCode,
  type MarketDataFetch,
} from "./market-data";

const SYMBOL = "005930.KS";
const FIXED_NOW = new Date("2026-07-18T12:00:00.000Z");
const FIRST_TIMESTAMP = Date.parse("2026-06-27T00:00:00.000Z") / 1_000;

function makeBars(count = 21): DailyOhlcvBar[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index;
    return {
      timestamp: FIRST_TIMESTAMP + index * 24 * 60 * 60,
      open: close - 1,
      high: close + 2,
      low: close - 2,
      close,
      volume: 1_000 + index * 10,
    };
  });
}

function makeYahooPayload(bars = makeBars()): unknown {
  return {
    chart: {
      result: [
        {
          meta: {
            symbol: SYMBOL,
            currency: "KRW",
            exchangeName: "KSC",
            exchangeTimezoneName: "Asia/Seoul",
            dataGranularity: "1d",
            range: "3mo",
          },
          timestamp: bars.map((bar) => bar.timestamp),
          indicators: {
            quote: [
              {
                open: bars.map((bar) => bar.open),
                high: bars.map((bar) => bar.high),
                low: bars.map((bar) => bar.low),
                close: bars.map((bar) => bar.close),
                volume: bars.map((bar) => bar.volume),
              },
            ],
          },
        },
      ],
      error: null,
    },
  };
}

function responseFetch(
  payload: unknown,
  onRequest?: (input: RequestInfo | URL, init?: RequestInit) => void,
): MarketDataFetch {
  return async (input, init) => {
    onRequest?.(input, init);
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

async function assertMarketDataError(
  run: () => Promise<unknown>,
  expectedCode: MarketDataFailureCode,
): Promise<void> {
  await assert.rejects(
    run,
    (error: unknown) =>
      error instanceof MarketDataError && error.code === expectedCode,
  );
}

test("Yahoo URL is scoped to the required public daily chart endpoint", () => {
  const url = new URL(buildYahooChartUrl(SYMBOL));

  assert.equal(url.origin, "https://query1.finance.yahoo.com");
  assert.equal(url.pathname, `/v8/finance/chart/${SYMBOL}`);
  assert.equal(url.searchParams.get("range"), "3mo");
  assert.equal(url.searchParams.get("interval"), "1d");
  assert.equal(url.searchParams.get("includePrePost"), "false");
  assert.equal(url.searchParams.get("events"), "div,splits");
});

test("validated OHLCV produces deterministic provenance and 20-session metrics", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const bars = makeBars();
  const result = await fetchYahooMarketData(SYMBOL, {
    fetchImpl: responseFetch(makeYahooPayload(bars), (input, init) => {
      requestUrl = String(input);
      requestInit = init;
    }),
    now: () => FIXED_NOW,
  });

  assert.equal(MarketSnapshotSchema.safeParse(result).success, true);
  assert.equal(result.provider, "Yahoo Finance");
  assert.equal(result.sourceUrl, requestUrl);
  assert.equal(result.fetchedAt, FIXED_NOW.toISOString());
  assert.equal(result.asOf, "2026-07-17T00:00:00.000Z");
  assert.equal(result.range, "3mo");
  assert.equal(result.interval, "1d");
  assert.match(result.delayNotice, /지연.*실시간 호가가 아닙니다/);
  assert.equal(result.synthetic, false);
  assert.equal(requestInit?.cache, "no-store");
  assert.equal(result.metrics.latestPrice, 120);
  assert.equal(result.metrics.range20d.high, 122);
  assert.equal(result.metrics.range20d.low, 99);
  assert.equal(result.metrics.range20d.percent, (23 / 120) * 100);
  assert.equal(result.metrics.relativeVolume20d, 1_200 / 1_105);

  const logReturns = bars
    .slice(-21)
    .slice(1)
    .map((bar, index) => Math.log(bar.close / bars.slice(-21)[index].close));
  const mean = logReturns.reduce((sum, value) => sum + value, 0) / 20;
  const sampleVariance =
    logReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / 19;
  assert.equal(
    result.metrics.volatility20dPct,
    Math.sqrt(sampleVariance) * Math.sqrt(252) * 100,
  );
});

test("metric calculation fails closed with fewer than 21 complete sessions", () => {
  assert.throws(
    () => calculateMarketMetrics(makeBars(20)),
    (error: unknown) =>
      error instanceof MarketDataError && error.code === "DATA_INSUFFICIENT",
  );
});

test("HTTP, network, and provider-declared failures share a typed provider failure", async () => {
  await assertMarketDataError(
    () =>
      fetchYahooMarketData(SYMBOL, {
        fetchImpl: async () => new Response(null, { status: 503 }),
        now: () => FIXED_NOW,
      }),
    "DATA_PROVIDER_FAILURE",
  );

  await assertMarketDataError(
    () =>
      fetchYahooMarketData(SYMBOL, {
        fetchImpl: async () => {
          throw new Error("offline");
        },
        now: () => FIXED_NOW,
      }),
    "DATA_PROVIDER_FAILURE",
  );

  await assertMarketDataError(
    () =>
      fetchYahooMarketData(SYMBOL, {
        fetchImpl: responseFetch({
          chart: {
            result: null,
            error: { code: "Not Found", description: "missing symbol" },
          },
        }),
        now: () => FIXED_NOW,
      }),
    "DATA_PROVIDER_FAILURE",
  );
});

test("invalid JSON, malformed raw shape, and invalid OHLC fail schema validation", async () => {
  await assertMarketDataError(
    () =>
      fetchYahooMarketData(SYMBOL, {
        fetchImpl: async () => new Response("not-json", { status: 200 }),
        now: () => FIXED_NOW,
      }),
    "DATA_SCHEMA_FAILURE",
  );

  await assertMarketDataError(
    () =>
      fetchYahooMarketData(SYMBOL, {
        fetchImpl: responseFetch({ chart: { result: "invalid", error: null } }),
        now: () => FIXED_NOW,
      }),
    "DATA_SCHEMA_FAILURE",
  );

  const invalidBars = makeBars();
  invalidBars[3] = { ...invalidBars[3], high: invalidBars[3].low - 1 };
  await assertMarketDataError(
    () =>
      fetchYahooMarketData(SYMBOL, {
        fetchImpl: responseFetch(makeYahooPayload(invalidBars)),
        now: () => FIXED_NOW,
      }),
    "DATA_SCHEMA_FAILURE",
  );
});

test("null sessions are skipped but cannot bypass the minimum data requirement", async () => {
  const payload = makeYahooPayload(makeBars());
  if (
    typeof payload === "object" &&
    payload !== null &&
    "chart" in payload
  ) {
    const typed = payload as {
      chart: {
        result: Array<{
          indicators: { quote: Array<{ close: Array<number | null> }> };
        }>;
      };
    };
    typed.chart.result[0].indicators.quote[0].close[0] = null;
  }

  await assertMarketDataError(
    () =>
      fetchYahooMarketData(SYMBOL, {
        fetchImpl: responseFetch(payload),
        now: () => FIXED_NOW,
      }),
    "DATA_INSUFFICIENT",
  );
});

test("valid but old daily data is rejected as stale", async () => {
  await assertMarketDataError(
    () =>
      fetchYahooMarketData(SYMBOL, {
        fetchImpl: responseFetch(makeYahooPayload()),
        now: () => new Date("2026-08-01T00:00:00.000Z"),
      }),
    "DATA_STALE",
  );
});
