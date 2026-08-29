"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ChartHistoryEnvelopeSchema,
  type ChartHistoryView,
} from "@/lib/chart-history";
import {
  IntradayMarketEnvelopeSchema,
  type IntradayMarketView,
} from "@/lib/intraday-market";
import {
  MarketViewEnvelopeSchema,
  type MarketView,
} from "@/lib/market-view";

type UseSecurityMarketDataOptions = Readonly<{
  initialSymbol: string;
  onBeforeLoad: () => void;
  onMarketLoaded: (market: MarketView) => void;
}>;

export function useSecurityMarketData({
  initialSymbol,
  onBeforeLoad,
  onMarketLoaded,
}: UseSecurityMarketDataOptions) {
  const marketRequestIdRef = useRef(0);
  const marketAbortRef = useRef<AbortController | null>(null);
  const intradayAbortRef = useRef<AbortController | null>(null);
  const historyAbortRef = useRef<AbortController | null>(null);
  const [searchValue, setSearchValue] = useState(initialSymbol);
  const [market, setMarket] = useState<MarketView | null>(null);
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [intraday, setIntraday] = useState<IntradayMarketView | null>(null);
  const [intradayError, setIntradayError] = useState<string | null>(null);
  const [history, setHistory] = useState<ChartHistoryView | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const loadIntraday = useCallback(
    async (symbol: string, parentRequestId: number) => {
      intradayAbortRef.current?.abort();
      const controller = new AbortController();
      intradayAbortRef.current = controller;
      setIntraday(null);
      setIntradayError(null);

      try {
        const response = await fetch(
          `/api/market/intraday?symbol=${encodeURIComponent(symbol)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const payload: unknown = await response.json();
        const parsed = IntradayMarketEnvelopeSchema.safeParse(payload);
        if (!parsed.success) {
          throw new Error("분봉 데이터 응답을 확인할 수 없습니다.");
        }
        if (marketRequestIdRef.current !== parentRequestId) return;
        if (parsed.data.status === "FAILURE") {
          setIntradayError(parsed.data.error.message);
          return;
        }
        setIntraday(parsed.data.data);
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (marketRequestIdRef.current !== parentRequestId) return;
        setIntradayError(
          error instanceof Error && error.message
            ? error.message
            : "1분·5분 공개 데이터를 확인하지 못했습니다.",
        );
      } finally {
        if (intradayAbortRef.current === controller) {
          intradayAbortRef.current = null;
        }
      }
    },
    [],
  );

  const loadHistory = useCallback(
    async (symbol: string, parentRequestId: number) => {
      historyAbortRef.current?.abort();
      const controller = new AbortController();
      historyAbortRef.current = controller;
      setHistory(null);
      setHistoryError(null);

      try {
        const response = await fetch(
          `/api/market/history?symbol=${encodeURIComponent(symbol)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const payload: unknown = await response.json();
        const parsed = ChartHistoryEnvelopeSchema.safeParse(payload);
        if (!parsed.success) {
          throw new Error("장기 차트 데이터 응답을 확인할 수 없습니다.");
        }
        if (marketRequestIdRef.current !== parentRequestId) return;
        if (parsed.data.status === "FAILURE") {
          setHistoryError(parsed.data.error.message);
          return;
        }
        setHistory(parsed.data.data);
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (marketRequestIdRef.current !== parentRequestId) return;
        setHistoryError(
          error instanceof Error && error.message
            ? error.message
            : "주·월·년 단위 장기 공개 데이터를 확인하지 못했습니다.",
        );
      } finally {
        if (historyAbortRef.current === controller) {
          historyAbortRef.current = null;
        }
      }
    },
    [],
  );

  const loadMarket = useCallback(
    async (symbol: string) => {
      const normalizedSymbol = symbol.trim().toUpperCase();
      marketRequestIdRef.current += 1;
      marketAbortRef.current?.abort();
      intradayAbortRef.current?.abort();
      historyAbortRef.current?.abort();
      onBeforeLoad();

      setMarket(null);
      setIntraday(null);
      setIntradayError(null);
      setHistory(null);
      setHistoryError(null);
      setMarketError(null);

      if (!normalizedSymbol) {
        setMarketLoading(false);
        setMarketError("종목 코드를 입력해 주세요.");
        return;
      }

      const controller = new AbortController();
      marketAbortRef.current = controller;
      const requestId = marketRequestIdRef.current;
      setMarketLoading(true);

      try {
        const response = await fetch(
          `/api/market?symbol=${encodeURIComponent(normalizedSymbol)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const payload: unknown = await response.json();
        const parsed = MarketViewEnvelopeSchema.safeParse(payload);
        if (!parsed.success) {
          throw new Error("시장 데이터 응답을 확인할 수 없습니다.");
        }
        if (marketRequestIdRef.current !== requestId) return;
        if (parsed.data.status === "FAILURE") {
          setMarketError(parsed.data.error.message);
          return;
        }

        const nextMarket = parsed.data.data;
        setMarket(nextMarket);
        setSearchValue(nextMarket.symbol);
        onMarketLoaded(nextMarket);
        void Promise.all([
          loadIntraday(nextMarket.symbol, requestId),
          loadHistory(nextMarket.symbol, requestId),
        ]);
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (marketRequestIdRef.current !== requestId) return;
        setMarketError(
          error instanceof Error && error.message
            ? error.message
            : "공개 시세를 불러오지 못했습니다.",
        );
      } finally {
        if (marketRequestIdRef.current === requestId) {
          setMarketLoading(false);
          marketAbortRef.current = null;
        }
      }
    },
    [loadHistory, loadIntraday, onBeforeLoad, onMarketLoaded],
  );

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void loadMarket(initialSymbol);
    }, 0);
    return () => {
      window.clearTimeout(timerId);
      marketAbortRef.current?.abort();
      intradayAbortRef.current?.abort();
      historyAbortRef.current?.abort();
    };
  }, [initialSymbol, loadMarket]);

  return {
    searchValue,
    setSearchValue,
    market,
    marketLoading,
    marketError,
    intraday,
    intradayError,
    history,
    historyError,
    loadMarket,
  };
}
