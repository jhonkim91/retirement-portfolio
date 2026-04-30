# Deep Research Report 3 Tracker

기준 문서: `심층분석/deep-research-report_3.md`  
최종 점검일: `2026-04-30`

## 1) 반영 분류 (정밀 분석)

| 항목 | 분류 | 현재 상태 요약 | 근거 |
|---|---|---|---|
| 랜딩/브랜딩/메타데이터 정비 | Done | 로그인 전 랜딩 + 페이지 메타 라우팅 적용 | `frontend/src/App.js`, `frontend/src/pages/Landing.jsx` |
| 연금 적격성 계층 | Done | 계좌 카테고리별 적격성 판정/배지 반영 | `frontend/src/lib/pensionEligibility.js`, `Portfolio.jsx`, `Dashboard.jsx`, `StockResearchPanel.jsx` |
| 데이터 출처/신선도 배지 | Done | source/asOf/freshness 경고 표시 | `frontend/src/lib/sourceRegistry.js`, `frontend/src/components/DataBadge.jsx` |
| 감사 이력 append-only + export | Done | diff/복원 초안/복원 적용/체인 상태 필터 및 경고 UI 반영 | `backend/routes.py` (`/trade-logs/audit*`), `frontend/src/pages/TradeLog.jsx` |
| import/reconciliation 도메인 분리 | Done | preview/commit/dry-run/드릴다운/시그니처 검증까지 반영 | `backend/models.py`, `backend/routes.py` (`/import-batches`, `/trade-logs/reconciliation*`) |
| Analytics v2 심화(TWR/MWR/기여도/drawdown 등) | Mostly Done | 핵심 지표/차트/waterfall/benchmark 연동 반영, 운용형 해설 패널 고도화 여지 | `frontend/src/lib/analytics/*`, `frontend/src/components/analytics/AnalyticsDashboard.jsx` |
| 스크리너 compare/saved screens | Done | 비교 화면/저장 화면/불러오기/관심종목 반영 | `frontend/src/pages/StockScreener.jsx`, `backend/routes.py`, `backend/models.py` |
| 스크리너→리서치→분석 연결 | Done | 포트폴리오/저널 prefill draft 브리지까지 반영 | `frontend/src/pages/StockScreener.jsx`, `frontend/src/pages/TradeLog.jsx`, `StockResearchPanel.jsx` |
| 공통 App Shell + 모바일 마감 | Partial | 공통 네비/레이아웃, 모바일 카드/토큰 1차 완료. 남은 범위는 visual QA와 잔여 테이블/키보드 흐름 점검 | `frontend/src/App.js`, `frontend/src/components/Navigation.jsx`, page CSS |
| 운영 검증 자동화 (실서비스 로그인+데이터 로드) | In Progress | 실서비스 smoke 테스트/워크플로우 추가, 운영 시크릿 설정 후 활성화 단계 | `tests/e2e/prod-smoke.spec.ts`, `.github/workflows/prod-smoke.yml` |
| 운영 배포 정합성 | Needs Deployment | 로컬 최신 코드에는 `/api/screener/watch-items`가 있으나 문서상 운영 Railway 백엔드는 구버전 404 확인. 백엔드 재배포 후 재검증 필요 | `backend/routes.py`, `docs/report-checklist.md` |

## 2) 이번 라운드 반영

- [x] `deep-research-report_3.md` 기준 분류표 작성
- [x] 다음 대화 연속 진행용 트래커 문서 생성
- [x] 실서비스 로그인/데이터 로드 smoke test 골격 추가 (`tests/e2e/prod-smoke.spec.ts`)
- [x] prod smoke 전용 playwright 설정/스크립트 추가
- [x] Import Center 백엔드 API 1차 구현 (`/api/imports/preview`, `/api/imports/commit`, `/api/reconciliation/latest`)
- [x] Import Center 프런트 페이지/네비 진입 추가 (`/imports`)
- [x] Import Center 기본 플로우 테스트 추가 (`backend/tests/test_import_center.py`)
- [x] Batch notes/commit_errors 시각화 (`ImportCenter` 커밋 결과 + Batch 상세 패널)
- [x] 충돌 자동매핑 힌트 강화 (`mapping_hint`, `conflict_with_logs`)
- [x] 충돌 행 선택 커밋 및 추천 매핑 반영 (`conflict_row_indexes`, `row_mapping_overrides`)
- [x] 충돌 행 수동 매핑 드롭다운(기존 상품 선택) UI 추가
- [x] 충돌 선택/매핑 변경 시 커밋 예상 결과 실시간 재계산 패널 추가
- [x] 서버 dry-run API(`/api/imports/dry-run`) 연동으로 예상치 서버 검증 반영
- [x] dry-run 결과 항목 클릭 시 충돌 행 점프/하이라이트, 충돌 행에서 예상 결과 역이동 UX 추가
- [x] dry-run 시그니처 기반 commit 불일치 차단(409) 및 프런트 재확인 유도 추가

## 3) 다음 우선순위 (실제 구현)

### P0
- [x] Import Center 사용자 플로우 완성
  - [x] `POST /api/imports/preview`
  - [x] `POST /api/imports/commit`
  - [x] `GET /api/reconciliation/latest`
  - [x] `POST /api/imports/dry-run`
  - [x] `frontend/src/pages/ImportCenter.jsx`
  - [x] 네비게이션 진입 버튼
  - [x] CSV 템플릿 다운로드/예시 내장
  - [x] conflict 행 상세 해소 가이드 UI
  - [x] commit 후 diff/reconciliation drill-down
  - [x] dry-run projection signature 기반 stale commit 차단

