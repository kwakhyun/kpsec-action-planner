import { expect, test, type Page, type Route } from "@playwright/test";

type Harness = {
  externalRequests: string[];
  openAiRequests: string[];
  adversarialRequests: number;
  consoleErrors: string[];
  pageErrors: string[];
};

function makeDailyMarket() {
  const fetchedAt = new Date();
  const latestTimestamp = Math.floor(fetchedAt.getTime() / 1_000) - 3_600;
  const bars = Array.from({ length: 62 }, (_, index) => {
    const close = 76_950 + index * 50;
    return {
      timestamp: latestTimestamp - (61 - index) * 86_400,
      open: close - 100,
      high: close + 300,
      low: close - 300,
      close,
      volume: 1_000_000 + index * 10_000,
    };
  });
  const asOf = new Date(latestTimestamp * 1_000).toISOString();
  return {
    status: "SUCCESS",
    data: {
      symbol: "005930.KS",
      quote: {
        latestPrice: 80_000,
        previousClose: 79_950,
        change: 50,
        changePct: (50 / 79_950) * 100,
        volume: 1_610_000,
      },
      bars,
      metrics: {
        latestPrice: 80_000,
        volatility20dPct: 18,
        range20d: { low: 77_000, high: 81_000, percent: 5 },
        relativeVolume20d: 1.1,
      },
      observations: {
        latestClose: 80_000,
        movingAverage20: 79_525,
        relativeVolume20: 1.1,
        pricePosition: "ABOVE",
        priceText: "최근 가격이 20일 평균보다 위에 있습니다.",
        volumeText: "최근 거래일 거래량은 이전 20개 거래일 평균보다 많습니다.",
        movingAverageText:
          "5일 평균은 최근 움직임에 빠르게 반응하고, 60일 평균은 더 긴 흐름을 천천히 보여줍니다.",
      },
      provenance: {
        provider: "Yahoo Finance",
        sourceUrl:
          "https://query1.finance.yahoo.com/v8/finance/chart/005930.KS?range=3mo&interval=1d",
        fetchedAt: fetchedAt.toISOString(),
        asOf,
        range: "3mo",
        interval: "1d",
        delayNotice:
          "Yahoo Finance 공개 데이터는 거래소와 제공 과정에 따라 지연될 수 있으며 실시간 호가가 아닙니다.",
        synthetic: false,
        currency: "KRW",
        exchange: "KSC",
        exchangeTimezone: "Asia/Seoul",
        tradingSessionCount: bars.length,
      },
    },
    error: null,
  } as const;
}

function makeIntraday(interval: "1m" | "5m" = "1m") {
  const latestTimestamp = Math.floor(Date.now() / 1_000) - 30;
  const step = interval === "1m" ? 60 : 300;
  const bars = Array.from({ length: 20 }, (_, index) => {
    const close = 79_800 + index * 10;
    return {
      timestamp: latestTimestamp - (19 - index) * step,
      open: close - 5,
      high: close + 20,
      low: close - 20,
      close,
      volume: 100_000 + index * 1_000,
    };
  });
  return {
    status: "SUCCESS",
    data: {
      symbol: "005930.KS",
      bars,
      provenance: {
        provider: "Yahoo Finance",
        sourceUrl: `https://query1.finance.yahoo.com/v8/finance/chart/005930.KS?range=1d&interval=${interval}`,
        fetchedAt: new Date().toISOString(),
        asOf: new Date(latestTimestamp * 1_000).toISOString(),
        range: "1d",
        interval,
        resolutionLabel: interval === "1m" ? "1분 봉" : "5분 봉",
        attemptedIntervals: interval === "1m" ? ["1m"] : ["1m", "5m"],
        fallbackReason:
          interval === "1m" ? null : "ONE_MINUTE_DATA_INSUFFICIENT",
        delayNotice:
          "Yahoo Finance 공개 데이터는 거래소와 제공 과정에 따라 지연될 수 있으며 실시간 호가가 아닙니다.",
        synthetic: false,
        currency: "KRW",
        exchange: "KSC",
        exchangeTimezone: "Asia/Seoul",
        sampleCount: bars.length,
        discardedSampleCount: 0,
      },
    },
    error: null,
  } as const;
}

