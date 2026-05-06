# Codex Shared Memory

Last updated: 2026-05-06 15:24 KST

## Current State

- Work is synchronized through the `codex-handoff` branch.
- The current PC has Startup-folder auto sync enabled because Windows Task Scheduler registration was denied.
- Background auto sync runs `scripts/codex-sync.ps1` periodically.
- The latest shared work has been pushed to GitHub on `origin/codex-handoff`.
- Report-tracker status was refreshed against current code: Import Center user flow is now marked complete, mobile polish is marked first-pass complete, and remaining work is split into visual QA/accessibility/error-state/BFF observability/deployment validation.
- Backend Python dependencies were installed from `backend/requirements.txt` on this PC so backend tests can run locally.
- Cleanup pass completed: CRA boilerplate/test/logo assets and static `example.com` placeholders were removed or replaced. Local generated logs, caches, build output, test results, root dummy DBs, and backend test DBs were deleted. `.env`, dependency folders, and `backend/instance/retirement.db` were intentionally kept.
- UI improvement Step 1 is implemented: pages now wait for resolved account metadata before first account-scoped fetch, empty accounts are labeled clearly, and broken account names are blocked on create/rename while legacy broken names are surfaced as warnings.
- Playwright Chromium was installed on this PC so browser-based local verification can run without extra setup.
- UI improvement Step 2 is implemented: the dashboard first screen now separates primary KPIs, the immediate action/status rail, and secondary summary cards so the user sees current state, warnings, and next actions before the detailed panels.
- UI improvement Step 3 is implemented: the portfolio trend workspace now auto-selects the top holdings, remembers the latest per-account trend mix, separates left-side entry/management from right-side chart work, and keeps holdings visible even while trend data is still loading.
- Dashboard/stock-analysis follow-up is implemented: `현황` is back to a summary-first view with risk-vs-safe allocation, principal-based performance, and current-holdings return charts, while the heavier benchmark/analytics workflow now lives in the `종목 분석` tab.
- Logged-in navigation was simplified again by removing the `소개`, `도움말`, `개인정보`, `삭제요청`, and `문의처` tabs from the top menu while leaving the underlying routes intact.
- Dashboard cash editing is restored on the summary card, and saving cash now refreshes both the dashboard totals and account-profile metadata so the selector stays in sync.
- The shared account selector summary card was removed from the app surface, leaving only the dropdown and settings controls so the dashboard area starts more cleanly.
- The public Vercel deployment at `https://retirement-portfolio-omega.vercel.app` has been redeployed from the latest `codex-handoff` code and now serves the frontend build without the removed account summary box strings.
- The `계좌 심층 분석` panel now falls back to the legacy analytics inputs when the production Railway backend is missing `/api/portfolio/domain-model`, so the panel can still open on production while backend parity is still pending.
- Vercel production was redeployed again from clean `codex-handoff` HEAD `7525a24`, and `retirement-portfolio-omega.vercel.app` now points at deployment `dpl_G3MRPiAAmJwCrJy86LaxzYZRg1Pe`.
- The stock-research account analytics panel no longer crashes when it renders before `report` is ready; production now shows the fallback notice and dashboard instead of blanking the page even while Railway still fails the `domain-model` CORS/preflight request.

## Resume Checklist

Run these commands when starting on a PC:

```powershell
git checkout codex-handoff
npm.cmd run codex:sync
```

Then read this file before continuing work.

Run this before switching PCs:

```powershell
npm.cmd run codex:save
```

## Important Files

- `AGENTS.md`: shared instructions for Codex sessions.
- `docs/codex-memory.md`: this shared memory file.
- `docs/codex-handoff.md`: setup guide for PC-to-PC handoff.
- `scripts/codex-sync.ps1`: sync, save, resume, and auto-sync installer.
- `scripts/codex-sync-loop.ps1`: hidden background sync loop used by Startup fallback.

## Decisions

- Use GitHub as the shared source of truth between PCs.
- Use `codex-handoff` as the active WIP branch.
- Keep generated and sensitive files out of Git.
- Keep cross-PC context in repository files instead of relying on local chat memory.
- Treat production smoke as code-ready but ops-blocked until GitHub Actions secrets are configured.
- Treat Railway backend deployment parity as an open operational item because docs record production `/api/screener/watch-items` returning 404 while local latest code has the route.

