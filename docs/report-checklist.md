# 심층 평가 보고서 점검판

기준 문서: `퇴직연금 포트폴리오 웹앱 심층 평가 보고서.pdf`

마지막 업데이트: `2026-04-30`

## 사용 원칙

1. 새 작업을 시작하기 전에 이 문서에서 관련 항목 상태를 먼저 확인합니다.
2. 이번 턴에서 다룰 범위는 아래 `이번 작업 체크리스트`에 추가하고 진행 중 상태로 바꿉니다.
3. 작업이 끝나면 `상태`, `근거 파일`, `검증 결과`를 함께 남깁니다.

상태 표기:
- `완료`
- `부분 완료`
- `미완료`
- `확인 필요`
- `진행 중`

## 핵심 권고사항 현황

| 영역 | 상태 | 메모 |
|---|---|---|
| 랜딩/앱 명/메타데이터/ko-KR | 완료 | 랜딩/타이틀/설명/OG/Twitter/`noscript` 반영 |
| 연금 계좌 유형 분리(IRP/DC/연금저축/일반과세) | 부분 완료 | 계좌 카테고리와 연금 적격성 엔진은 있음, 세부 정책 표시는 추가 점검 필요 |
| 연금 적격성 규칙/위험자산 70% 가이드 | 완료 | 적격성 엔진과 가이드 표시 반영 |
| 데이터 출처/신선도/source badge | 완료 | source registry / freshness badge 반영 |
| 가격/공시 소스 혼합 경고 | 부분 완료 | source/freshness 표시는 구현됨, 화면 전반 일관성과 fallback/충돌 설명은 추가 점검 필요 |
| Open DART 실연동 | 완료 | 회사정보/공시/재무요약 연동, API 키 필요 |
| 포트폴리오 분석 엔진(TWR/IRR/CAGR/MDD 등) | 완료 | `frontend/src/lib/analytics/*` 구현 |
| 차트 계층(crosshair, brush, log/linear, benchmark overlay) | 완료 | 분석 대시보드 반영 |
| 리밸런싱 전후 성과 패널 | 완료 | 분석 대시보드 반영 |
| 일반계좌/연금계좌 분석 템플릿 분리 | 완료 | 계좌 유형별 분석 섹션 분리 반영 |
| 감사이력 append-only / 해시체인 | 완료 | `trade_events` 및 export 반영 |
| import_batches / reconciliation_results / trade_snapshots | 완료 | 분리 저장소 및 조회 API 반영 |
| 스크리너 compare view | 완료 | 비교 카드/공시 연계 반영 |
| saved screens 서버 저장 | 완료 | `screener_screens` 반영 |
| benchmark 직접 선택 | 완료 | 분석 엔진에 선택/저장 흐름 반영 |
| 스크리너 후보 -> 분석 엔진 연결 | 완료 | 스크리너에서 분석 엔진 이동 반영 |
| 계좌별 분석 리포트 export | 완료 | HTML export 반영 |
| 보안 헤더(CSP/HSTS/XFO/XCTO/Referrer-Policy) | 완료 | 백엔드/프론트 설정 반영 |
| 접근성(skip link/landmark/KWCAG AA) | 부분 완료 | landing/app skip link 반영, 나머지 landmark/aria/키보드 흐름 점검 필요 |
| 에러/빈 상태 UX | 부분 완료 | 주요 화면은 있음, 전 구간 통일 점검 필요 |
| QA/스냅샷/단위 테스트 | 부분 완료 | 분석 엔진/대시보드 중심 반영, 전체 회귀 범위는 추가 여지 있음 |
| BFF/캐시/복구 정책 문서화 | 부분 완료 | 정책 문서와 재시도/backoff 표 추가, 운영 지표 구현은 후속 보강 필요 |
| 운영 smoke 자동화 | 진행 중 | Playwright prod smoke와 GitHub Actions 워크플로우는 있음, 운영 secrets 설정 후 실제 로그인 검증 필요 |
| 프론트/백엔드 배포 버전 정합성 | 확인 필요 | 로컬 최신 코드에는 `/api/screener/watch-items`가 있으나 운영 Railway 백엔드는 구버전 404 기록. 백엔드 재배포 후 재검증 필요 |

