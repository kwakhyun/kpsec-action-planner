# Design QA — execution plan text contrast

## Evidence

- Source screenshot: `/var/folders/p_/l1vl4bpd7n12spj8vcqs3_240000gn/T/TemporaryItems/NSIRD_screencaptureui_Dh1hz1/스크린샷 2026-07-18 오후 1.03.40.png`
- Implementation screenshot: `/private/tmp/kpsec-contrast-fixed-1840x936.png`
- Side-by-side comparison: `/private/tmp/kpsec-contrast-comparison.png`
- Viewport: `1840 × 936`
- State: 삼성전자 매수 고민, 예산 10,000,000원, 이번 주 안, 산 뒤 내려가는 후회 우선, 재확인 범위 8%, 3회 분할안 우선 검토

## Full-page comparison

- Source: white and pale-blue text from the former dark theme remained on white and pale-yellow cards, making plan names, quantities, amounts, and the selected-plan heading difficult to read.
- Implementation: the same execution-plan content renders with dark neutral text, dark gold labels, muted blue-gray secondary values, and a darker red risk label.
- The current product shell and agent panel were preserved; this change intentionally does not redesign layout or copy.

## Focused comparison

| Element | Before | After | Contrast check |
| --- | --- | --- | --- |
| Section eyebrow | pale yellow | `#765d00` | 5.96:1 on pale yellow |
| Selected plan name in summary | near white | `#5d4900` | 8.22:1 on pale yellow |
| Card title and quantity | near white | `#20262d` | 15.26:1 on white; 14.43:1 on pale yellow |
| Amount and row labels | pale blue | `#586879` | 5.72:1 on white; 5.41:1 on pale yellow |
| Risk copy | pale pink | `#963845` | 7.12:1 on white; 6.74:1 on pale yellow |

All measured combinations exceed WCAG AA contrast for normal text. Browser-computed styles matched the intended values, and the page produced no console warnings or errors during the checked flow.

## Findings history

1. P1 — Dark-theme selectors had higher specificity than the later light-theme overrides, so their foreground colors won in the cascade. Fixed with a narrowly scoped light-mode contrast guard using matching-or-higher specificity.
2. P1 recheck — Plan headings, quantities, amounts, row labels, risk text, rationale, and review-line text are legible in both regular and selected cards. Passed.
3. P2 — No image assets are used in the affected execution-plan section; image quality is not applicable.
4. Regression — Added a browser assertion for computed title, quantity, amount, and risk colors. Unit tests, typecheck, lint, and production build passed.

## Chart unit and zoom QA

- Before screenshot: `/private/tmp/kpsec-chart-before.png`
- After screenshot: `/private/tmp/kpsec-chart-after-minute.png`
- Side-by-side comparison: `/private/tmp/kpsec-chart-units-comparison.png`
- Desktop viewport: `1280 × 720`
- Mobile viewport: `390 × 844`

Findings:

1. P1 — The old `1일` tab displayed one-minute Yahoo bars, so its label described a time range rather than the actual candle unit. Replaced it with exact `분·일·주·월·년` units.
2. P1 — Week, month, and year candles now aggregate validated daily OHLCV. Year view uses a separate five-year, display-only Yahoo source and cannot alter the three-month decision-core input.
3. P1 — Added keyboard-operable `확대·축소·전체` controls. Zoom keeps the most recent candles in view, reports the visible candle count, and resets when the unit changes.
4. P2 — Moving-average labels follow the selected unit; unavailable 20-year and 60-year averages are disabled instead of implying a line that cannot be calculated.
5. Responsive check — all five unit tabs and three zoom controls fit at 390 px without horizontal overflow.
6. Browser check — minute, day, week, month, and year views rendered from live public data with no console or page errors.

## Additional light-theme text audit

- Source screenshots:
  - `/Users/kwakhyun/Desktop/스크린샷 2026-07-18 오후 1.36.27.png`
  - `/Users/kwakhyun/Desktop/스크린샷 2026-07-18 오후 1.36.45.png`
  - `/Users/kwakhyun/Desktop/스크린샷 2026-07-18 오후 1.38.54.png`
  - `/Users/kwakhyun/Desktop/스크린샷 2026-07-18 오후 1.39.04.png`
- Scope: guided-agent answers and choices, demo-order conditions and stop copy, evidence labels and values.
- Root cause: retained dark-theme foreground selectors had equal or higher specificity than the light-theme surface rules.
- Implementation: added a final `.trade-demo`-scoped semantic foreground guard without changing layout or behavior.
- Static contrast checks: primary text 11.41:1–14.30:1, secondary text 4.87:1–5.71:1, gold labels 6.13:1 on their actual light surfaces.
- Regression checks: 88 unit tests, typecheck, ESLint, and production build passed.
- Browser capture: blocked by the current local-URL browser policy; a same-state post-fix screenshot is still required for visual comparison.

## Final result

final result: blocked

## Beginner terminology and minute-chart guidance audit

- Captured evidence:
  - `/private/tmp/kpsec-beginner-audit/01-current-main.png` — before terminology cleanup
  - `/private/tmp/kpsec-beginner-audit/06-final-main.png` — final first-screen terminology
  - `/private/tmp/kpsec-beginner-audit/05-minute-guide-visible.png` — validated 1-minute data with the proactive guide visible