function makeChartHistory() {
  const fetchedAt = new Date();
  const latestTimestamp = Math.floor(fetchedAt.getTime() / 1_000) - 3_600;
  const bars = Array.from({ length: 1_305 }, (_, index) => {
    const close = 62_000 + index * 14;
    return {
      timestamp: latestTimestamp - (1_304 - index) * 86_400,
      open: close - 80,
      high: close + 220,
      low: close - 240,
      close,
      volume: 900_000 + index * 1_000,
    };
  });
  return {
    status: "SUCCESS",
    data: {
      symbol: "005930.KS",
      bars,
      provenance: {
        provider: "Yahoo Finance",
        sourceUrl:
          "https://query1.finance.yahoo.com/v8/finance/chart/005930.KS?range=5y&interval=1d",
        fetchedAt: fetchedAt.toISOString(),
        asOf: new Date(latestTimestamp * 1_000).toISOString(),
        range: "5y",
        interval: "1d",
        delayNotice:
          "Yahoo Finance 공개 데이터는 거래소와 제공 과정에 따라 지연될 수 있으며 실시간 호가가 아닙니다.",
        synthetic: false,
        exchangeTimezone: "Asia/Seoul",
        sampleCount: bars.length,
      },
    },
    error: null,
  } as const;
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installHarness(
  page: Page,
  intraday: "1m" | "5m" | "FAILURE" = "1m",
): Promise<Harness> {
  const harness: Harness = {
    externalRequests: [],
    openAiRequests: [],
    adversarialRequests: 0,
    consoleErrors: [],
    pageErrors: [],
  };

  page.on("console", (message) => {
    if (message.type() === "error") harness.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => harness.pageErrors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
      harness.externalRequests.push(request.url());
    }
    if (url.hostname === "api.openai.com") {
      harness.openAiRequests.push(request.url());
    }
  });

  await page.route("**/api/market?**", async (route) => {
    await fulfillJson(route, makeDailyMarket());
  });
  await page.route("**/api/market/intraday?**", async (route) => {
    if (intraday === "FAILURE") {
      await fulfillJson(
        route,
        {
          status: "FAILURE",
          data: null,
          error: {
            code: "DATA_INSUFFICIENT",
            message: "1분·5분 데이터가 모두 부족해 분 단위 차트를 사용할 수 없습니다.",
          },
        },
        422,
      );
      return;
    }
    await fulfillJson(route, makeIntraday(intraday));
  });
  await page.route("**/api/market/history?**", async (route) => {
    await fulfillJson(route, makeChartHistory());
  });
  await page.route("**/api/adversarial-review", async (route) => {
    harness.adversarialRequests += 1;
    const request = route.request().postDataJSON();
    await fulfillJson(route, {
      status: "READY_FOR_REVIEW",
      generation: {
        requestedMode: "LIVE",
        mode: "LIVE",
        outcome: "SUCCESS",
        failureCode: null,
        model: "mock-structured-model",
      },
      inputSnapshot: request,
      result: {
        counterarguments: [
          {
            argument: "최근 관측 범위 밖에서는 같은 계획을 그대로 적용하기 어렵습니다.",
            factIds: ["MARKET_RANGE_20D"],
          },
        ],
        unverifiedAssumption: "같은 실행기한을 유지한다는 가정입니다.",
        questionKey: "CONFIRM_LOSS_TOLERANCE",
        question: "감당 범위를 지금보다 줄여서 다시 비교할까요?",
        whatWouldChangePlan:
          "답이 달라지면 계획 계산기가 회차별 비중을 다시 계산합니다.",
      },
      failureMessage: null,
    });
  });

  return harness;
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
}

