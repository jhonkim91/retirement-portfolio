# Codex Shared Memory

Last updated: 2026-04-30 19:01 KST

## Current State

- Work is synchronized through the `codex-handoff` branch.
- The current PC has Startup-folder auto sync enabled because Windows Task Scheduler registration was denied.
- Background auto sync runs `scripts/codex-sync.ps1` periodically.
- The latest shared work has been pushed to GitHub on `origin/codex-handoff`.
- Report-tracker status was refreshed against current code: Import Center user flow is now marked complete, mobile polish is marked first-pass complete, and remaining work is split into visual QA/accessibility/error-state/BFF observability/deployment validation.
- Backend Python dependencies were installed from `backend/requirements.txt` on this PC so backend tests can run locally.
- Cleanup pass completed: CRA boilerplate/test/logo assets and static `example.com` placeholders were removed or replaced. Local generated logs, caches, build output, test results, root dummy DBs, and backend test DBs were deleted. `.env`, dependency folders, and `backend/instance/retirement.db` were intentionally kept.

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
- Continue remaining partial report items in this order:
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
