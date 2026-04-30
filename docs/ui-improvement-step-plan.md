# 웹앱 UI 개선 단계별 실행 리스트

기준 문서: `C:\Users\demon\OneDrive\바탕 화면\웹앱_UI_개선_보고서.md`

작성 목적:
- 보고서의 제안을 실제 구현 순서로 바꾼다.
- 각 단계마다 손댈 화면과 파일을 명확히 한다.
- 한 단계씩 끝낼 때마다 완료 기준으로 검증한다.

## 전체 진행 원칙

1. 첫 화면 오해를 줄이는 작업부터 한다.
2. 빈 상태보다 "지금 무엇을 봐야 하는지"가 먼저 보이게 만든다.
3. 계산 신뢰도가 애매한 수치는 과감하게 숨기거나 경고한다.
4. 계좌 타입이 다르면 같은 컴포넌트를 써도 화면 우선순위는 다르게 둔다.

## Step 1. 계좌 선택과 진입 흐름 정리

목표:
- 첫 진입 5초 안에 현재 계좌 상태를 이해할 수 있게 만든다.
- 빈 계좌와 실제 데이터가 있는 계좌를 명확히 구분한다.
- 깨진 계좌명이 화면에 그대로 노출되지 않게 막는다.

대상 파일:
- `frontend/src/components/AccountSelector.jsx`
- `frontend/src/pages/Dashboard.jsx`
- `frontend/src/utils/api.js`
- 필요 시 `backend/routes.py`

작업 체크리스트:
- 기본 진입 계좌를 실제 기본 계좌 기준으로 더 안정적으로 맞춘다.
- 계좌 드롭다운에 계좌 타입과 상태를 더 강하게 표시한다.
- 빈 계좌 선택 시 상단 안내 문구를 분명하게 보여준다.
- 깨진 계좌명 감지 규칙을 정하고, 표시 이름 또는 경고 처리를 넣는다.
- 현재 선택된 계좌의 성격을 헤더에서 더 짧고 분명하게 설명한다.

완료 기준:
- 사용자가 첫 진입 시 `데이터가 없는 앱`으로 오해하지 않는다.
- `퇴직연금`, `IRP`, `주식 통장`의 차이가 선택 직후 바로 보인다.
- 계좌 선택 UI만 보고도 "빈 계좌인지, 실제 계좌인지" 구분 가능하다.

진행 상태:
- 완료 (2026-04-30)

현재 코드 메모:
- `frontend/src/pages/Dashboard.jsx`는 저장된 계좌명으로 먼저 요약 API를 호출한다.
- `frontend/src/components/AccountSelector.jsx`는 계좌 목록을 받은 뒤에야 선택값을 보정한다.
- `backend/routes.py`의 `list_user_accounts()`는 `is_default` 기준 정렬을 해주지만, 첫 화면 로딩 순서상 그 이점이 즉시 반영되지 않을 수 있다.

## Step 2. 대시보드 1스크린 구조 재설계

목표:
- 첫 화면에서 핵심 KPI와 경고만 먼저 읽히게 만든다.
- 심화 분석은 뒤로 보내고, 대시보드는 운영 요약 역할에 집중시킨다.

대상 파일:
- `frontend/src/pages/Dashboard.jsx`
- `frontend/src/styles/Dashboard.css`
- `frontend/src/components/DataBadge.jsx`

작업 체크리스트:
- 상단 헤더를 `현재 계좌 / 타입 / 핵심 액션` 중심으로 재배치한다.
- 1차 KPI 묶음과 1차 경고 묶음을 분리한다.
- 자산 비중, 보유 종목, 오늘 변화는 중간층으로 재정렬한다.
- 분석 엔진 영역은 접힘, 토글, 또는 별도 섹션으로 약화한다.
- 시각적 밀도를 다시 잡아 중요한 숫자와 보조 메타를 분리한다.

완료 기준:
- 대시보드 첫 화면만으로 현재 상태, 경고, 다음 액션이 읽힌다.
- 분석 엔진을 열지 않아도 운영 판단에 필요한 정보가 충분하다.

진행 상태:
- 완료 (2026-04-30)

## Step 3. 상품 추이 화면을 작업 중심으로 재배치

목표:
- 추이 화면을 `입력 화면`이 아니라 `차트 중심 작업 화면`으로 바꾼다.
- 상품이 이미 있을 때 빈 차트가 먼저 보이는 문제를 없앤다.

대상 파일:
- `frontend/src/pages/Portfolio.jsx`
- `frontend/src/styles/Portfolio.css`

작업 체크리스트:
- 보유 상품 상위 비중 3개를 기본 선택한다.
- 차트 빈 상태 대신 추천 선택 또는 최근 선택 조합을 보여준다.
- 왼쪽 패널은 입력/입금/관리, 오른쪽은 차트/상세로 역할을 분리한다.
- 선택된 상품 요약을 차트 가까이에 고정한다.
- 차트가 비어도 다음 행동이 보이는 상태 메시지를 만든다.

