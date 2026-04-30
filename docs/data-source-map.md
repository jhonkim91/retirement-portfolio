# 데이터 소스 맵 (External API Call Audit)

기준일: 2026-04-29  
대상: `backend/*`, `frontend/src/*` (정적 코드 스캔)  
판정 기준:
- **실행 위치**: Browser / Server
- **보안 위험 등급**: `Low` / `Medium` / `High` / `Critical`
- **Critical 조건**: 브라우저에서 API Key/Secret이 직접 노출되거나 전달되는 경우

---

## 요약

1. 현재 코드 기준 **브라우저가 3rd-party API를 직접 호출하는 경로는 없음**.
2. 외부 API 호출은 대부분 `backend/api_client.py`에서 수행되고, OpenAI 호출은 `backend/routes.py`에 1곳 존재.
3. 비밀정보(API 키)는 서버 환경변수에서 읽음(`OPENAI_API_KEY`, `OPENDART_API_KEY`), 프론트 코드에 하드코딩 흔적 없음.
4. 따라서 현재 스캔 범위 내 **Critical(브라우저 비밀 노출) 항목은 없음**.

---

## 외부 API 호출 위치 표

| 호출 위치(파일/함수) | 공급자 | 호출 대상 | 인증 방식 | 실행 위치 | 캐시 유무 | 에러 처리 | Rate limit 위험 | 사용자 출처 표시 |
|---|---|---|---|---|---|---|---|---|
| `backend/api_client.py` `get_dart_corp_code_map` | Open DART | `GET /api/corpCode.xml` | Query param `crtfc_key` (서버 env) | Server | 있음 (`dart_corp_codes`, 24h) | `try/except`, 실패 시 `{}` | 중간 (대량 초기 매핑 시) | 부분 표시 (`Open DART` 라벨) |
| `backend/api_client.py` `get_dart_company_info` | Open DART | `GET /api/company.json` | Query param `crtfc_key` | Server | 있음 (24h) | 실패 시 `None` | 낮음~중간 | 표시됨 (`StockScreener`에서 source/지표 노출) |
| `backend/api_client.py` `get_dart_financials` | Open DART | `GET /api/fnlttSinglAcntAll.json` | Query param `crtfc_key` | Server | 있음 (8h) | 연도/재무구분 재시도 후 `None` | 중간 | 표시됨 |
| `backend/api_client.py` `get_dart_recent_disclosures` | Open DART | `GET /api/list.json` | Query param `crtfc_key` | Server | 있음 (4h) | 실패 시 `[]` | 중간 | 표시됨 (공시 링크/출처) |
| `backend/routes.py` `generate_openai_stock_report` | OpenAI | `POST https://api.openai.com/v1/responses` | `Authorization: Bearer <OPENAI_API_KEY>` (서버 env) | Server | 없음(명시 캐시 없음) | HTTP>=400 시 RuntimeError, 상위에서 fallback 가능 | 중간~높음 (사용량/쿼터 민감) | 부분 표시 (`provider_label`은 보임, `citations`는 생성되나 UI 직접 노출은 제한적) |
| `backend/api_client.py` `get_price_from_yfinance` / `get_history_from_yfinance` / `search_products_from_yfinance` | Yahoo Finance (`yfinance`) | 라이브러리 내부 HTTP 호출 | 별도 API key 없음 | Server | 명시 캐시 없음 (상위 스냅샷 캐시 일부) | 실패 시 `None`/`[]` | 중간 (빈도 높으면 제한 가능) | 부분 표시 (`source: Yahoo`) |
| `backend/api_client.py` `get_price_from_naver` / `get_history_from_naver*` / `get_naver_product_by_code` / `search_products_from_naver*` / `get_naver_market_page` | Naver Finance | `finance.naver.com` HTML/JSON 엔드포인트 | 별도 인증 없음 (User-Agent 헤더) | Server | 있음 (`_naver_market_cache` 6h, quote snapshot 15m 등) | 예외 포착 후 `None`/`[]` | 높음 (스크래핑 다빈도 시 차단 가능성) | 표시됨 (`source: Naver`, DataBadge) |
| `backend/api_client.py` `get_news_from_naver_finance` / `search_news_from_naver` | Naver News/Search | `finance.naver.com`, `search.naver.com` | 별도 인증 없음 | Server | 있음 (`recent_news` 30m) | 예외 포착 후 `[]` | 중간~높음 | 표시됨 (기사 source/published_at/tone) |
| `backend/api_client.py` `search_funds_from_funetf` / `get_funetf_product_by_code` / `get_history_from_funetf` | FunETF | `funetf.co.kr` API + HTML | 별도 인증 없음 | Server | 부분 있음 (공통 메모리 캐시, quote snapshot 15m) | 예외 포착 후 `None`/`[]` | 중간 | 표시됨 (`source: FunETF`, DataBadge) |
| `backend/scheduler.py` `PriceUpdater.update_all_prices` (간접) | Naver/Yahoo/FunETF (간접) | `StockAPIClient.get_current_price` 체인 호출 | 공급자별 상동 | Server (백그라운드) | 공급자별 캐시 로직 재사용 | 실패 상품 skip, 롤백 처리 | 높음 (장중 5분 주기) | 간접 표시(동기화 후 UI 데이터 출처로 노출) |

