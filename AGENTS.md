# Project Instructions For Codex

This repository is shared across PCs through the `codex-handoff` branch.

At the start of each Codex session:

1. Run `npm.cmd run codex:sync` on Windows PowerShell, or `npm run codex:sync` in cmd/Git Bash.
2. Read `docs/codex-memory.md`.
3. Continue from the latest "Next Actions" and "Current State" notes.

Before ending a Codex session:

1. Update `docs/codex-memory.md` with important decisions, changed files, blockers, and next actions.
2. Run `npm.cmd run codex:save` on Windows PowerShell, or `npm run codex:save` in cmd/Git Bash.

Do not commit secrets or generated dependency/output folders. `.env`, `node_modules/`, `test-results/`, and `playwright-report/` are intentionally ignored.

Use `codex-handoff` for ongoing work. Merge or open a PR into `main` only when the work is ready.
