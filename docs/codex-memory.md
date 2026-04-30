# Codex Shared Memory

Last updated: 2026-04-30 17:50 KST

## Current State

- Work is synchronized through the `codex-handoff` branch.
- The current PC has Startup-folder auto sync enabled because Windows Task Scheduler registration was denied.
- Background auto sync runs `scripts/codex-sync.ps1` periodically.
- The latest shared work has been pushed to GitHub on `origin/codex-handoff`.

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

## Next Actions

- On any new PC, clone the repo, checkout `codex-handoff`, run `npm.cmd install`, then run `npm.cmd run codex:install-sync`.
- When starting a new Codex conversation, ask it to read `AGENTS.md` and `docs/codex-memory.md`.
- Keep this file updated whenever a major feature, bug, decision, or blocker appears.

## Windows PowerShell Note

If PowerShell blocks `npm run ...` with an execution policy error, use `npm.cmd run ...` instead.

## Open Questions

- None right now.