## Recent Changes

- Updated `docs/deep-research-report-3-tracker.md`:
  - marked Import Center P0 flow complete
  - split mobile polish into completed first pass plus visual QA/keyboard follow-up
  - added deployment parity as a tracked status item
- Updated `docs/report-checklist.md`:
  - repaired garbled source-mixing row
  - added operating smoke/deployment parity rows
  - recorded the 2026-04-30 report-status refresh
- Updated `docs/bff-cache-recovery-policy.md`:
  - added endpoint-group retry/backoff matrix
  - added observability checklist for caches, imports, smoke failures, and deployment parity
- Updated frontend accessibility/status UX:
  - `frontend/src/App.js`: route wrapper changed to `role="main"` container to avoid nested main landmarks
  - `frontend/src/pages/ImportCenter.jsx`: keyboard-selectable batch rows + live-region status/error/empty messaging
  - `frontend/src/pages/Portfolio.jsx`, `frontend/src/pages/StockResearch.jsx`, `frontend/src/pages/TradeLog.jsx`: live-region consistency and broken empty-copy fixes
- Added ops automation scripts for blocked external steps:
  - `scripts/setup-prod-smoke-secrets.ps1` (`GH_TOKEN`-based secrets setup)
  - `scripts/redeploy-railway-backend.ps1` (Railway deploy + endpoint probes)
  - `package.json` scripts: `ops:setup-prod-smoke-secrets`, `ops:redeploy-railway-backend`
- Cleaned frontend dummy/placeholder assets:
  - replaced the default CRA README with project-specific frontend notes
  - removed the no-op `frontend/src/App.test.js` and unused `frontend/src/logo.svg`
  - replaced CRA favicon/logo PNG assets with `frontend/public/favicon.svg`
  - updated `index.html`, `manifest.json`, `robots.txt`, and `sitemap.xml` to use the production Vercel URL instead of `example.com`
  - changed SEO helpers to avoid pointing social metadata at the old CRA logo assets
- Added `docs/ui-improvement-step-plan.md` to convert `웹앱_UI_개선_보고서.md` into a 6-step implementation queue with target files and done criteria.
- Completed UI improvement Step 1 account-entry stabilization:
  - `backend/routes.py`: added account name validation for create/rename and richer `/api/accounts` metadata (`display_name`, `has_name_issue`, counts, `has_data`, `is_empty`)
  - `frontend/src/utils/api.js` and `frontend/src/hooks/useResolvedAccount.js`: centralized initial account resolution so invalid stored selections fall back to a populated account before first fetch
  - `frontend/src/components/AccountSelector.jsx` and `frontend/src/App.css`: selector now shows account type/status badges, counts, cash, empty-account guidance, and legacy-name warnings
  - `frontend/src/pages/Dashboard.jsx`, `Portfolio.jsx`, `TradeLog.jsx`, `StockResearch.jsx`, `StockScreener.jsx`, `ImportCenter.jsx`: migrated to the shared account-resolution flow
  - tests added in `backend/tests/test_account_profiles.py` and `frontend/src/utils/__tests__/accountSelection.test.js`
- Completed UI improvement Step 2 dashboard first-screen redesign:
  - `frontend/src/pages/Dashboard.jsx`: reorganized the first screen into account context hero, quick-action/status rail, 3 primary KPI cards, a focused "오늘 볼 것" panel, and 4 secondary summary cards before the drill-down panels
  - `frontend/src/styles/Dashboard.css`: rebuilt the dashboard layout and card hierarchy for a denser operational scan pattern across desktop/mobile
  - `frontend/src/pages/__tests__/Dashboard.test.jsx` snapshots updated for the new hierarchy

- Completed UI improvement Step 3 portfolio trend workspace re-layout:
  - `frontend/src/pages/Portfolio.jsx`: added per-account trend selection memory, default top-3 holding selection, right-side trend summary/actions, explicit empty-state recovery actions, and split product-vs-trend loading so holdings appear before trend sync completes
  - `frontend/src/styles/Portfolio.css`: added the trend summary strip, action-row styling, and responsive chart-empty-state layout
  - `frontend/src/pages/__tests__/Portfolio.test.jsx`: added coverage for default top-3 selection and saved-selection restore
