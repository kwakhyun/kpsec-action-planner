# 보안과 운영 경계

Action Planner는 공개 포트폴리오 데모입니다. 계정, 잔고, 실제 주문 정보를 저장하지 않지만 시장 데이터 공급자와 OpenAI를 호출하므로 요청 검증, 비용 통제, 의존성 관리가 필요합니다.

## 공개 API 경계

비용이 발생할 수 있는 공개 POST 엔드포인트는 다음 두 개입니다.

- `/api/decision`: 검증된 시장 데이터와 결정론적 실행안에 대한 AI 설명
- `/api/adversarial-review`: 현재 계획에 대한 AI 반대 의견

두 엔드포인트는 공통 요청 경계인 [`src/server/public-api-request.ts`](./src/server/public-api-request.ts)를 통과합니다.

- 교차 출처 브라우저 요청 거부
- `application/json`만 허용
- 선언된 크기와 실제 스트림 크기를 모두 32KiB로 제한
- 잘못된 JSON을 모델 또는 데이터 공급자 호출 전에 거부
- 이후 도메인별 Zod 스키마로 입력 구조와 길이를 다시 검증

API 오류 응답은 캐시하지 않습니다. 전역 HTTP 헤더는 MIME 스니핑과 프레임 삽입을 막고, 리퍼러와 브라우저 권한을 제한합니다.

## Vercel Firewall 운영 기준

애플리케이션 요청 검증은 분산 호출량 제한을 대신하지 않습니다. 프로덕션에서는 다음 조건의 Vercel Firewall 규칙을 별도로 유지합니다.

| 항목 | 값 |
| --- | --- |
| 대상 경로 | `/api/decision`, `/api/adversarial-review` |
| 메서드 | `POST` |
| 집계 키 | IP |
| 초기 기준 | 60초당 30회 |
| 배포 순서 | 관찰 로그, 트래픽 검토, 미리보기 제한, 프로덕션 제한 |

Firewall은 저장소 밖의 운영 설정입니다. 배포 전 `vercel firewall rules list --expand`와 `vercel firewall diff`로 게시 상태와 초안 유무를 확인합니다. 새 제한은 정상 사용자를 차단하지 않는지 관찰한 뒤 단계적으로 강화합니다.

## 의존성과 배포 게이트

- `npm audit --audit-level=high`가 High 이상을 보고하면 품질 게이트가 실패합니다.
- Dependabot이 npm 의존성을 매주 확인합니다.
- GitHub Actions는 단위 테스트, TypeScript, ESLint, 프로덕션 빌드, Chromium E2E를 같은 잠금 파일로 실행합니다.
- Vercel 자동 프로덕션 승격을 막으려면 프로젝트의 Deployment Checks에서 `Unit, static, build, and browser checks`를 필수 체크로 선택합니다.

API 키와 Vercel 토큰은 서버 또는 CI 비밀값으로만 관리하며 저장소에 커밋하지 않습니다.

## 범위 밖 항목

현재 서비스는 로그인과 사용자별 영구 쿼터를 제공하지 않습니다. 계정 기능이나 개인 데이터를 추가할 때는 사용자 인증, 권한 검사, 감사 로그, 저장 데이터 암호화와 삭제 정책을 별도 설계해야 합니다.
