# Development

This guide covers the day-to-day contributor workflow.

Read [CLAUDE.md](../CLAUDE.md) before changing any source file. It is the authoritative contract
for Luna's architecture, security, privacy, testing, and platform behavior. This guide only
covers commands and workflow.

## Prerequisites

- macOS, or Windows 10 or 11 (64-bit).
- Node.js version 22 or newer, which includes npm.
- Xcode Command Line Tools. Required only if you are signing a macOS build.

If you are working on Windows, also read [windows.md](windows.md).

You do **not** need Visual Studio, Python, or C++ build tools. Luna has no third-party native
Node addon. The database uses the SQLite support built into Electron's own Node runtime.

## Setup

```bash
npm install
```

This does three things:

1. Installs dependencies.
2. Downloads the Electron binary, through the `postinstall` script.
3. Points Git at the committed hooks in `.githooks/`, through the `prepare` script.

If PowerShell blocks the `npm.ps1` shim, use `npm.cmd` instead of `npm`, or run the command from
Command Prompt or Git Bash.

## Run in development

```bash
npm run dev
```

Changes to renderer code hot-reload without restarting. Changes to main-process or preload code
restart the application automatically.

`npm run dev` uses your real Luna data directory. If you want to run against throwaway data
instead, see "Running against a scratch data directory" below.

## Required checks

Run all three of these before you consider a change complete:

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm run test
```

While iterating, run one test file at a time, or use watch mode:

```bash
npm run test -- src/shared/prefs.test.ts
```

```bash
npm run test:watch
```

If a check fails, fix the cause. Do not disable the rule, loosen the TypeScript configuration,
or delete the assertion.

## Verifying user-interface changes

A change to the interface is not finished when the tests pass. You must also run the real
application and look at it.

Do not take a screenshot that contains real conversations, real names, real email addresses,
real file paths, or provider account details. Never commit such a screenshot.

### Running against a scratch data directory

This is the safest way to look at the running application, because it cannot read or modify your
real conversations. Electron's `--user-data-dir` switch redirects everything Luna stores.

```bash
npm run build && ./node_modules/.bin/electron out/main/index.js --user-data-dir=/tmp/luna-scratch
```

The first launch creates and migrates an empty database at `/tmp/luna-scratch/luna.db`. To see
the interface with content in it, quit the app, insert invented conversations into that database
with `node:sqlite`, then launch it again. Delete the directory when you are finished.

Use invented data only. Never copy your real `luna.db` into a scratch directory.

### Renderer-only preview

For a change to a single presentational component, you can render that component on its own
without starting Electron. That workflow is described in [AGENTS.md](../AGENTS.md).

## Build and package

```bash
npm run build
```

```bash
npm run package
```

```bash
npm run dist
```

- `build` runs type checking and linting, then bundles the application into `out/`.
- `package` creates an unpacked application for the current operating system, in `release/`.
- `dist` creates the distributable installer: a DMG on macOS, or an NSIS `.exe` on Windows.

Build each operating system's release artifacts on that operating system. Cross-building is not
supported here.

Both `out/` and `release/` are ignored by Git. Delete them whenever you want a clean rebuild.

### macOS signing and notarization

macOS builds are currently **unsigned and un-notarized**. `notarize` is set to `false` in
[electron-builder.yml](../electron-builder.yml).

To produce a signed and notarized DMG you need all of the following:

1. An Apple Developer Program membership.
2. A Developer ID Application certificate installed in your login keychain.
3. These three environment variables set: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and
   `APPLE_TEAM_ID`.
4. `notarize` changed to `true` in `electron-builder.yml`.

Notarization adds roughly 2 to 10 minutes to `npm run dist`, because Apple's service has to
scan the upload.

Never commit any of those credentials.

Verify a signed build before publishing it. Substitute the actual path that `npm run package`
printed; electron-builder names the directory after the architecture, such as
`release/mac-arm64/`.

```bash
codesign -dv --verbose=4 release/mac-arm64/Luna.app
```

```bash
spctl -a -vvv -t install release/mac-arm64/Luna.app
```

### Windows signing

Windows builds are x64 only, and local installers are unsigned. See [windows.md](windows.md) for
PowerShell commands, output paths, and SmartScreen behavior.

## Project layout

```text
src/
  main/       Electron lifecycle, windows, storage, IPC, and privileged work
  preload/    The narrow contextBridge surface between renderer and main
  renderer/   React interface, with no Node or Electron imports
  shared/     Pure TypeScript types and contracts used by all three
```

`shared/` must never import from `main/`, `preload/`, or `renderer/`. ESLint enforces this.

See [architecture.md](architecture.md) for the process model, persistence, IPC patterns, and
security boundaries.

## Git hooks

`npm install` points Git at the `.githooks/` directory:

- `pre-commit` blocks credential files, user data, oversized files, and strings that look like
  API keys.
- `pre-push` runs type checking, linting, and tests.

To re-enable the hooks manually:

```bash
npm run setup
```

To confirm they are active, this must print `.githooks`:

```bash
git config --get core.hooksPath
```

If a hook blocks a legitimate change, fix the rule in `.githooks/pre-commit` and say so. Do not
bypass it with `--no-verify`.
