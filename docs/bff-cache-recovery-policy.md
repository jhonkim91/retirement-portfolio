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

## 4.3 Retry / Backoff Matrix

| Endpoint group | Retry owner | Retry rule | User-facing fallback | Notes |
|---|---|---|---|---|
| Dashboard summary (`/api/portfolio/dashboard`) | Frontend | 1 immediate retry, then manual refresh | Show cached/stale dashboard shell if available | Keep first paint independent from heavy analytics calls. |
| Market quote/chart sync | Backend | Exponential backoff for provider calls, max 2 attempts per provider | Preserve last known quote with source/asOf badge | Do not block portfolio CRUD on quote refresh failure. |
| Screener scan/compare/watch-items | Frontend + Backend cache | Debounce UI requests; backend cache absorbs repeated reads | Show last result set with stale/fallback explanation | Recheck deployment parity when watch-items returns 404. |
| Import preview/dry-run | User action | No automatic destructive retry; user can re-run preview/dry-run | Preserve selected mappings and show conflict reason | Dry-run signature is the commit contract. |
| Import commit | Backend guard | No retry on `DRY_RUN_STALE`; require fresh dry-run | Show re-confirm prompt with latest signature time | Prevent stale commits over convenience. |
| Audit restore/apply | User action | No automatic retry after mutation starts | Show event id and recovery instruction | Append-only audit events are the recovery trail. |
| Open DART / external research | Backend provider chain | Provider-specific timeout, then fallback/non-API report | Show provider label and missing-source notice | Keep API keys server-side only. |

## 4.4 Observability Checklist

- Track request count, error count, and p95 latency by endpoint group.
- Track cache hit/miss for market sync and screener cache.
- Track import lifecycle counts: preview, dry-run, stale commit rejection, commit success, commit failure.
- Track deployment version parity in smoke output:
  - frontend base URL
  - backend `/api/version`
  - representative route checks (`/api/portfolio/dashboard`, `/api/screener/watch-items`)
- Attach Playwright artifacts for production smoke failures:
  - screenshot
  - console/network error summary
  - failing route/status code

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
- Add automated smoke checks in CI against production-like endpoints.
- Implement the observability metrics listed above in runtime logs or a hosted dashboard.