## 이번 작업 체크리스트

- [x] 운영 장애 원인 확인
- [x] 런타임 로그 근거 확보
- [x] 백엔드 부팅 오류 수정 배포
- [x] 운영 접속 재확인
- [x] 문서 기준 점검판 추가
- [x] 포트폴리오 도메인 모델(account wrappers/lots/cash flows/snapshots/benchmarks) 정규화
- [x] 계좌별/전체 포트폴리오 토글 및 공통 분석엔진 연결
- [x] 보고서 기반 업데이트 목록 재대조
- [x] Import Center/모바일 마감 stale 체크박스 동기화
- [x] 운영 smoke/배포 정합성 후속 액션 명시

## 이번 작업 메모

- `2026-04-28`: Railway 백엔드 부팅 실패 원인 확인
  - 증상: 사이트 진입 불가
  - 근거: `sqlalchemy.exc.AmbiguousForeignKeysError`
  - 위치: `User.trade_events` 관계가 `TradeEvent.user_id`, `TradeEvent.created_by` 두 FK를 구분하지 못함
  - 조치: `backend/models.py` 관계에 `foreign_keys` 명시
- `2026-04-28`: 운영 복구 확인
  - Railway deployment: `3ceb969c-1de9-4bb5-a817-a25244a1f366`
  - 상태: `SUCCESS`
  - 헬스 체크: `https://backend-production-2516.up.railway.app/api/version` -> `200`
- `2026-04-28`: 현황 첫 로딩 경량화
  - 핵심 카드용 `/api/portfolio/dashboard` 추가
  - 무거운 분석 데이터(`all-products`, `trends`, `trade-logs`)는 백그라운드 로드로 분리
  - `trade-logs`, `all-products` 조회 시 불필요한 장중 시세 동기화 제거
- `2026-04-28`: 접근성 기본 개선
  - 앱 공통 `skip link` 추가

## 다음 작업 후보

1. 접근성 점검: skip link, landmark, aria, 키보드 흐름
2. source/freshness 표시 전 화면 일관화
3. 에러/빈 상태 메시지 규격 통일
4. BFF/캐시/복구 정책 정리


- `2026-04-29`: 출처/상태 메시지 1차 정리
  - `StockResearchPanel`에 데이터 출처와 신선도 안내 보강
  - `TradeLog` 오류/성공 메시지 구조 정리
  - 주요 화면에 source badge 노출 범위 확대
  - 로딩/빈 상태/오류 메시지에 `status`/`alert` 계열 안내 추가

- `2026-04-30`: 보고서 기반 업데이트 목록 재점검
  - `docs/deep-research-report-3-tracker.md`의 P0 Import Center 상위 체크박스를 실제 완료 상태로 동기화
  - 모바일 마감은 1차 완료로 정리하고 visual QA/잔여 테이블/키보드 흐름을 후속 항목으로 분리
  - 운영 smoke 자동화는 코드 반영 완료, GitHub secrets 설정 및 실제 운영 로그인 검증은 남은 상태로 명시
  - 배포 백엔드 구버전 이슈(`/api/screener/watch-items` 운영 404 기록)는 Railway 최신 재배포 후 재검증 대상으로 유지

## deep-research-report_3 진행 추적 (2026-04-30)

- 상세 분류 문서: `docs/deep-research-report-3-tracker.md`
- 이번 라운드 반영:
  - 운영 로그인/데이터 노출 검증용 Playwright smoke test 추가
    - `tests/e2e/prod-smoke.spec.ts`
    - `tests/playwright.prod.config.ts`
    - `npm run test:e2e:prod`
  - deep-research-report_3 기준 반영/미반영/부분반영 분류표 작성
- 다음 우선순위:
  1. Import Center preview/commit 플로우 구현
  2. Audit timeline diff/복원 UX 추가
  3. 스크리너 -> 포트폴리오 입력 초안 브리지

