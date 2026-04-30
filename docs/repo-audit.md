# 저장소 진단 리포트 (repo audit)

기준 시각: 2026-04-29  
범위: 저장소 정적 스캔(코드/설정 파일 기준), 실행 환경 실측은 제외

## 1) 기술 스택

### 확인 가능
- Frontend
  - React 19 (`react`, `react-dom`)
  - 라우팅: `react-router-dom`
  - 차트: `recharts`
  - 빌드/테스트: CRA(`react-scripts`), Jest + Testing Library
  - HTTP: `fetch` 기반 공통 API 래퍼(`frontend/src/utils/api.js`), `axios`는 의존성만 있고 사용 흔적 거의 없음
- Backend
  - Flask + Flask-SQLAlchemy + Flask-JWT-Extended + Flask-CORS
  - 배치/스케줄: APScheduler
  - WSGI: gunicorn
  - 데이터 수집: `requests`, `beautifulsoup4`, `yfinance`, Open DART API 연동
  - 리포트 생성: `reportlab`(PDF), 프론트는 HTML export
- DB
  - 기본 SQLite (`sqlite:///retirement.db`)
  - 배포 환경은 `DATABASE_URL`로 Postgres 사용 가능 (`psycopg2-binary`)

### 확인 불가
- 실제 운영에서 SQLite vs Postgres 중 무엇이 사용 중인지
- 운영 환경의 파이썬/노드 런타임 버전 고정 여부

## 2) 라우팅 구조

### 확인 가능
- Frontend 라우트 (`frontend/src/App.js`)
  - `/` (로그인 시 Dashboard, 비로그인 시 Landing)
  - `/login`
  - `/dashboard`
  - `/portfolio`
  - `/trade-logs`
  - `/stock-research`
  - `/stock-screener`
- Backend API (`backend/routes.py`, Blueprint prefix `/api`)
  - 총 `45`개 route 데코레이터 확인
  - 도메인: auth, accounts, portfolio summary/dashboard/trends, products CRUD/quote/analysis/dart, cash, trade logs/audit/reconciliation, screener/compare/saved screens, import/snapshot

### 확인 불가
- 프론트 네비게이션에서 role/권한별 라우트 제어 정책(코드상 단순 로그인 여부 기준만 확인됨)

## 3) 상태관리

### 확인 가능
- 전역 상태 라이브러리(Redux/Zustand/Recoil 등) 없음
- 페이지/컴포넌트 단위 `useState/useEffect/useMemo/useCallback` 중심 로컬 상태관리
- 인증 상태: `localStorage(access_token, user)` + App 최상단에서 가드
- 계좌 선택 상태: 사용자 스코프 키(`selected_account_name:{user}`)로 localStorage 저장

### 확인 불가
- 탭 간 동시 수정/레이스 상황에서 상태 정합성 SLA

## 4) API 호출 계층

### 확인 가능
- 공통 호출기: `apiCall()` (`frontend/src/utils/api.js`)
  - Authorization Bearer 자동 부착
  - 401 시 토큰/유저/선택계좌 정리 후 `/login` 리다이렉트
  - JSON 에러 메시지 통일 처리
- 도메인별 래퍼 분리: `authAPI`, `portfolioAPI`, `tradeLogAPI`, `screenerAPI`
- 파일 다운로드 전용 경로 별도 처리(`downloadApiFile`)

### 확인 불가
- API 재시도/서킷브레이커/timeout 정책(클라이언트 레벨)
- 백엔드 endpoint별 p95/p99 성능 지표

## 5) 데이터 소스

### 확인 가능
- 내부 소스
  - RDB 테이블: users, account_profiles, products, cash_balances, price_histories, trade_logs, trade_events, import_batches, trade_snapshots, reconciliation_results, screener_screens
- 외부 소스
  - Naver Finance (시세/차트/검색)
  - Yahoo Finance (`yfinance`)
  - FunETF (펀드/ETF 데이터)
  - Open DART (corp code, company, financials, disclosures)
- 백엔드 메모리 캐시
  - DART/뉴스/네이버 마켓 스냅샷에 TTL 캐시 구현

### 확인 불가
- 외부 API 호출 제한/차단 시 fallback 성공률
- 데이터 수집 실패율 및 알림 체계

## 6) 테스트

