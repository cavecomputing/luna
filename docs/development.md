# Development

This guide covers the day-to-day contributor workflow. Read [CLAUDE.md](../CLAUDE.md) before
changing source; it is the authoritative contract for Luna's architecture, security, privacy,
testing, and platform behavior.

## Prerequisites

- macOS or Windows
- Node.js 22 or newer
- npm, included with Node.js
- Xcode Command Line Tools only when signing a macOS build

Windows contributors should also read [windows.md](windows.md).

## Setup

```bash
npm install
```

Installation downloads Electron and configures the committed Git hooks. If PowerShell blocks
the `npm.ps1` shim, use `npm.cmd` or run the commands from Command Prompt or Git Bash.

## Development server

```bash
npm run dev
```

Renderer changes hot-reload. Changes to main-process or preload code restart the application.

## Required checks

Run all three before considering a change complete:

```bash
npm run typecheck
npm run lint
npm run test
```

While iterating, target a single test file or use watch mode:

```bash
npm run test -- src/shared/prefs.test.ts
npm run test:watch
```

UI and window changes also require a real application launch and visual verification on the
affected platform. Never retain or commit screenshots containing real conversations, provider
details, account identifiers, or other private data.

## Build and package

```bash
npm run build
npm run package
npm run dist
```

- `build` runs type checking and linting, then bundles the app into `out/`.
- `package` creates an unpacked app for the current operating system.
- `dist` creates a DMG on macOS or an NSIS installer on Windows.

Build release artifacts on their target operating system. The ignored `release/` directory can
be removed whenever a clean package is useful.

### macOS signing

Local DMGs are unsigned unless signing credentials are provided. For a signed and notarized
build, set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` in the environment,
then enable notarization in [electron-builder.yml](../electron-builder.yml). Never commit those
values.

### Windows packaging

Windows builds are currently x64 and local installers are unsigned. See
[windows.md](windows.md) for PowerShell commands, output paths, and SmartScreen notes.

## Project layout

```text
src/
  main/       Electron lifecycle, windows, storage, IPC, and privileged work
  preload/    The narrow contextBridge surface between renderer and main
  renderer/   React UI running without Node or Electron imports
  shared/     Pure TypeScript types and contracts shared by every process
```

See [architecture.md](architecture.md) for the process model, persistence, IPC patterns, and
security boundaries.

## Git hooks

`npm install` points Git at `.githooks/`:

- `pre-commit` blocks credential files, user data, oversized blobs, and key-shaped strings.
- `pre-push` runs type checking, linting, and tests.

Run `npm run setup` to re-enable the hooks. If a legitimate change is blocked, fix or refine the
hook instead of bypassing it with `--no-verify`.
