# 심층 평가 보고서 점검판

기준 문서: `퇴직연금 포트폴리오 웹앱 심층 평가 보고서.pdf`

마지막 업데이트: `2026-04-28`

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
| 가격/공시 소스 혼합 경고 | 부분 완료 | 일부 source/freshness 표시는 있음, 화면 전반 일관성 점검 필요 |
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
| 접근성(skip link/landmark/KWCAG AA) | 부분 완료 | 일부 기본 정리만 되어 있어 추가 점검 필요 |
| 에러/빈 상태 UX | 부분 완료 | 주요 화면은 있음, 전 구간 통일 점검 필요 |
| QA/스냅샷/단위 테스트 | 부분 완료 | 분석 엔진/대시보드 중심 반영, 전체 회귀 범위는 추가 여지 있음 |
| BFF/캐시/복구 정책 문서화 | 미완료 | 기술 부채로 남아 있음 |

## 이번 작업 체크리스트

- [x] 운영 장애 원인 확인
- [x] 런타임 로그 근거 확보
- [x] 백엔드 부팅 오류 수정 배포
- [x] 운영 접속 재확인
- [x] 문서 기준 점검판 추가

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

## 다음 작업 후보

1. 접근성 점검: skip link, landmark, aria, 키보드 흐름
2. source/freshness 표시 전 화면 일관화
3. 에러/빈 상태 메시지 규격 통일
4. BFF/캐시/복구 정책 정리