### 확인 가능
- Frontend 테스트 존재
  - analytics engine/transformer/exporter 유닛 + snapshot
  - `AnalyticsDashboard` 렌더 테스트 + snapshot
  - `pensionEligibility`, `sourceRegistry` 테스트
- `npm test` 스크립트 존재

### 확인 불가
- Backend 자동 테스트(Pytest/unittest) 없음 확인
- E2E 테스트(Cypress/Playwright) 구성 없음 확인
- CI 상 테스트 강제 여부(워크플로 파일 미확인)

## 7) 린트

### 확인 가능
- CRA 기본 ESLint 설정(`react-app`, `react-app/jest`)
- 일부 파일에서 eslint-disable 주석 사용 흔적

### 확인 불가
- 별도 Prettier/Black/Ruff/mypy 규칙 파일 미확인
- pre-commit hook/품질 게이트 여부

## 8) 빌드

### 확인 가능
- 루트 `package.json`
  - `build`: `cd frontend && npm install && npm run build`
  - `postinstall`: 동일 명령
- 프론트 `build`: `react-scripts build`
- 백엔드 런타임은 gunicorn 실행

### 확인 불가
- 멀티스테이지 빌드/아티팩트 캐시 최적화 수준

## 9) 배포

### 확인 가능
- Vercel 설정(`vercel.json`, `frontend/vercel.json`)
  - static build + SPA rewrite(`/index.html`)
  - 보안 헤더(CSP, XFO, XCTO, Referrer-Policy, HSTS 등)
- Railway 설정(`railway.json`, `backend/railway.json`)
  - NIXPACKS
  - start command: gunicorn으로 Flask 앱 실행
- 백엔드 CORS는 `/api/*`에 대해 `origins: *`

### 확인 불가
- 실제 운영 배포 토폴로지(프론트/백 분리 도메인, 프록시 구성)
- 운영 환경변수 세트(JWT_SECRET_KEY, OPENDART_API_KEY, REACT_APP_API_URL 등) 유효성

## 10) 개선 우선순위 제안 (Top 10)

1. **백엔드 테스트 체계 도입 (최우선)**: `routes.py`, `ledger/정합성`, `auth`를 pytest로 커버하고 CI에서 강제.
2. **`backend/routes.py` 모듈 분할**: 도메인별 Blueprint 분리(auth/portfolio/trade/screener/report)로 유지보수성 개선.
3. **인코딩/문자열 깨짐 정리**: 한글 깨짐 문자열(라벨/메시지) UTF-8 통일 및 i18n 준비.
4. **API 성능 개선**: 대시보드 초기 로딩 endpoint 통합(이미 일부 진행됨) + 지연 소스별 타이밍 로깅 추가.
5. **데이터 수집 내구성 강화**: 외부 소스 실패 시 source별 fallback 상태를 응답에 명시하고 사용자 경고 표준화.
6. **CORS/보안 재검토**: 운영에서는 `origins: *` 축소, JWT secret 강제, rate limiting/WAF 연동.
7. **스키마 마이그레이션 표준화**: 런타임 ALTER 대신 Alembic 도입(재현 가능한 버전 관리).
8. **프론트 상태관리 정리**: 페이지별 거대 상태를 custom hooks로 분해(`usePortfolioData`, `useDashboardAnalytics` 등).
9. **배포 파이프라인 명시화**: GitHub Actions(테스트→빌드→배포) 및 환경별 검증 체크리스트 문서화.
10. **관측성 도입**: 백엔드 구조화 로그 + 에러 추적(Sentry 등) + 핵심 KPI(가격동기화 성공률, API 지연) 대시보드화.

## 11) 참고 파일

- Frontend 엔트리/라우팅: `frontend/src/App.js`, `frontend/src/App.jsx`
- API 계층: `frontend/src/utils/api.js`
- 분석 엔진: `frontend/src/lib/analytics/*`
- Backend 앱/모델/라우트: `backend/app.py`, `backend/models.py`, `backend/routes.py`
- 외부 데이터 연동: `backend/api_client.py`, `backend/scheduler.py`
- 배포 설정: `vercel.json`, `frontend/vercel.json`, `railway.json`, `backend/railway.json`

## 12) Commit message 후보 (3개)

1. `docs: add full repository audit for stack, architecture, api, tests, and deployment`
2. `docs(audit): map frontend/backend routing and identify verification gaps with top-10 priorities`
3. `chore(docs): add repo-audit report with confirmed vs unconfirmed findings and improvement roadmap`