- Rebalanced the dashboard and stock-analysis surfaces around the user's preferred workflow:
  - `frontend/src/pages/Dashboard.jsx` + `frontend/src/styles/Dashboard.css`: replaced the ops-cockpit first screen with summary cards, a risk/safe allocation donut, principal-vs-performance summary, a current-holdings return chart, and a holdings table
  - `frontend/src/components/AccountAnalyticsPanel.jsx` + `frontend/src/styles/AccountAnalyticsPanel.css`: extracted the benchmark selection and analytics dashboard loader into a reusable panel
  - `frontend/src/pages/StockResearch.jsx` + `frontend/src/styles/StockResearch.css`: added the new account analytics panel below the stock research workspace and updated the tab/page framing to `종목 분석`
  - `frontend/src/components/Navigation.jsx`: renamed the navigation entry from the old stock-info label to `종목 분석`
  - `frontend/src/pages/__tests__/Dashboard.test.jsx`: replaced the old snapshot-heavy dashboard checks with focused overview assertions and removed the obsolete dashboard snapshot file
- Simplified logged-in top navigation:
  - `frontend/src/components/Navigation.jsx`: removed `소개`, `도움말`, `개인정보`, `삭제요청`, and `문의처` from the main tab row

- Restored dashboard cash editing after the summary-first redesign removed the control:
  - `frontend/src/pages/Dashboard.jsx`: added inline `보유 현금` edit state, validation, save/cancel controls, and post-save refresh of both summary data and account profiles
  - `frontend/src/styles/Dashboard.css`: added summary-card cash editor styles for the input, buttons, helper copy, and mobile layout
  - `frontend/src/pages/__tests__/Dashboard.test.jsx`: rewrote the dashboard test file in clean UTF-8 text and added cash-edit coverage
- Removed the account summary box shown under the account selector:
  - `frontend/src/components/AccountSelector.jsx`: removed the selected-account summary card markup and its unused cash formatter
  - `frontend/src/App.css`: deleted the selector-summary styles that were only used by the removed box
- Investigated the public Vercel deployment mismatch:
  - confirmed deployed `asset-manifest.json` still points to older hashes such as `main.1ae316bd.js`, `100.807d724d.chunk.js`, and `188.548b5376.chunk.js`
  - confirmed deployed source maps still include `account-switcher-summary` and `현재 알고리즘`, while local build hashes are `main.1b17c18d.js`, `100.67d24fac.chunk.js`, and `188.c27f5513.chunk.js`
- Redeployed the Vercel frontend and relinked local Vercel project metadata:
  - `vercel.cmd link --yes --project retirement-portfolio --scope jhonkims-projects` linked the repo locally and added `.vercel` to `.gitignore`
  - `vercel.cmd deploy --prod --yes --scope jhonkims-projects` created production deployment `dpl_8vZoZtkVBosRr8GYiAFYC2skYEQz`
  - the production alias `https://retirement-portfolio-omega.vercel.app` now points at `https://retirement-portfolio-dnn04kcy0-jhonkims-projects.vercel.app`
- Fixed production analytics-panel resilience for missing domain-model support:
  - `frontend/src/components/AccountAnalyticsPanel.jsx`: changed analytics data loading so `/portfolio/domain-model` failure no longer aborts the whole panel; it now falls back to the existing summary/products/trends/trade-log path and shows a fallback notice
  - `frontend/src/components/__tests__/AccountAnalyticsPanel.test.jsx`: added coverage for the production-style `404` domain-model fallback path
  - redeployed Vercel production with `vercel.cmd deploy --prod --yes --scope jhonkims-projects`, creating deployment `dpl_5zrtBhySekuhQ3xPiMT2dFDTLnZF`
- Re-ran Vercel production deploy from the saved branch head with `vercel.cmd deploy --prod --yes --scope jhonkims-projects`, creating deployment `dpl_G3MRPiAAmJwCrJy86LaxzYZRg1Pe`.
- Fixed the stock-research analytics render race and redeployed production:
  - `frontend/src/components/analytics/AnalyticsDashboard.jsx`: added a stable empty-report fallback so chart transformers and summary sections stay null-safe before analytics data arrives
  - `frontend/src/components/AccountAnalyticsPanel.jsx`: toggling the panel open now primes `analyticsLoading` immediately so the first expanded render stays on the loading state instead of racing through a null `report`
  - `frontend/src/components/analytics/__tests__/AnalyticsDashboard.test.jsx`: added coverage for the loading and empty states when the dashboard receives no report
  - redeployed Vercel production with `vercel.cmd deploy --prod --yes --scope jhonkims-projects`, creating deployment `dpl_D9A6rNLX6bf3E3LSVVDpQCWuxhU8`