async function openPreBuyPlan(page: Page) {
  const rail = page.locator(".agent-rail");
  await rail.getByRole("button", { name: "살까 고민돼요" }).click();
  await rail.getByRole("button", { name: "다음 질문" }).click();
  await rail.getByRole("button", { name: "이번 주 안에" }).click();
  await rail.getByRole("button", { name: "다음 질문" }).click();
  await rail.getByRole("button", { name: /산 뒤 내려가는 게 더 걱정돼요/ }).click();
  await rail.getByRole("button", { name: "다음 질문" }).click();
  await rail.getByRole("button", { name: "8%" }).click();
  await rail.getByRole("button", { name: "AI로 실행안 비교하기" }).click();
  await expect(
    page.getByRole("heading", { name: "먼저 비교해 볼 방법" }),
  ).toBeVisible();
}

async function fillPositionPlan(
  page: Page,
  entryName: string,
  submitName: string,
) {
  const rail = page.locator(".agent-rail");
  await rail.getByRole("button", { name: entryName }).click();
  await page.getByRole("button", { name: "분 단위 차트" }).click();
  await rail.getByLabel("평균적으로 얼마에 샀나요?").fill("100000");
  await rail.getByLabel("몇 주를 가지고 있나요?").fill("100");
  await rail.getByRole("button", { name: "다음 질문" }).click();
  await rail.getByRole("button", { name: "몇 달" }).click();
  await rail.getByRole("button", { name: "급하지 않아요" }).click();
  await rail.getByRole("button", { name: "다음 질문" }).click();
  await rail.getByLabel("평균 매수가에서 몇 % 손실까지 감당할 수 있나요?").fill("8");
  await rail.getByLabel("직접 정한 이익 확인 기준이 있나요? (선택)").fill("10");
  await rail.getByRole("button", { name: "다음 질문" }).click();
  await rail.getByRole("button", { name: "나누어 매도를 먼저 볼래요" }).click();
  await rail.getByRole("button", { name: "원하는 가격을 지키고 싶어요" }).click();
  await rail.getByRole("button", { name: submitName }).click();
  await expect(rail.getByText("현재 손익", { exact: true })).toBeVisible();
}

function expectCleanHarness(
  harness: Harness,
  options: { allowHandledHttpFailure?: boolean } = {},
) {
  expect(harness.externalRequests).toEqual([]);
  expect(harness.openAiRequests).toEqual([]);
  expect(
    options.allowHandledHttpFailure
      ? harness.consoleErrors.filter(
          (message) => !message.startsWith("Failed to load resource:"),
        )
      : harness.consoleErrors,
  ).toEqual([]);
  expect(harness.pageErrors).toEqual([]);
}

