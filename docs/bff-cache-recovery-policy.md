# BFF / Cache / Recovery Policy

Last updated: `2026-04-30`

## 1. BFF Boundary

- Frontend never calls external market providers directly.
- Frontend calls backend `/api/*` only.
- Backend (`backend/routes.py`) owns:
  - market quote/chart aggregation
  - screener scan/compare
  - Open DART normalization
  - reconciliation/import commit guards

## 2. Cache Policy

### 2.1 Market sync cache

- In-memory cache key: account/product-level sync context
- Constant: `MARKET_SYNC_TTL_SECONDS = 60 * 5`
- Purpose:
  - reduce repeated intraday sync calls
  - avoid blocking dashboard first paint

### 2.2 Screener cache

- In-memory `_screener_cache` for repeated screener/chart/compare reads.
- Purpose:
  - absorb burst requests from filter toggles and compare operations
  - reduce provider/API pressure during user exploration

### 2.3 Import dry-run signature cache contract

- Import commit must carry latest dry-run projection signature.
- On mismatch backend returns `DRY_RUN_STALE (409)` and rejects commit.
- Frontend must refresh projection and re-confirm before commit.

## 3. Freshness / Provenance UX Contract

- UI should display source + asOf where available.
- Stale or uncertain projections must be visible before destructive actions.
- Any fallback result should preserve explainability (why stale/fallback happened).

## 4. Failure Handling

## 4.1 User-facing

- Return concise action-oriented messages:
  - retry available
  - re-run dry-run
  - check login/session

## 4.2 Internal

- Keep diagnostic context in server logs/audit events:
  - account_name
  - endpoint
  - batch_id / event_id
  - reconciliation linkage

## 5. Recovery Playbook

### 5.1 Runtime/API failure

1. Check `/api/version`
2. Check core API health:
   - `/api/portfolio/dashboard`
   - `/api/screener/*`
3. Verify deployment version parity (frontend vs backend)

### 5.2 Import conflict/commit failure

1. Re-run preview/dry-run
2. Confirm conflict selection + mapping overrides
3. Re-commit with latest signature only

### 5.3 Deployment mismatch

1. Confirm frontend bundle endpoint references
2. Redeploy backend first
3. Re-test watch-items/screener APIs

## 6. Known Gaps (Next Iteration)

- Move in-memory cache to shared store (Redis/managed KV) for multi-instance consistency.
- Add cache hit/miss observability metrics.
- Add automated smoke checks in CI against production-like endpoints.
- Add explicit retry/backoff policy table per endpoint group.