- Main terminology changes: `결정 코어` → `계획 계산기`, `실시간 호가` → `지금 시장의 주문 가격과 대기 물량`, `일봉·분봉` → `하루 단위·분 단위 가격`, raw `3mo·1d` → `최근 3개월·하루 간격`, `재검토선·재확인선` → `계획을 다시 확인할 가격`, and `AI 반대 심문` → `AI 다른 관점`.
- Main quote metrics now read `최근 20일 가격 범위`, `가격 흔들림 참고값`, and `평소 대비 최근 거래량`. The exchange code `KSC` is presented as `한국거래소`.
- Proactive-guide rule verified in the deterministic core and production UI: it is available only for `HOLDING_ANXIETY` or `SELL_TIMING` after a valid position plan exists; validated 1-minute or 5-minute data must be selected; and either the planned holding period must extend past days or the decision deadline must be `THIS_WEEK`/`NO_RUSH`.
- The guide does not appear for a daily chart, or for a `DAYS` plan due `NOW`/`TODAY`. If intraday data is unavailable, the minute tab is disabled and no guide is inferred from stale or synthetic data.
- Dismissal behavior: `하루 단위 차트로 넓혀 보기` changes the chart, `원래 계획 다시 보기` scrolls without blocking, and `지금 차트 계속 보기` hides the guide until the chart unit changes again.
- Regression checks: 89 unit tests, typecheck, ESLint, and production build passed. The extra unit case covers the positive and negative guidance conditions.

final result: passed

## Demo-order practice flow audit

- Source screenshots:
  - `/var/folders/p_/l1vl4bpd7n12spj8vcqs3_240000gn/T/TemporaryItems/NSIRD_screencaptureui_wjmK3F/스크린샷 2026-07-18 오후 1.55.06.png`
  - `/var/folders/p_/l1vl4bpd7n12spj8vcqs3_240000gn/T/TemporaryItems/NSIRD_screencaptureui_xU0EmP/스크린샷 2026-07-18 오후 1.55.41.png`
  - `/var/folders/p_/l1vl4bpd7n12spj8vcqs3_240000gn/T/TemporaryItems/NSIRD_screencaptureui_7MYi6V/스크린샷 2026-07-18 오후 1.56.01.png`
- Main issue: the primary CTA did not explain what would be practised, the confirmation step required no user action, and completion discarded the conditions the user needed next. The flow therefore looked like an unfinished fake-order success screen.
- Preview change: an inline explanation now defines the practice as checking plan values, market-data time, and the next/stop conditions. The CTA is named `주문 전 체크리스트 시작하기`.
- Interaction change: the result action stays disabled until the user directly checks quantity/amount, data timing, and the no-real-order boundary. Progress is announced as `n/3 확인 완료`.
- Result change: the result preserves the first allocation, next-allocation recheck, primary stop condition, total amount, and the explicit production integration boundary. It never implies that a mock or real order was filled.
- Keyboard/accessibility: native labelled checkboxes, visible focus rings, disabled-state semantics, dialog focus trap, Escape close, and a route back to the checklist are preserved.
- Regression checks: 88 unit tests, typecheck, ESLint, and production build passed. The updated Chromium assertion covers disabled-before-check, all three checks, the result summary, and the integration boundary, but browser execution was not repeated because local browser capture remains blocked by the current policy.
- Post-fix visual comparison: a same-state screenshot of preview, checklist, and result is still required.

final result: blocked

## Execution-card money hierarchy audit

- Source screenshot: `/var/folders/p_/l1vl4bpd7n12spj8vcqs3_240000gn/T/TemporaryItems/NSIRD_screencaptureui_BbvhsB/스크린샷 2026-07-18 오후 1.52.47.png`
- Main issue: plan quantities were rendered as primary values while total and per-step amounts still used secondary-caption sizing.
- Implementation: total amount now has an explicit `기준금액` label, primary-value size and weight, tabular numerals, and stronger contrast. Per-step amounts are larger and use the same numeric alignment.
- Responsive rule: amount sizes remain at least `1.18rem` for totals and `0.9rem` for step amounts below 640px.
- Regression checks: 88 unit tests, typecheck, ESLint, and production build passed.
- Post-fix browser capture: still required because local-URL browser capture remains blocked.

final result: blocked

## Beginner-language rationale audit

- Source screenshot: `/var/folders/p_/l1vl4bpd7n12spj8vcqs3_240000gn/T/TemporaryItems/NSIRD_screencaptureui_4mMfaT/스크린샷 2026-07-18 오후 1.43.31.png`
- Main issue: the result mixed internal terms (`결정 코어`, `우선 검토안`, `안전하게 확인`) with a long explanation, then used an error message that implied the visible deterministic comparison had disappeared.
- Copy change: the screen now states the user answer first, the displayed method second, and the non-prediction limit last. AI failure copy says that only the easy explanation failed and that the calculated comparison did not change.
- Prompt and Structured Output schema: unchanged.
- Regression checks: 88 unit tests, typecheck, ESLint, and production build passed.
- Post-fix browser capture: still required because local-URL browser capture remains blocked.

final result: blocked
