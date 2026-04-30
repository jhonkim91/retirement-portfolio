# Quality Gates

This repository now runs an automated quality gate for every pull request.

## Gate Components

- `lint`
  - Frontend ESLint checks
- `typecheck`
  - TypeScript static checks from `tests/tsconfig.json`
- `test:backend`
  - Python `unittest` suite (security/privacy/journal/screener coverage)
- `test:unit`
  - Unit tests for performance and normalization logic
- `test:integration`
  - API/BFF, DB persistence, and provider fallback integration tests
- `test:e2e`
  - End-to-end flow:
    - signup/login
    - portfolio product create
    - stock query
    - journal create
    - screener run
- `test:e2e:prod` (optional smoke)
  - Production login + dashboard 핵심 카드 노출 확인
  - HAR / screenshot / runtime log 산출물 저장
- `test:frontend`
  - Existing React test suites and snapshots
- `build:frontend`
  - Production frontend build validation

## Required Sample Test Files

- `tests/unit/performance-engine.test.ts`
- `tests/integration/portfolio-api.test.ts`
- `tests/e2e/dashboard.spec.ts`
- `tests/utils/mockProvider.ts`

## Local Run

```bash
npm run quality-gate
```

Production smoke (optional):

```bash
# PowerShell
$env:E2E_PROD_BASE_URL="https://retirement-portfolio-omega.vercel.app"
$env:E2E_PROD_USERNAME="(운영 사용자명)"
$env:E2E_PROD_PASSWORD="(운영 비밀번호)"
npm run test:e2e:prod
```

## CI Workflow

- File: `.github/workflows/quality-gates.yml`
- Triggers:
  - `pull_request`
  - `push` to `main` and `master`

## Production Smoke Workflow

- File: `.github/workflows/prod-smoke.yml`
- Triggers:
  - `workflow_dispatch`
  - weekday schedule (UTC 22:00, Mon-Fri)
- Required GitHub Secrets:
  - `E2E_PROD_USERNAME`
  - `E2E_PROD_PASSWORD`
- Optional GitHub Secret:
  - `E2E_PROD_BASE_URL` (default: `https://retirement-portfolio-omega.vercel.app`)

## Merge Protection Setup

In GitHub branch protection settings, mark the `Quality Gates` workflow as a required status check so merges are blocked until lint, typecheck, tests, and build all pass.