완료 기준:
- 상품이 있는 계좌에서는 차트가 기본적으로 의미 있는 상태로 열린다.
- 사용자가 무엇을 체크해야 하는지 고민하지 않아도 된다.

진행 상태:
- 완료 (2026-04-30)

## Step 4. 매매일지와 감사 이력 분리 강화

목표:
- 거래 기록과 감사 이력을 서로 다른 목적의 화면으로 읽히게 만든다.
- 감사 이력이 비어 있을 때도 미완성처럼 보이지 않게 만든다.

대상 파일:
- `frontend/src/pages/TradeLog.jsx`
- `frontend/src/styles/TradeLog.css`
- 필요 시 `backend/routes.py`

작업 체크리스트:
- `거래 기록`과 `감사 이력`의 요약 영역을 더 명확히 분리한다.
- 감사 이력 0건의 이유를 설명하는 상태 문구를 넣는다.
- export 버튼의 시각적 우선순위를 낮춘다.
- 감사 이력 필터, 상태 배지, 체인 경고의 구분을 강화한다.

완료 기준:
- 사용자가 거래 기록과 감사 기록을 다른 목적의 도구로 인식한다.
- 0건 상태가 기능 미완성처럼 보이지 않는다.

## Step 5. 분석 엔진 신뢰도 방어

목표:
- 비정상 수치가 앱 전체 신뢰를 떨어뜨리지 않게 한다.
- 계좌 타입에 따라 고급 지표 노출 조건을 분리한다.

대상 파일:
- `frontend/src/lib/analytics/engine.js`
- `frontend/src/components/analytics/AnalyticsDashboard.jsx`
- `frontend/src/pages/Dashboard.jsx`
- 관련 테스트 파일

작업 체크리스트:
- 비정상 변동성, drawdown, 초과수익률에 대한 방어 규칙을 정의한다.
- 표시 불가 조건에서는 숨김 또는 경고로 처리한다.
- 연금 계좌와 일반 계좌의 계산 해석 차이를 라벨로 보여준다.
- benchmark 비교 가능 구간 부족 시 설명 문구를 추가한다.

완료 기준:
- 사용자가 `말이 안 되는 숫자`를 먼저 보지 않는다.
- 고급 수치는 조건이 맞을 때만 자신 있게 노출된다.

## Step 6. 계좌 타입별 화면 템플릿 분화

목표:
- 같은 구조를 재사용하더라도 계좌 타입별 우선순위를 다르게 보여준다.

대상 파일:
- `frontend/src/pages/Dashboard.jsx`
- `frontend/src/pages/Portfolio.jsx`
- `frontend/src/components/AccountSelector.jsx`
- 필요 시 `frontend/src/lib/pensionEligibility.js`

작업 체크리스트:
- 연금 계좌: 적격성, 위험자산 한도, 현금흐름 강조
- 주식 통장: 변동성, 집중도, 종목 리스크 강조
- 공통 컴포넌트는 유지하되 섹션 순서와 강조 레벨을 분기한다.

완료 기준:
- 계좌 타입이 바뀌면 같은 앱이라도 읽는 순서와 해석 포인트가 달라진다.

## 빠른 개선안 묶음

바로 체감되는 항목:
- 기본 계좌 진입 안정화
- 빈 계좌 안내 문구 추가
- 상품 추이 기본 선택 자동화
- 분석 엔진 이상치 임시 숨김
- 감사 이력 0건 설명 문구 추가

## 권장 진행 순서

1. Step 1 계좌 선택과 진입 흐름 정리
2. Step 2 대시보드 1스크린 구조 재설계
3. Step 3 상품 추이 화면 작업 중심 재배치
4. Step 4 매매일지와 감사 이력 분리 강화
5. Step 5 분석 엔진 신뢰도 방어
6. Step 6 계좌 타입별 화면 템플릿 분화

## 바로 다음 작업

다음 구현 라운드는 Step 3부터 시작한다.

Step 3에서 먼저 처리할 우선 항목:
- 보유 상품 상위 비중 3개 기본 선택
- 상품 추이 차트 빈 상태 대신 추천 선택 또는 최근 선택 조합 제공
- 입력 패널과 차트/상세 패널 역할 분리
- 선택 상품 요약을 차트 가까이에 고정
Update note (2026-04-30):
- Step 3 is complete.
- Next implementation round starts with Step 4 trade log vs audit trail separation.
- First Step 4 focus:
  - separate trade-record vs audit-history intent on the first screen
  - make the zero-audit state read as empty, not unfinished
  - strengthen audit filters, badges, and chain-warning readability
  - rebalance export button visual priority