- `2026-04-30`: Import Center 1차 반영
  - 백엔드: `/api/imports/preview`, `/api/imports/commit`, `/api/reconciliation/latest` 추가
  - 프런트: `/imports` 페이지 및 네비게이션 진입 추가
  - 테스트: `backend/tests/test_import_center.py` 추가

- `2026-04-30`: Import Center 2차 반영
  - CSV 템플릿 다운로드: `/api/imports/template` + UI 버튼 추가
  - 미리보기 충돌 행 상세 가이드 패널 추가
  - 정합성 결과 Drill-down(최근 결과 목록 + 상세 mismatch) UI 추가
  - 테스트: 템플릿 다운로드 테스트 케이스 추가

- `2026-04-30`: Import Center 3차 반영
  - batch notes 기반 커밋 결과/오류 시각화 패널 추가
  - 충돌 행에 기존 로그 요약(`conflict_with_logs`) 및 매핑 힌트(`mapping_hint`) 추가
  - 테스트: 충돌 미리보기 메타데이터 검증 케이스 추가

- `2026-04-30`: Import Center 4차 반영
  - 충돌 행별 선택 커밋(선택 행만 반영) 지원
  - 추천 매핑 product_id를 커밋 payload에 반영하여 적용
  - 테스트: 충돌 미선택/선택 커밋 동작 검증 케이스 추가

- `2026-04-30`: Import Center 5차 반영
  - 충돌 행별 수동 매핑 드롭다운(기존 상품 선택) 추가
  - 수동 매핑 선택 시 해당 충돌 행 커밋 대상 자동 선택
  - 테스트: `row_mapping_overrides` 커밋 payload 반영 케이스 강화

- `2026-04-30`: Import Center 6차 반영
  - 충돌 행 선택/매핑 변경 시 커밋 예상 결과(반영/건너뜀/충돌 매핑 수) 실시간 재계산 패널 추가

- `2026-04-30`: Import Center 7차 반영
  - 서버 dry-run API(`/api/imports/dry-run`) 추가 및 프런트 연동
  - 커밋 예상 결과를 클라이언트 계산이 아닌 서버 계산 기준으로 표시
  - 테스트: dry-run 결과(선택 충돌/매핑 반영) 검증 케이스 추가

- `2026-04-30`: Import Center 8차 반영
  - dry-run 예상 결과 목록 클릭 시 preview/conflict 행으로 스크롤 + 하이라이트
  - 충돌 행에서 `예상 결과로 이동` 역방향 점프 지원

- `2026-04-30`: Import Center 9차 반영
  - dry-run projection signature를 commit에 전달하고 strict check 수행
  - 시그니처 불일치 시 `DRY_RUN_STALE(409)`로 커밋 차단 및 프런트 재확인 안내
  - 테스트: stale signature 차단 + 정상 signature 커밋 검증 추가

- `2026-04-30`: Import Center 10차 반영
  - dry-run 최신 상태 배지(`최신 dry-run`/`재확인 필요`/`계산 중`) 추가
  - dry-run 기준시각 표시 및 stale 응답 시 최신 시그니처/시각 자동 갱신
  - dry-run 계산 중 또는 시그니처 없음 상태에서 커밋 버튼 비활성화

- `2026-04-30`: Audit Timeline 1차 고도화
  - 감사 이력 카드에서 before/after `diff 보기` 패널 추가
  - `복원 초안` API(`/api/trade-logs/audit/<event_id>/restore-draft`) 및 append-only 이벤트(`trade_restore_draft`) 추가
  - 수정 가능 로그는 초안을 수정폼에 즉시 주입, 삭제 이력은 수동 복원 안내
  - 테스트: 생성/수정/삭제 이벤트별 복원 초안 동작 검증 추가

- `2026-04-30`: Audit Timeline 2차 고도화
  - `복원 적용` API(`/api/trade-logs/audit/<event_id>/restore-apply`) 추가
  - 대상 로그 존재 시 업데이트, 삭제 이력은 신규 로그 재생성으로 복원
  - 복원 적용도 import_batch/reconciliation/snapshot/audit chain에 포함
  - TradeLog UI에 `복원 적용`, `초안 기준 적용` 버튼 추가