test("production 수직 흐름: 매수 전 → 반대 심문 → 결정 코어 재계산 → 모의 주문", async ({
  page,
}) => {
  const harness = await installHarness(page, "1m");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "삼성전자" })).toBeVisible();
  await expect(page.getByText("해커톤 데모 · 실제 주문 없음").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "분 단위 차트" })).toBeEnabled();
  await page.getByRole("button", { name: "분 단위 차트" }).click();
  await expect(page.getByText(/1분 단위 공개 데이터/)).toBeVisible();
  for (const name of ["분", "일", "주", "월", "년"]) {
    await expect(page.getByRole("button", { name: `${name} 단위 차트` })).toBeVisible();
  }
  await expect(page.getByText("전체 구간", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "확대" }).click();
  await expect(page.getByText(/최근 \d+개 가격 막대/)).toBeVisible();
  await page.getByRole("button", { name: "전체" }).click();
  await expect(page.getByText("전체 구간", { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await openPreBuyPlan(page);
  const contrastStyles = await page.locator(".execution-option").first().evaluate((card) => ({
    title: getComputedStyle(card.querySelector("h3") as HTMLElement).color,
    quantity: getComputedStyle(
      card.querySelector(":scope > button > strong") as HTMLElement,
    ).color,
    amount: getComputedStyle(
      card.querySelector(".execution-option__total-amount > strong") as HTMLElement,
    ).color,
    risk: getComputedStyle(
      card.querySelector(".execution-option__risk") as HTMLElement,
    ).color,
  }));
  expect(contrastStyles).toEqual({
    title: "rgb(32, 38, 45)",
    quantity: "rgb(32, 38, 45)",
    amount: "rgb(38, 49, 58)",
    risk: "rgb(150, 56, 69)",
  });
  await expect(page.getByRole("heading", { name: "무엇을 더 중요하게 생각하나요?" })).toHaveCount(0);
  await expect(page.getByText("시장가와 지정가의 차이는 주문 미리보기에서 선택한 계획과 함께 확인할 수 있어요.")).toBeVisible();

  await page.getByRole("button", { name: "이 계획의 반대 의견도 들어볼까요?" }).click();
  await expect(page.getByText("최근 관측 범위 밖에서는 같은 계획을 그대로 적용하기 어렵습니다.")).toBeVisible();
  expect(harness.adversarialRequests).toBe(1);

  await page.getByRole("button", { name: /두 번으로 나누는 계획/ }).click();
  await expect(page.getByText("최근 관측 범위 밖에서는 같은 계획을 그대로 적용하기 어렵습니다.")).toHaveCount(0);

  await page.getByRole("button", { name: "이 계획의 반대 의견도 들어볼까요?" }).click();
  await page.getByRole("button", { name: "감당 범위를 더 줄일게요" }).click();
  await expect(page.getByText("반대 의견에 답한 뒤 계획이 달라졌어요")).toBeVisible();
  await expect(page.getByText(/AI가 계획을 고친 것이 아니라.*계획 계산기/)).toBeVisible();
  await expect(page.getByText("최근 관측 범위 밖에서는 같은 계획을 그대로 적용하기 어렵습니다.")).toHaveCount(0);
  expect(harness.adversarialRequests).toBe(2);

  const previewButton = page.getByRole("button", { name: /주문 미리보기/ }).last();
  await expect(previewButton).toBeEnabled();
  await previewButton.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "주문 방식은 여기서 확인해요" })).toBeVisible();
  await expect(dialog).toContainText("지금 주문 가능한 가격은 확인하지 못했어요");
  await expect(dialog).not.toContainText(/예상 슬리피지|체결 확률|최적 지정가\s*\d/);
  await expect(dialog).toContainText("실제 주문 없음");
  const close = dialog.getByRole("button", { name: "모의 주문 미리보기 닫기" });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "주문 전 체크리스트 시작하기" })).toBeFocused();
  await dialog.getByRole("button", { name: "주문 전 체크리스트 시작하기" }).click();
  const resultButton = dialog.getByRole("button", { name: "0/3 확인 후 결과 보기" });
  await expect(resultButton).toBeDisabled();
  await dialog.getByRole("checkbox", { name: /수량과 금액이 내가 고른 계획과 같아요/ }).check();
  await dialog.getByRole("checkbox", { name: /가격을 언제 확인한 데이터인지 봤어요/ }).check();
  await dialog.getByRole("checkbox", { name: /실제 주문이 전송되지 않음을 확인했어요/ }).check();
  await dialog.getByRole("button", { name: "확인 결과 보기" }).click();
  await expect(dialog.getByRole("heading", { name: "주문 전 확인 연습 결과" })).toBeVisible();
  await expect(dialog).toContainText("실제로 실행하기 전, 이렇게 이어가세요");
  await expect(dialog).toContainText("실제 서비스에서는");
  await expect(dialog).toContainText("증권사나 계좌로 전송된 내용은 없습니다");
  await expect(dialog.getByRole("button", { name: "체크리스트 다시 보기" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  expectCleanHarness(harness);
});

test("보유 후 선제 가이드의 세 선택과 sidecar 일치, 매도 정상 경로", async ({
  page,
}) => {
  const harness = await installHarness(page, "1m");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "삼성전자" })).toBeVisible();

  await fillPositionPlan(page, "샀는데 가격이 움직여 불안해요", "내 계획 다시 확인하기");
  const rail = page.locator(".agent-rail");
  await expect(rail.getByText("-2,000,000원 · -20%")).toBeVisible();
  await expect(rail.getByText(/92,000원.*-800,000원/)).toBeVisible();
  await expect(rail.getByText(/110,000원.*\+1,000,000원/)).toBeVisible();
  await expect(rail.getByText("먼저 볼 선택: 세 번으로 나누기")).toBeVisible();

  const timeAxis = page.locator(".position-coach-panel__time-axis");
  await expect(timeAxis).toBeVisible();
  await expect(timeAxis).toContainText("몇 달 보유할 계획인데 지금은 1분 움직임을 보고 있어요");
  await expect(timeAxis).not.toContainText(/충동|공포|세션 외|증권사 내부 데이터/);

  await timeAxis.getByRole("button", { name: "원래 계획 다시 보기" }).click();
  await expect(timeAxis).toHaveCount(0);

  await page.getByRole("button", { name: "일 단위 차트" }).click();
  await page.getByRole("button", { name: "분 단위 차트" }).click();
  await expect(page.locator(".position-coach-panel__time-axis")).toBeVisible();
  await page.getByRole("button", { name: "지금 차트 계속 보기" }).click();
  await expect(page.locator(".position-coach-panel__time-axis")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /분할 주문 미리보기/ }).last()).toBeEnabled();

  await page.getByRole("button", { name: "일 단위 차트" }).click();
  await page.getByRole("button", { name: "분 단위 차트" }).click();
  await expect(page.locator(".position-coach-panel__time-axis")).toBeVisible();
  await page.getByRole("button", { name: "하루 단위 차트로 넓혀 보기" }).click();
  await expect(page.getByRole("button", { name: "일 단위 차트" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".position-coach-panel__time-axis")).toHaveCount(0);

  const preview = page.getByRole("button", { name: /분할 주문 미리보기/ }).last();
  await preview.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("세 번으로 나누는 계획");
  await expect(dialog).toContainText("내가 다시 확인할 손실 가격");
  await expect(dialog).toContainText("92,000원");
  await expect(dialog.locator(".demo-order-sheet__allocation")).toHaveCount(3);
  await page.keyboard.press("Escape");

  await rail.getByRole("button", { name: "매매 동반자 닫기" }).click();
  await rail.getByRole("button", { name: "팔 시점을 고민하고 있어요" }).click();
  await rail.getByRole("button", { name: "매도 선택지 비교하기" }).click();
  await expect(rail.getByRole("heading", { name: "전량과 분할 매도를 함께 비교해 볼게요" })).toBeVisible();
  await expect(rail.getByText("현재 손익", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  expectCleanHarness(harness);
});

test("5분 fallback은 표시 전용이고 분봉 부족 시 분 탭을 비활성화한다", async ({
  page,
}) => {
  const fallbackHarness = await installHarness(page, "5m");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "삼성전자" })).toBeVisible();
  await page.getByRole("button", { name: "분 단위 차트" }).click();
  await expect(page.getByText(/5분 단위 공개 데이터/)).toBeVisible();
  await expect(page.getByText(/실행안 계산용 3개월 일봉은 분리/)).toHaveCount(0);
  expectCleanHarness(fallbackHarness);

  const secondPage = await page.context().newPage();
  const failureHarness = await installHarness(secondPage, "FAILURE");
  await secondPage.goto("/");
  await expect(secondPage.getByRole("heading", { name: "삼성전자" })).toBeVisible();
  await expect(secondPage.getByRole("button", { name: "분 단위 차트" })).toBeDisabled();
  await expect(secondPage.getByText(/분 단위 비활성화.*1분·5분 데이터가 모두 부족/)).toBeVisible();
  await expect(secondPage.getByText(/1분 단위 공개 데이터|5분 단위 공개 데이터/)).toHaveCount(0);
  expectCleanHarness(failureHarness, { allowHandledHttpFailure: true });
});
