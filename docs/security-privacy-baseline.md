# Security & Privacy Baseline

적용일: 2026-04-29

## 1) 인증/세션

- JWT 기반 인증 유지
- 로그인 성공/실패 모두 `security_audit_logs`에 기록
- 삭제/비활성 사용자(`is_deleted=true`)는 JWT user lookup 단계에서 차단

## 2) 객체 수준 인가(Object-level Authorization)

백엔드 공통 체크 함수:

- `assertCanAccessPortfolio(userId, portfolioId)`
- `assertCanEditJournalEntry(userId, entryId)`

적용 대상:

- 상품 수정/추가매수/매도/삭제/가격수정/가격이력 조회
- 매매일지 수정/삭제
- 단건 매매일지 감사이력 조회

## 3) 감사 로그

신규 테이블:

- `security_audit_logs`

로그 이벤트 예시:

- `auth_login` (성공/실패)
- `auth_register`
- `authz_denied`
- `privacy_deletion_requested`
- `privacy_deletion_executed`

## 4) 개인정보 페이지 및 삭제 요청

추가 API:

- `GET /api/privacy/policy`
- `GET /api/privacy/contact`
- `GET /api/privacy/deletion-requests` (인증 필요)
- `POST /api/privacy/deletion-requests` (인증 필요)
- `POST /api/privacy/deletion-requests/:id/execute` (인증 필요)

추가 프론트 페이지:

- `/privacy-policy`
- `/contact`
- `/data-deletion`

삭제 정책:

- soft delete: 계정 익명화(`username/email/password` 무력화, `is_deleted=true`)
- hard delete: 사용자 데이터 전체 삭제

## 5) 비밀정보(Secrets) 정책

- OpenAI/DART 키는 서버 환경변수로만 사용
- 브라우저 소스에서는 서버 시크릿 env 이름 참조 금지
- 프론트 테스트(`envLeak.test.js`)로 누출 회귀 방지

## 6) 국외 전송 가능성 고지

외부 서비스 사용 시 국외 전송 가능성이 있으므로 개인정보 처리방침 및 문의처 API에서 명시:

- OpenAI
- Open DART
- Yahoo Finance
- Naver Finance (중계/인프라 경유 가능)