- `2026-04-30`: Audit Timeline 3차 고도화
  - 감사 이력 이벤트 타입/체인 상태 필터 추가
  - 이벤트별 해시 체인 상태(`chain_valid`) 배지/경고 표시
  - 복원 적용 전 확인 모달(취소/실행) 추가

- `2026-04-30`: Screener Bridge 1차 반영
  - 스크리너 결과 카드/상세에 `대장 초안` 액션 추가
  - 선택 종목을 포트폴리오 등록 폼 초안(localStorage)으로 전달
  - 포트폴리오 화면 진입 시 초안을 자동 적용하고 안내 메시지 표시

- `2026-04-30`: Screener Bridge 2차 반영
  - 포트폴리오 초안 적용 시 계좌 타입(증권/퇴직) 기준 자동 분기
  - 증권 통장은 `주 단위/위험자산` 강제 보정, 수량 정수화
  - 퇴직 계좌는 초안 단위/자산구분 유지하며 계좌 타입 안내 메시지 강화
- `2026-04-30`: Screener Bridge 3차 반영
  - `StockScreener -> TradeLog` 연결용 저널 prefill draft(`journal_prefill_draft_v1`) 전달
  - TradeLog 진입 시 종목코드/종목명 자동 매칭 후 최근 매수 거래에 우선 연결
  - 기존 저널 존재 시 기존 내용 우선, 미존재 시 스크리너 초안 자동 적용
  - 매칭 실패 시 거래 선택 시점에 자동채움 안내 메시지 노출
- `2026-04-30`: 배포 점검
  - Vercel 프론트 응답 정상 (`https://retirement-portfolio-omega.vercel.app` -> 200)
  - Railway 백엔드 버전 응답 정상 (`/api/version` -> `2026-04-28-report-alignment-v1`)
  - 배포 백엔드에 `/api/screener/watch-items` 라우트가 없어 404 확인 (로컬 최신 코드에는 존재)
  - 결론: 프론트/백엔드 배포 버전 불일치. Railway 재로그인 후 최신 백엔드 재배포 필요

- `2026-04-30`: 접근성/상태메시지 1단계
  - App 루트에 `main` landmark 적용(`id=main-content`)
  - TradeLog의 error/success/loading/empty 메시지에 `role`/`aria-live` 부여
  - StockScreener의 message/empty/loading/meta 안내 영역에 `role`/`aria-live` 부여

- `2026-04-30`: BFF/캐시/복구 정책 문서화 1단계
  - `docs/bff-cache-recovery-policy.md` 신규 작성
  - BFF 경계, 캐시 TTL/시그니처 검증, 장애 복구 플레이북, Known Gaps 정리

- `2026-04-30`: 모바일 마감 1차
  - TradeLog 모바일 카드 렌더 복구(`.tradelog-mobile-list`) 및 데스크톱 테이블과 동시 제공
  - Dashboard/Portfolio/TradeLog 모바일 패딩/타이포/터치 타깃(min-height) 일관화
  - Portfolio 모바일 차트 최소폭 조정(620 -> 540)으로 스크롤 부담 완화

- `2026-04-30`: 모바일 마감 2차
  - 공통 UI 토큰(`radius/spacing/heading/touch target`)을 `frontend/src/App.css`에 추가
  - Dashboard/Portfolio/TradeLog/StockScreener에 토큰을 연결해 간격·라운드·버튼 높이 일관화
  - TradeLog/Portfolio/StockScreener의 헤딩 크기와 모바일 축소 기준 동기화

- `2026-04-30`: 운영 smoke 자동화 1차
  - `npm run test:e2e:prod` 실행 확인(운영 계정 env 미설정 시 skip 확인)
  - `.github/workflows/prod-smoke.yml` 추가(수동 실행 + 평일 스케줄)
  - 시크릿 없으면 skip, 시크릿 있으면 Playwright smoke 및 결과 아티팩트 업로드
