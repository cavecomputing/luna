# Luna

A macOS desktop AI chat assistant. Electron + TypeScript + React.

Talks to any OpenAI-compatible endpoint. Two configurable models: **Fast** for quick
replies, **Expert** for harder work.

## Requirements

- macOS
- Node 22 or newer (`node -v`)
- Xcode Command Line Tools, only if you plan to sign a build

## Setup

```bash
npm install
```

That also downloads the Electron binary and enables the git hooks in `.githooks/`.
Both run from lifecycle scripts, so there is no second step.

## Develop

```bash
npm run dev
```

Launches the app with hot reload on the main, preload and renderer processes.
Editing a renderer file updates in place; editing a main file restarts the app.

## Checks

```bash
npm run typecheck   # tsc against the node and web configs
npm run lint        # eslint, zero warnings allowed
npm run test        # vitest
```

All three must pass before a change is done. While iterating, a single file is faster:

```bash
npm run test -- src/shared/prefs.test.ts
```

`npm run test:watch` reruns on save.

## Build

```bash
npm run build       # typecheck + lint + bundle to out/
npm run package     # unsigned release/mac-arm64/Luna.app, for local testing
npm run dist        # DMG in release/
```

`release/` is gitignored and large (~286 MB unpacked); delete it freely.

`npm run dist` produces an unsigned DMG unless signing credentials are in the
environment. To sign and notarize, set these before running it:

```
APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD
APPLE_TEAM_ID
```

Then set `notarize: true` in [electron-builder.yml](electron-builder.yml). Never commit
these values — see the privacy rules in [CLAUDE.md](CLAUDE.md).

## Layout

```
src/
  main/       Node context. Windows, menus, IPC handlers, privileged work.
  preload/    The contextBridge surface. The only renderer↔main door.
  renderer/   Browser context. React. No Node, no Electron imports.
  shared/     Imported by all three. Pure TypeScript, no runtime deps.
```

Conventions, security rules and the IPC contract are in [CLAUDE.md](CLAUDE.md).
Deeper architecture notes are in [docs/architecture.md](docs/architecture.md).

## Git hooks

`npm install` points git at `.githooks/`:

- **pre-commit** blocks credential files, user data, oversized blobs and key-shaped strings
- **pre-push** runs typecheck, lint and test

Re-enable them by hand with `npm run setup`. If a hook fires on something legitimate,
fix the rule in `.githooks/pre-commit` rather than passing `--no-verify`.

## License

Apache 2.0. See [LICENSE](LICENSE).