## Verification

- `npm.cmd run test:backend` passed: 14 tests.
- `npm.cmd run test:unit` passed: 5 tests.
- `npm.cmd run test:e2e:prod` completed with 1 skipped test because production credentials are not set in env.
- `npm.cmd run typecheck` passed.
- `npm.cmd run test:frontend` passed: 12 suites / 30 tests after removing the no-op CRA test.
- `npm.cmd run build:frontend` passed after SEO/static asset cleanup.
- `npm.cmd run test:unit` passed: 1 suite / 5 tests.
- `npm.cmd run ops:setup-prod-smoke-secrets` blocked as designed when `GH_TOKEN` is missing.
- `npm.cmd run ops:redeploy-railway-backend -- --SkipDeploy` blocked as designed when Railway token env vars are missing.
- `npm.cmd run test:backend` passed: 16 tests after adding account profile coverage.
- `npm.cmd run test:frontend` passed: 13 suites / 33 tests after adding account selection coverage.
- `npm.cmd run build:frontend` passed after Step 1 account-entry changes.
- Local dev server responded at `http://127.0.0.1:3001`, and a Playwright screenshot check (`test-results/ui-step1-dashboard.png`) confirmed the logged-out app shell loads with visible content and no browser errors.
- `npm.cmd --prefix frontend run test -- src/pages/__tests__/Dashboard.test.jsx --watchAll=false -u` passed after Step 2 dashboard layout updates.
- `npm.cmd run test:frontend` passed again: 13 suites / 33 tests.
- `npm.cmd run build:frontend` passed again after Step 2 dashboard changes.
- Local verification with frontend `http://127.0.0.1:3001` and backend `http://127.0.0.1:5000` confirmed the authenticated dashboard renders the resolved populated brokerage account instead of the empty default account; screenshots saved under `test-results/dashboard-step2-debug-products.png` and `test-results/dashboard-step2-verified.png`.
- `npm.cmd run test:frontend -- --runTestsByPath src/pages/__tests__/Portfolio.test.jsx --watch=false` passed after Step 3 portfolio changes.
- `npm.cmd run test:frontend` passed: 14 suites / 35 tests after adding Portfolio trend workspace coverage.
- `npm.cmd run build:frontend` passed after Step 3 portfolio workspace changes.
- Browser verification against the local dev server with mocked `/api` responses confirmed the Portfolio route loads with visible content, no console errors or overlay, default top-3 trend chips render, and the clear/restore actions work; screenshot saved to `test-results/portfolio-step3-verified.png`.
- `npm.cmd run test:frontend -- --runTestsByPath src/pages/__tests__/Dashboard.test.jsx --watch=false` passed after restoring the summary-first dashboard.
- `npm.cmd run lint` passed after moving analytics into the stock-research tab.
- `npm.cmd run build:frontend` passed after the dashboard/stock-analysis split.
- `npm.cmd run test:frontend` passed again: 14 suites / 34 tests.
- Local frontend dev server responded at `http://127.0.0.1:3001` after the redesign build.
- `npm.cmd run lint` passed after removing the extra navigation tabs.

