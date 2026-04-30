# Portfolio Domain Model Refactor

## 목표

기존 단순 `보유수량/평단` 구조를 확장해 계좌 래퍼 + lot + 현금흐름 + 스냅샷 + 벤치마크 기반 분석으로 정비했습니다.

## 신규 핵심 모델

백엔드 `backend/models.py`에 아래 모델을 추가했습니다.

- `account_wrappers`
- `holdings_lots`
- `portfolio_snapshots`
- `cash_flows`
- `benchmarks`

기존 `account_profiles`, `products`, `trade_logs`는 원본 원장 역할로 유지하고,
신규 모델은 분석/리포트용 정규화 계층으로 사용합니다.

## 신규 API

- `GET /api/portfolio/domain-model?scope=account|all&account_name=...`

반환:

- `account_wrappers`
- `holdings_lots`
- `cash_flows`
- `portfolio_snapshots`
- `benchmarks`
- `price_series`
- `provenance` (`source/asOf/latencyClass/reconciled`)

## 계산 엔진 정리

프론트 분석 엔진에서 성과 계산 함수를 분리했습니다.

- `frontend/src/lib/analytics/performance.js`
  - `calculateTWR`
  - `calculateMWR`
  - `calculateAverageUnitCost`

그리고 현금흐름 부호를 유지하도록 수정해 MWR 계산 정확도를 높였습니다.

## 배당/수수료/세금 반영 포인트

`cash_flows.flow_type` 기준으로 분류:

- `dividend`
- `fee`
- `tax`

분석 결과의 `flowVsMarket`에서 별도 항목으로 반영됩니다(값이 0이 아닌 경우 표시).

## 동일 종목 다계좌 보유

- `holdings_lots`는 `account_wrapper_id + symbol` 기준으로 분리 저장
- 같은 종목을 여러 계좌에서 동시에 보유해도 분석 입력이 충돌하지 않게 구성

## 계좌별/전체 토글 UI

`Dashboard`에 토글을 추가했습니다.

- `계좌별 분석`
- `전체 포트폴리오 분석`

같은 화면에서 IRP/퇴직연금/일반계좌 비교가 가능하며 계산 로직은 공통 엔진(`computePortfolioAnalytics`)을 그대로 사용합니다.

## 기준시각/출처 표시

도메인 모델 응답의 `provenance`를 `DataBadge`로 노출합니다.

- `source`
- `asOf`
- `latencyClass`
- `reconciled`

## 테스트

추가:

- `frontend/src/lib/analytics/__tests__/domainModel.test.js`

검증:

1. 단일/복수 lot 평균단가
2. 현금 유입/유출이 있는 MWR
3. 계좌별 vs 전체 합산 입력 비교
4. 배당 반영 스냅샷 검증

