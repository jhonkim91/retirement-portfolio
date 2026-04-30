# Retirement Portfolio Frontend

React client for the retirement portfolio workspace.

## Common Commands

```powershell
npm.cmd install
npm.cmd start
npm.cmd test -- --watchAll=false
npm.cmd run build
```

From the repository root, prefer the shared scripts:

```powershell
npm.cmd run test:frontend
npm.cmd run build:frontend
```

## Notes

- The app is a Create React App project, but the default CRA boilerplate content has been removed.
- Production builds are emitted to `frontend/build/`, which is intentionally ignored.
- Local env files and generated dependency folders are intentionally ignored.