- `npm.cmd run test:frontend -- --runTestsByPath src/pages/__tests__/Dashboard.test.jsx --watch=false` passed after restoring the cash editor.
- `npm.cmd run test:frontend` passed: 14 suites / 35 tests after adding dashboard cash-edit coverage.
- `npm.cmd run lint` passed after restoring dashboard cash editing.
- `npm.cmd run build:frontend` passed after restoring dashboard cash editing.
- `npm.cmd run lint` passed after removing the shared account selector summary box.
- `npm.cmd run build:frontend` passed after removing the shared account selector summary box.
- Public deployment verification against `https://retirement-portfolio-omega.vercel.app/login` returned `200`, but deployed `asset-manifest.json` and chunk/source-map inspection showed the production site is still serving older frontend assets containing the removed account summary box.
- `vercel.cmd deploy --prod --yes --scope jhonkims-projects` completed successfully and aliased production to deployment `dpl_8vZoZtkVBosRr8GYiAFYC2skYEQz`.
- Post-deploy verification against `https://retirement-portfolio-omega.vercel.app` returned `200`, `asset-manifest.json` switched to `main.70a496c4.js`, `100.67d24fac.chunk.js`, and `188.c27f5513.chunk.js`, and those deployed assets no longer contain `account-switcher-summary`, `현재 알고리즘`, or `선택된 계좌 상태`.
- Production backend verification showed `https://backend-production-2516.up.railway.app/api/portfolio/domain-model` still returns `404`, while adjacent analytics endpoints such as `/api/portfolio/all-products` and `/api/screener/chart` respond with `401` unauthenticated, confirming backend route parity is still missing.
- `npm.cmd --prefix frontend run test -- --runTestsByPath src/components/__tests__/AccountAnalyticsPanel.test.jsx --watchAll=false` passed after adding the domain-model fallback case.
- `npm.cmd run lint` passed after the analytics-panel fallback update.
- `npm.cmd run build:frontend` passed after the analytics-panel fallback update.
- `vercel.cmd deploy --prod --yes --scope jhonkims-projects` completed successfully and aliased production to deployment `dpl_5zrtBhySekuhQ3xPiMT2dFDTLnZF`, now serving `main.161fd7e8.js`.
- `vercel.cmd deploy --prod --yes --scope jhonkims-projects` completed successfully again from clean HEAD `7525a24`, and `vercel.cmd inspect retirement-portfolio-omega.vercel.app --scope jhonkims-projects` confirmed aliasing to `dpl_G3MRPiAAmJwCrJy86LaxzYZRg1Pe`.
- `npm.cmd --prefix frontend run test -- --runTestsByPath src/components/analytics/__tests__/AnalyticsDashboard.test.jsx src/components/__tests__/AccountAnalyticsPanel.test.jsx --watchAll=false -u` passed after the stock-research analytics null-report fix.
- `npm.cmd run lint` passed after the stock-research analytics null-report fix.
- `npm.cmd run build:frontend` passed after the stock-research analytics null-report fix.
- Public production verification with a newly registered Railway user confirmed `https://retirement-portfolio-omega.vercel.app/stock-research` now stays rendered after clicking `열기`; the page shows the fallback notice and analytics dashboard, with no page error, while the backend still logs the expected `domain-model` CORS/preflight failure. Screenshot saved to `test-results/stock-research-prod-after-fix.png`.

## Next Actions

- On any new PC, clone the repo, checkout `codex-handoff`, run `npm.cmd install`, then run `npm.cmd run codex:install-sync`.
- When starting a new Codex conversation, ask it to read `AGENTS.md` and `docs/codex-memory.md`.
- Configure GitHub Actions secrets for production smoke:
  - `E2E_PROD_BASE_URL`
  - `E2E_PROD_USERNAME`
  - `E2E_PROD_PASSWORD`
- Set token env vars before running ops scripts:
  - `GH_TOKEN`
  - `RAILWAY_TOKEN` or `RAILWAY_API_TOKEN`
- Redeploy Railway backend from latest `codex-handoff`, then verify `/api/version` and `/api/screener/watch-items`.
- Redeploy Railway backend from latest `codex-handoff`, then verify `/api/version`, `/api/screener/watch-items`, and `/api/portfolio/domain-model`.
- After Railway backend parity lands, re-verify production `stock-research` without the fallback notice and confirm the `domain-model` preflight/CORS path is clean.
- Continue the UI improvement plan from `docs/ui-improvement-step-plan.md` in this order:
  1. Step 4 trade log vs audit trail separation polish
  2. Step 5 analytics trust-guard rules
  3. Step 6 account-type template branching
- After the UI plan resumes, continue remaining cross-cutting report items:
  1. accessibility keyboard/ARIA audit
  2. error/empty-state message consistency
  3. BFF observability metrics implementation
  4. mobile/desktop visual QA screenshots
- Add a branded OG/social preview image before public launch if rich link previews are required.
- Keep this file updated whenever a major feature, bug, decision, or blocker appears.

## Windows PowerShell Note

If PowerShell blocks `npm run ...` with an execution policy error, use `npm.cmd run ...` instead.

## Open Questions

- None right now.