### P1
- [x] Audit timeline 고도화
  - [x] 이벤트별 before/after diff
  - [x] 삭제 이벤트 복원 초안 append
  - [x] hash 체인 가시성 개선

### P1
- [x] 스크리너 -> 포트폴리오 입력 초안 브리지
  - [x] 후보 종목에서 포트폴리오 입력 사전 채움
  - [x] 연금계좌 컨텍스트에서 적격성 강조 배지 유지

### P2
- [x] 모바일 마감 1차
  - [x] Dashboard/Portfolio/TradeLog 주요 테이블 카드형 전환
  - [x] spacing/heading/radius 토큰 일관화
- [ ] 모바일/데스크톱 visual QA 및 잔여 테이블/키보드 흐름 점검

## 4) 이어서 진행할 때 바로 쓰는 체크포인트

1. GitHub Actions secrets(`E2E_PROD_BASE_URL`, `E2E_PROD_USERNAME`, `E2E_PROD_PASSWORD`) 설정 후 `npm run test:e2e:prod` 또는 `Prod Smoke` 워크플로우로 운영 로그인/핵심 카드 노출 확인  
2. Railway 백엔드를 최신 `codex-handoff` 기준으로 재배포하고 `/api/version`, `/api/screener/watch-items`를 재검증  
3. 남은 부분 완료 항목을 접근성 키보드 흐름, 에러/빈 상태 규격, BFF retry/metrics 순서로 보강

## 5) 참고 실행 명령

```bash
# PowerShell
$env:E2E_PROD_BASE_URL="https://retirement-portfolio-omega.vercel.app"
$env:E2E_PROD_USERNAME="김정규"
$env:E2E_PROD_PASSWORD="***"
npm run test:e2e:prod
```

## 6) 최신 반영 로그 (2026-04-30)

- Import Center 10차
  - dry-run 상태 배지 추가: `최신 dry-run` / `재확인 필요` / `계산 중`
  - dry-run 기준시각(`calculated_at`) UI 표시
  - stale 응답(`DRY_RUN_STALE`)에서 최신 projection 시그니처/시각 즉시 반영
  - dry-run 계산 중/시그니처 미존재 상태에서는 커밋 버튼 비활성화

- Audit Timeline 1차
  - 감사 이력 `diff 보기`(before/after 비교) UI 추가
  - `restore-draft` API 추가 및 `trade_restore_draft` append-only 이벤트 기록
  - 복원 가능한 이력은 수정폼 자동 주입, 삭제 이력은 수동 복원 초안 안내

- Audit Timeline 2차
  - `restore-apply` API 추가로 복원 초안의 실제 반영 자동화
  - 기존 로그는 업데이트, 삭제 로그는 신규 생성 방식으로 복원
  - 복원 반영 결과를 감사 체인/스냅샷/정합성 결과에 함께 기록

- Audit Timeline 3차
  - 감사 이력 이벤트 필터(생성/수정/삭제/복원초안) + 체인 상태 필터 추가
  - 해시 체인 상태 배지 및 prev_hash 불일치 경고 노출
  - 복원 적용 전 확인 모달 추가

- Screener Bridge 1차
  - 스크리너 후보를 포트폴리오 입력 초안으로 즉시 전달하는 동선 추가
  - 포트폴리오 진입 시 초안 자동 채움(상품명/코드/현재가 기반 매입가/기본 수량)

- Screener Bridge 2차
  - 초안 적용 타이밍을 계좌 타입 로드 이후로 보정
  - 증권/퇴직 계좌별 단위·자산구분·수량 보정 규칙 적용

- Screener Bridge 3차
  - `StockScreener -> TradeLog` 연결용 저널 prefill draft(`journal_prefill_draft_v1`) 전달
  - TradeLog 진입 시 종목코드/종목명 자동 매칭 후 가장 최근 매수 거래에 우선 연결
  - 기존 저널이 있으면 기존 내용을 열고, 없으면 스크리너 초안으로 자동 채움
  - 매칭 실패 시 사용자 거래 선택 시점에 자동 채움되는 안내 메시지 추가

- Mobile Polish 1차
  - TradeLog 모바일 전용 카드 레이아웃 복구 및 액션(수정/저널/삭제) 동선 반영
  - Dashboard/Portfolio/TradeLog 모바일 패딩/헤딩/터치 타깃 간격 1차 정렬
  - Portfolio 차트 영역 모바일 최소폭 하향으로 과도한 가로 스크롤 완화

- Mobile Polish 2차
  - 공통 UI 토큰(`radius/spacing/heading/touch target`)을 `frontend/src/App.css`에 통합
  - Dashboard/Portfolio/TradeLog/StockScreener 패널/버튼에 토큰 적용해 간격·라운드·터치영역 일관화
  - 페이지 헤딩(`TradeLog`, `Portfolio`, `StockScreener`)에 모바일 축소 폰트 기준 동기화

- 운영 검증 자동화 1차
  - `npm run test:e2e:prod` 로컬 실행 확인(환경변수 미설정으로 skip 동작 확인)
  - GitHub Actions `Prod Smoke` 워크플로우 추가 (`workflow_dispatch` + 스케줄)
  - 시크릿 미설정 시 안전하게 skip, 설정 시 Playwright smoke와 아티팩트 업로드 실행
