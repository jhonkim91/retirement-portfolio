# Market Data Adapter Layer

이 문서는 `market data adapter` 계층의 목적과 현재 구현 범위를 정리합니다.

## 1) 목적

- 공급자별 API 구현을 공통 인터페이스 뒤로 숨김
- 응답 표준화 (`source`, `asOf`, `latencyClass`, `reconciled`)
- 스키마 검증 실패/타임아웃/일시 장애 시 fallback 캐시로 graceful degradation
- 사용자 노출 메시지와 내부 로그를 분리

## 2) 구현 위치

- `frontend/src/server/market-data/core/types.ts`
- `frontend/src/server/market-data/core/provider.ts`
- `frontend/src/server/market-data/providers/*`
- `frontend/src/server/market-data/index.ts`

핵심 타입:

- `DataProvenance`
- `QuoteSnapshot`
- `ProviderResult<T>`
- `MarketDataProviderError`

## 3) Provider 구성

현재 추가된 provider:

- `KRXQuoteProvider` (`providers/krx.ts`)
  - timeout: `5000ms`
  - rate limit: `30 req/min`
  - zod 검증: Naver chart 응답 + `quoteSnapshotSchema`
- `ManualQuoteProvider` (`providers/manual.ts`)
  - timeout: `500ms`
  - rate limit: `120 req/min`
  - zod 검증: `quoteSnapshotSchema`
- `OpenDARTProvider` (`providers/opendart.ts`)
  - timeout: `7000ms`
  - rate limit: `15 req/min`
  - zod 검증: DART company schema

## 4) Fallback 동작

`executeProviderRequest` 공통 실행기에서 아래를 처리합니다.

1. rate limit 검사
2. timeout 적용
3. zod schema parse
4. 성공 시 cache 갱신
5. 실패 시 stale fallback cache 반환 (가능한 경우)
6. fallback도 없으면 `MarketDataProviderError` 발생

오류 응답 정책:

- 사용자 메시지: `userMessage`
- 내부 로그 메시지: `internalMessage`, `payload`

## 5) UI 노출

배지 생성 헬퍼 추가:

- `frontend/src/lib/sourceRegistry.js`
  - `buildDataBadgeDescriptorFromProvenance(provenance, extras?)`

적용 컴포넌트:

- `frontend/src/components/StockResearchPanel.jsx`

`quote.provenance`가 있으면 출처/기준시각/정합성 정보를 배지로 표시합니다.

## 6) Browser direct call 정책

원칙:

- 브라우저에서 외부 금융 API를 직접 호출하지 않고, 서버/BFF를 통해 호출

현재 상태:

- 기존 앱의 실사용 API는 `/api/*`(서버) 경유
- 신규 adapter 코드는 `server` 계층으로 분리되어 있으며, 클라이언트 UI가 외부 금융 API URL을 직접 호출하지 않도록 유지

## 7) 테스트

테스트 파일:

- `frontend/src/server/market-data/__tests__/provider.test.ts`

검증 항목:

- 공급자 응답 스키마 검증 실패 시 graceful fallback
- provider timeout
- stale cache 반환 여부
- provenance 메타데이터 누락 방지

