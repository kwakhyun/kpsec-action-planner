# Action Planner 품질 검증 기준

> 기준일: 2026-08-30
> 상태: 현재 저장소 코드와 문서를 같은 작업 트리에서 검증

이 문서는 현재 제품 표면의 품질 기준과 재현 가능한 검증 결과만 기록합니다. 과거 임시 스크린샷 경로와 변경 전 테스트 수치는 현행 인증 근거에서 제외합니다.

## 현재 인증 결과

| 검증 항목 | 명령 또는 근거 | 결과 |
| --- | --- | --- |
| 단위 테스트 | `npm test` | 78개 통과 |
| TypeScript | `npm run typecheck` | 통과 |
| ESLint | `npm run lint` | 통과 |
| 프로덕션 빌드 | `npm run build` | 통과 |
| Chromium E2E | `npm run test:e2e` | 3개 통과 |

현재 로컬 품질 인증 결과는 통과입니다.

## E2E 검증 범위

[`e2e/action-planner.spec.ts`](./e2e/action-planner.spec.ts)는 다음 수직 흐름을 검증합니다.

1. 매수 전 고민 입력, 실행안 비교, AI 반대 의견, 결정 코어 재계산, 주문 전 체크리스트
2. 보유 후 시간축 가이드의 세 선택, 주문 sidecar 일치, 매도 계획 정상 경로, 390px 화면의 가로 넘침 방지
3. 1분 데이터가 부족할 때 5분 데이터로 대체하고, 두 데이터가 모두 부족하면 분 단위 차트를 비활성화하는 흐름

브라우저 검증은 1440px 데스크톱과 390px 모바일 뷰포트를 포함합니다. 실행안 제목, 수량, 금액, 위험 문구의 실제 계산 색상도 현재 프로덕션 토큰과 일치하는지 확인합니다.

## 제품 계약

### 결정과 설명의 분리

- 고정 가이드 질문과 단계 이동은 클라이언트 제품 코드가 관리합니다.
- 가격, 수량, 회차별 금액, 평가손익, 재확인 가격과 중단 조건은 결정론적 계획 계산기가 만듭니다.
- OpenAI는 검증된 입력과 계획을 쉬운 말로 설명하고, 사실 범위 안에서 반대 의견과 후속 확인 질문을 만듭니다.
- AI 응답이 실패하거나 의미 검증을 통과하지 못하면 AI 결과만 표시하지 않습니다. 계산된 비교안은 유지합니다.

### 시장 데이터 경계

- 최근 3개월 일 단위 데이터만 실행안 계산에 사용합니다.
- 1분 데이터와 5분 대체 데이터는 분 단위 차트와 시간축 가이드에만 사용합니다.
- 장기 데이터와 일 단위 데이터를 묶은 주, 월, 년 차트는 표시 전용입니다.
- 공급자 실패, 오래된 데이터, 데이터 부족은 이전 성공값이나 합성 데이터로 대체하지 않습니다.

### 주문 경계

- 주문 전 체크리스트는 선택한 계획, 데이터 시각, 실제 주문이 아님을 다시 확인하는 연습입니다.
- 계좌 연결, 주문 전송, 체결 시뮬레이션, 예상 슬리피지와 체결 확률은 구현하지 않습니다.

## 코드 책임 기준

| 영역 | 책임 파일 |
| --- | --- |
| 화면 상태 조정 | [`src/components/security-trading-demo.tsx`](./src/components/security-trading-demo.tsx) |
| 전체 화면 조합 | [`src/components/security-trading-demo-view.tsx`](./src/components/security-trading-demo-view.tsx) |
| 고민 선택과 입력 흐름 | [`src/components/security-decision-workspace.tsx`](./src/components/security-decision-workspace.tsx) |
| 차트 데이터와 표시 상태 | [`src/components/security-candlestick-chart.tsx`](./src/components/security-candlestick-chart.tsx) |
| 일 단위 데이터 검증과 계산 | [`src/lib/market-data.ts`](./src/lib/market-data.ts) |
| 분 단위와 장기 데이터 조회 | [`src/server/market/intraday-market-provider.ts`](./src/server/market/intraday-market-provider.ts), [`src/server/market/chart-history-provider.ts`](./src/server/market/chart-history-provider.ts) |
| 매수 실행안 계산 | [`src/lib/execution-core.ts`](./src/lib/execution-core.ts) |
| 보유 후와 매도 계획 계산 | [`src/lib/trade-coach-core.ts`](./src/lib/trade-coach-core.ts) |
| AI 설명 경계 | [`src/app/api/decision/route.ts`](./src/app/api/decision/route.ts) |
| AI 반대 의견 경계 | [`src/app/api/adversarial-review/route.ts`](./src/app/api/adversarial-review/route.ts) |
| 주문 연습 계약 | [`src/lib/demo-order-sidecar.ts`](./src/lib/demo-order-sidecar.ts) |

## 증빙 관리 원칙

- 현재 인증 수치에는 실행한 명령의 실제 결과만 기록합니다.
- 영구 증빙은 저장소 상대 경로나 Git 커밋으로 추적할 수 있어야 합니다.
- `/private/tmp`, `/var/folders`, Desktop 같은 장비별 절대 경로는 문서 근거로 사용하지 않습니다.
- Playwright의 `test-results`는 실패 분석용 임시 산출물이며 저장소 문서 근거로 간주하지 않습니다.
- UI 또는 테스트 계약이 바뀌면 관련 E2E를 다시 실행한 뒤 이 문서와 README를 함께 갱신합니다.

## 검증 한계

- E2E는 외부 요청을 테스트 응답으로 대체하므로 Yahoo Finance와 OpenAI의 현재 가용성을 인증하지 않습니다.
- OpenAI LIVE smoke는 비용과 외부 호출을 동반하므로 일반 검증에 포함하지 않습니다.
- 로컬 빌드와 E2E 통과는 공개 배포가 최신 커밋인지 보장하지 않습니다. 배포 검증은 배포 작업에서 별도로 확인합니다.
- 이 검증은 투자 성과, 금융 규제 적합성, 실제 사용자 효용을 입증하지 않습니다.

## 변경 기록

- 2026-08-29: Planning Studio 중심의 전체 화면 디자인을 적용했습니다.
- 2026-08-30: 리팩터링된 책임 구조에 맞춰 문서를 갱신하고, 현재 UI 기준으로 E2E 선택자와 보유 후 시간축 가이드 렌더링을 정렬했습니다.
