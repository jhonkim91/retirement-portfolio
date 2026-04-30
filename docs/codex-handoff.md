# Codex PC Handoff

This repository uses the `codex-handoff` branch to continue Codex work across multiple PCs.

## Install Auto Sync

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/codex-sync.ps1 -Mode install-task
```

The installer first tries Windows Task Scheduler. If Windows denies that permission, it falls back to a hidden Startup-folder loop.

Once installed, the sync process runs at login and periodically. It uses this flow:

```text
git fetch -> git checkout codex-handoff -> git pull --rebase --autostash -> git add -A -> git commit -> git push
```

## Daily Commands

Save current work now:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/codex-sync.ps1 -Mode save
```

Resume latest work on another PC:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/codex-sync.ps1 -Mode resume
```

Pull, commit, and push in one command:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/codex-sync.ps1 -Mode sync
```

The same commands are available through npm:

```powershell
npm.cmd run codex:sync
npm.cmd run codex:save
npm.cmd run codex:resume
npm.cmd run codex:install-sync
```

## First Setup On Another PC

```powershell
git clone https://github.com/jhonkim91/retirement-portfolio
cd retirement-portfolio
git checkout codex-handoff
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/codex-sync.ps1 -Mode resume
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/codex-sync.ps1 -Mode install-task
npm.cmd install
```

## Notes

- Avoid editing the same files on two PCs at the same time. If Git finds a conflict, auto sync stops and writes the error to `.codex-sync.log`.
- `.env`, `node_modules/`, `test-results/`, and `playwright-report/` are ignored.
- Keep ongoing work on `codex-handoff`, then merge or open a PR into `main` when it is ready.