---

## Browser 호출 계층 점검

| 위치 | 외부 호출 여부 | 비밀정보 노출 가능성 | 판정 |
|---|---|---|---|
| `frontend/src/utils/api.js` (`fetch(${API_BASE_URL}${endpoint})`) | 3rd-party 직접 호출 없음 (백엔드 API 호출) | API key 직접 사용 없음. 다만 `REACT_APP_API_URL` 오설정 시 사용자 JWT가 외부 도메인으로 전송될 수 있음 | **High (구성 실수 시)** |
| `frontend/src/components/StockResearchPanel.jsx` | 외부 URL 직접 `fetch` 없음 (백엔드 경유) | 없음 | Low |

설명:
- 프론트에는 `OPENAI_API_KEY`, `DART_API_KEY` 같은 비밀값 참조가 없음.
- 브라우저 단계 Critical 조건(비밀키 직접 노출)은 현재 코드에서 확인되지 않음.
- 단, `REACT_APP_API_URL`를 제3자 도메인으로 잘못 배포하면 JWT 토큰 유출 위험이 있으므로 운영 설정 가드가 필요.

---

## 출처 표시(사용자 가시성) 분석

### 확인된 표시 경로
- `frontend/src/lib/sourceRegistry.js`: 소스 레지스트리(`naver`, `yahoo`, `funetf`, `opendart` 등)와 freshness 정책 정의
- `frontend/src/components/DataBadge.jsx`: 소스/신선도 배지 렌더링
- 표시 사용처:
  - Dashboard (`frontend/src/pages/Dashboard.jsx`)
  - Portfolio (`frontend/src/pages/Portfolio.jsx`)
  - StockResearchPanel (`frontend/src/components/StockResearchPanel.jsx`)
  - StockScreener DART 카드 (`frontend/src/pages/StockScreener.jsx`)

### 미흡/주의
- OpenAI 분석 응답의 `citations`는 서버에서 생성되지만, UI에서 일관되게 노출되지 않음(일부는 `headlines` 중심 표시).
- 같은 데이터라도 화면별 출처 노출 수준이 다름(완전 일관 표준은 아님).

---

## 보안 위험 등급 평가 (비밀정보 관점)

| 항목 | 등급 | 근거 |
|---|---|---|
| 브라우저 비밀키 노출 (`OPENAI_API_KEY`, `OPENDART_API_KEY`) | **Low** | 프론트 코드에서 키 참조/하드코딩 없음 |
| 서버측 비밀 관리 | Medium | 서버 env 사용은 적절하나, 로깅/에러 메시지 정책 점검 필요 |
| 브라우저 토큰 오발신 (`REACT_APP_API_URL` 오설정) | **High** | JWT가 오설정된 외부 도메인으로 전송될 수 있음 |
| Critical 여부 | **없음** | 브라우저에서 API Secret 직접 노출되는 경로 미확인 |

---

## 권장 조치 (짧은 우선순위)

1. `REACT_APP_API_URL` 허용 도메인 검증(빌드/런타임 가드) 추가.
2. OpenAI 호출 결과 `citations`를 UI에도 명시적으로 노출.
3. 외부 소스별 공통 rate-limit/backoff 정책(특히 Naver 스크래핑, 스케줄러 경로) 정리.
4. 외부 호출 실패 시 사용자 메시지에 `source`와 `as-of`를 함께 표준 표기.
