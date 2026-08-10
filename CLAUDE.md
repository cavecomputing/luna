# Luna

A desktop AI chat assistant for macOS and Windows. Electron + TypeScript + React. The layout,
commands, security boundaries, and platform rules below are the contract for ongoing work.

Deep reference (read on demand, do not preload): [docs/architecture.md](docs/architecture.md).
Windows setup and packaging reference: [docs/windows.md](docs/windows.md).

## What Luna is

A native-feeling chat client for talking to an LLM. Two-pane window: a conversation list on
the left, the active thread on the right. Design direction lives in
[assets/concepts/appConcept.png](assets/concepts/appConcept.png) — read it before building UI.

Surfaces, in build order:

1. **Chat thread** — user and assistant messages, timestamps, streamed assistant output,
   markdown rendering (lists, code blocks, links) **and HTML rendering**. Both are required,
   not optional polish. See **Rendering model output** below.
2. **Conversation list** — searchable, relative timestamps, per-conversation icon, new-chat
   button, collapsible sidebar.
3. **Composer** — multiline input, attachments, send. Enter sends, Shift+Enter newlines.
4. **Mode switch** — `Fast` and `Expert`, a per-conversation model choice.
5. **Settings** — a separate window (`CmdOrCtrl+,`), not an in-app pane. Providers, the two model
   slots, sampling, appearance, privacy.

Deliberately not built: suggestion chips under assistant messages. Removed once the
model config took shape — don't reintroduce without asking.

Identity: blue `#2563EB` accent, white surfaces, rounded cards, generous whitespace, a fox
mascot. Light and dark both ship. Ask before adding a surface that isn't on that list.

Settled behaviour, decided — don't relitigate these while building:

- **Message actions are a right-click context menu.** Not hover-reveal buttons, not a
  permanently visible row of icons. Use a native `Menu.popup()` from main, requested over
  IPC, so it looks and behaves like the host operating system.
- **Conversation titles come from the Fast model**, generated after the first exchange.
  The `autoTitle` pref governs it.
- **Mode is stored per conversation and restored on reopen.** Reopening a thread puts the
  switch back where the user left it, whatever the current `defaultMode` is — that pref only
  seeds a *new* chat. Nothing about a conversation should change while it wasn't being looked
  at. Not implemented until conversations persist; the `mode` column carries it.

Because Luna handles the user's private conversations and their API credentials, the
**Privacy and secrets** section below is not optional.

## Commands

```
npm install          # deps + electron binary + git hooks, all via lifecycle scripts
npm run dev          # electron-vite dev, HMR on main + preload + renderer
npm run typecheck    # tsc --noEmit against tsconfig.node.json and tsconfig.web.json
npm run lint         # eslint --max-warnings 0
npm run test         # vitest run
npm run build        # typecheck + lint + electron-vite build
npm run package      # electron-builder, unpacked app for the current operating system
npm run dist         # DMG on macOS; NSIS installer on Windows
npm run setup        # re-enable git hooks by hand; `prepare` already does this
```

On Windows PowerShell, use `npm.cmd` if the local execution policy blocks the `npm.ps1` shim.

Prefer a single test file (`npm run test -- src/main/ipc/app.test.ts`) over the full suite
while iterating.

e2e is not wired yet. When it is, it's Playwright against the packaged app as `test:e2e`,
and it joins the definition of done below.

## Stack

Electron 43 · TypeScript 6.0 · React 19 · Vite 7 / electron-vite 5 · electron-builder 26 ·
Vitest 4 · ESLint 10 flat config.

Two version ceilings are deliberate. Do not raise either without checking peer ranges first:

- **Vite stays on 7.** electron-vite 5 declares `vite: ^5 || ^6 || ^7`.
- **TypeScript stays on 6.0.** typescript-eslint 8 declares `typescript: >=4.8.4 <6.1.0`.
  TS 7 exists, but taking it would cost type-aware linting, which is worth more here.

ESM everywhere (`"type": "module"`) with one exception: **the preload bundle is CommonJS**
(`out/preload/index.cjs`). Electron cannot load an ESM preload when `sandbox: true`, and
sandbox stays true. This is set in `electron.vite.config.ts` — don't "fix" it.

Electron ships its own Node and Chromium — never assume the host's Node version is what runs
at runtime.

**Install gotcha:** Electron 43 has no `postinstall` of its own; it exposes an
`install-electron` bin. Our `postinstall` calls it. Without that, `node_modules/electron`
installs with no actual binary and every launch fails.

## Layout

```
src/
  main/        # Node context. Windows, menus, OS integration, privileged work.
    index.ts       # entry: app lifecycle only, ~100 lines max
    window.ts      # window creation + state restore
    menu.ts        # native app menu
    ipc/           # one file per domain, each exporting register()
  preload/
    index.ts       # contextBridge surface. The ONLY renderer↔main door.
  renderer/    # Browser context. No Node, no Electron imports, ever.
    app.tsx
    ui/            # dumb presentational components
    features/      # one folder per feature: components + hooks + local state
    lib/           # renderer-only helpers
  shared/      # imported by all three. Pure TS, zero runtime deps.
    ipc.ts         # channel names + request/response types (the IPC contract)
    types.ts
    result.ts
```

`shared/` must never import from `main/`, `preload/`, or `renderer/`. Enforced by lint.

## Process model — non-negotiable

Every `BrowserWindow` uses: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`,
`webSecurity: true`. Never flip one of these to make something work — move the work to main
and expose it over IPC instead.

- Renderer talks to main **only** through the preload bridge. No `ipcRenderer` in the renderer.
- Never expose `ipcRenderer` or any Electron object through `contextBridge`. Expose named
  functions that wrap specific channels.
- Validate every IPC payload in main before acting on it. Treat the renderer as untrusted.
- Validate `event.senderFrame` on privileged handlers.
- Set a CSP; no `unsafe-inline`, no `unsafe-eval`.
- `will-navigate` and `setWindowOpenHandler` deny everything by default; allowlist explicitly.
- `shell.openExternal` only after checking the URL is `https:`.
- Load the renderer over a custom protocol in production, not `file://`.

## IPC contract

All channels are declared once in `src/shared/ipc.ts` as a typed map. Main registers handlers
against that map, preload wraps it, renderer consumes the typed bridge. Adding a channel means
editing one type — the compiler then tells you every place that must change.

- Two-way work: `ipcRenderer.invoke` / `ipcMain.handle`. Default to this.
- Fire-and-forget: `send` / `on`. Only when a response genuinely doesn't matter.
- Main → renderer push: `webContents.send`, with the preload exposing a subscribe function that
  returns an unsubscribe.
- Handlers return `Result<T>` (see `shared/result.ts`), never throw across the boundary.
  A rejected `invoke` loses the error type and leaks stack traces into the renderer.

Full pattern with code: [docs/architecture.md](docs/architecture.md#ipc).

## Settings apply immediately — YOU MUST

Every setting takes effect the moment it changes, in every window. No restart, no reload, no
"takes effect next launch". If a control is on screen, flipping it changes behaviour now.

This is harder than it is on a web page, and the reason is Electron-specific. Luna runs **two
renderer processes** — the main window and Settings — each with its own React tree and its own
memory. A write in Settings does not reach the main window on its own. Nothing warns you: the
Settings window shows the new value, looks correct, and the main window quietly keeps the old
one until it is reloaded. That silent divergence is what this section exists to prevent.

**The shape that works:**

1. Main owns the value. `main/prefs.ts` is the single source of truth. A renderer never holds
   the authoritative copy, only a view of it.
2. A renderer changes a setting by invoking `prefs:set`. It does not write to its own state and
   assume the rest of the app followed.
3. Main writes, re-applies any main-side effect, then **broadcasts to every window** —
   `broadcast()` in `ipc/bus.ts` — so the change reaches renderers that had no part in making
   it. Store first, announce second: nothing is announced that wasn't written.
4. Every renderer subscribes and re-renders from the pushed value. The window that made the
   change is not special; it learns about it the same way as the others.

**Read a value at use time, not at mount time.** A pref captured in `useState(initial)`, in a
module-level `const`, or in a stale closure is frozen at the moment it was captured. When the
composer sends a message it reads the current mode, not the one that existed when the
conversation was opened.

**Never hand a setting to a window at construction** — not through `additionalArguments`, not
through a query string. A value delivered that way cannot change without recreating the window,
which is the reload we are avoiding.

**Say so when something genuinely cannot apply live.** A few Electron options are fixed when the
`BrowserWindow` is constructed — `titleBarStyle`, anything under `webPreferences`. If a setting
ever maps to one of those, recreate the window as part of applying it or label the control with
what it needs. A control that silently does nothing is worse than no control at all.

**A setting is not done until propagation is tested.** Asserting that the value reached disk
misses the entire failure mode. Assert that the broadcast fires and carries the new value.

This is built. `prefs:changed` is declared in `shared/ipc.ts`, `broadcast()` in `ipc/bus.ts`
sends it to every window, and `lib/use-prefs.ts` subscribes — so both windows follow a change
made in either. Copy that path for the next thing that needs it; don't invent a second one.

Note that theme is not evidence the path works. `nativeTheme.themeSource` flips Chromium's
`prefers-color-scheme` for every window at once and the CSS follows without our state being
involved, so theme would appear to work even with the broadcast removed. Test a pref that goes
through React — `defaultMode` is the one currently wired end to end.

## Naming

Short and plain. If a name needs more than three words, the function is doing too much.

- Functions: verb-first, ≤ 3 words. `loadPrefs`, `pickFile`, `showWindow`, `isDark`.
- No `Manager` / `Service` / `Helper` / `Util` / `Handler` suffixes on classes or files.
  Name the thing after what it holds: `prefs.ts`, `updater.ts`, `db.ts`.
- No `handleClickSubmitButtonForForm`. Use `onSubmit`.
- Booleans read as predicates: `isReady`, `hasFocus`, `canQuit`.
- Files kebab-case, one clear subject per file. Types PascalCase, values camelCase.
- IPC channels are `domain:verb` — `files:pick`, `prefs:get`, `window:minimize`.
- Don't abbreviate past recognition (`cfg` fine, `pfmc` not).

## Storage — SQLite

**Everything persistent lives in one SQLite database**: conversations, messages, settings,
themes, provider configuration. Not JSON files, not `localStorage`, not a mix.

Use **`node:sqlite`**, the module built into Node. Electron 43 ships Node 24.18 and the
module is present and working (verified: SQLite 3.53.1). That means **no `better-sqlite3`**
and no native module — nothing to rebuild per Electron version, nothing extra in the bundle,
no new attack surface. Don't add a SQLite package.

- The database file lives under `app.getPath('userData')`. Main opens it; it is never
  touched from preload or the renderer.
- `node:sqlite` is synchronous. That's fine for indexed reads and single-row writes, which
  take microseconds. It is not fine for bulk import/export or a full-text scan — those go to
  a `worker_threads` worker so the main process never blocks a window.
- Write schema migrations as ordered, numbered steps with a `user_version` check. Never
  mutate a schema in place at startup without a migration.
- **Migrations run on main, at startup, before the first window exists.** The worker rule
  above does not apply to them: there is no window to block yet, and a failure belongs in the
  startup path where it can stop the app cleanly. `migrate()` takes a database handle and
  returns a number, so moving it into a worker later is a change at the call site only.
- Each migration step commits with its own `user_version` bump. SQLite keeps that value in the
  file header and rolls it back with the transaction (verified), so an interrupted migration
  leaves a database that is behind rather than half-applied.
- A database whose `user_version` is ahead of this build is refused, not opened. Downgrading
  the app must not let it write a shape it doesn't understand.
- Turn on `PRAGMA journal_mode = WAL` and `foreign_keys = ON`.
- Parse every row on the way out. A column is `unknown` until validated, exactly like IPC
  and disk elsewhere. Rows are not typed by assertion.
- **API keys never go in the database.** They stay in platform secure storage via
  `safeStorage` (Keychain on macOS, DPAPI-backed storage on Windows). The database may hold a
  provider's name, base URL and model — never its credential.

Preferences live in the `prefs` table, one row per field, JSON-encoded so strings and booleans
both round-trip. There is no in-memory cache: a single-row read takes microseconds, and a cache
is one more place a value can go stale.

`prefs.json` is gone. `adoptLegacy()` folds an existing file into the database on first launch
and deletes it, so a setting never has two homes. Leave that function in place until the
installed base has run it once; it is a no-op on every launch after the first.

## Rendering model output — YOU MUST

Model output is untrusted input. It arrives over the network, and the renderer that displays
it also holds the `window.luna` bridge.

- **Never** put model text through `dangerouslySetInnerHTML`, `innerHTML`, or any equivalent
  in our own DOM. One crafted reply then reaches the preload bridge, which is the whole
  attack we designed the process model to prevent.
- **HTML previews render in a sandboxed `<iframe>`** — `sandbox` without `allow-same-origin`,
  a `srcdoc` payload, and its own restrictive CSP. No preload is attached to that frame. It
  cannot reach our origin, our bridge, or the network.
- HTML appears **inside a code block**, with a toggle to switch between **source** and
  **rendered**. Source is the default. The user opts in to rendering; it never happens
  automatically.
- Markdown needs a real parser eventually. That's a production dependency — ask first, and
  sanitise any inline HTML it passes through.
- Links inside rendered output never navigate the frame. Route them through
  `shell.openExternal` after the `https:` check.

## Renderer conventions

- **CSS Modules, one per component**, colocated as `thing.module.css`. No global stylesheet
  beyond the two in `styles/`: `tokens.css` (every colour, radius, spacing step, both themes)
  and `base.css` (reset). A component that needs a colour references a token — never a hex.
- Compose class names with `cx()` from `lib/cx.ts`. Template literals embed the string
  `"undefined"` when a CSS module key misses, because `noUncheckedIndexedAccess` types those
  lookups as `string | undefined`.
- **One file per icon** in `ui/icons/`. They take `size` and draw in `currentColor` so they
  re-tint for dark mode. `ui/chat-glyph.tsx` holds the per-conversation set and is the single
  swap point if those become raster art.
- `ui/` is dumb and reusable and holds no feature knowledge. `features/<name>/` owns its own
  components, hooks and state. State shared by two features is lifted to `app.tsx`, not put
  in a store.
- Dark tokens live in one `@media (prefers-color-scheme: dark)` block in `tokens.css`. Main
  applies the stored preference and defaults it to light, so keep that block correct. Don't
  branch on theme in JS.
- Never call `Date.now()` during render — it is impure and freezes relative timestamps at the
  last re-render. Use `useNow()`.
- On macOS, any header that can sit at the window's left edge must clear the traffic lights
  (see `.inset` in `app.module.css`). Do not apply that inset to the standard Windows title bar.

## Code shape

- A function does one thing and fits on a screen. If you're scrolling it, split it.
- Extract a helper the **second** time you need it, not the first. Speculative abstraction is
  worse than duplication here.
- Helpers live next to their only consumer until a second consumer appears, then move up to
  the nearest shared `lib/`.
- Pure functions by default. Push I/O and Electron API calls to the edges so the middle is testable.
- Named exports only. No default exports — they break rename refactors and grep.
- Feature folders own their state. Don't add global state for something one feature uses.
- Prefer plain objects and functions over classes. Use a class only for something with real
  lifecycle (a window controller, a connection pool).

## TypeScript

`strict: true` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
`noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules`.

- `any` is banned. Use `unknown` and narrow. If you truly need an escape hatch, it's
  `// eslint-disable-next-line` with a one-line reason.
- No non-null `!`. Handle the undefined case or restructure so it can't occur.
- No type assertions to silence the compiler. An assertion means you know something the
  compiler doesn't — write down why, or fix the types.
- Parse external data (disk, network, IPC) with a validator; don't cast JSON into a type.
- `import type { … }` for type-only imports.
- Discriminated unions over optional-field soup.

## Node

- `node:` prefix on all builtins — `import { readFile } from 'node:fs/promises'`.
- Async I/O only. A sync call in main freezes every window.
- CPU-heavy work goes to a `worker_threads` worker or a utility process, never inline in main.
- User data belongs under `app.getPath('userData')`. Never write next to the app bundle.
- Lazy-`import()` anything heavy that isn't needed at startup; top-level imports in main are
  the single biggest startup cost.
- Keep dependencies few. Every prod dep ships to users and is attack surface — prefer the
  stdlib or 20 lines of our own code over a package.

## Platform behavior

Shared rules:

- **Light is the default.** Main applies the persisted light / dark / system preference through
  `nativeTheme`; do not make platform-specific theme branches in the renderer.
- Use the cross-platform font stack in `tokens.css`; platform-native fonts should win naturally.
- Persist and restore window bounds across launches on both operating systems.

### macOS

- Window: `titleBarStyle: 'hiddenInset'`, `trafficLightPosition` tuned to our chrome height,
  content drawn behind the title bar.
- Build a real app menu with standard roles (`about`, `services`, `hide`, `quit`, edit roles).
  Missing roles break ⌘C/⌘V and feel broken.
- App stays alive on last window close; the dock icon stays put and `activate` recreates a
  window. Only `window-all-closed` → quit on non-darwin. Luna is an ordinary windowed app,
  not a menu bar app — don't hide the dock icon or add a tray.
- Ship arm64 and x64 DMGs with hardened runtime and notarization. Entitlements stay minimal —
  add one only when a feature actually needs it, and note why in the entitlements file.

### Windows

- Use the standard Windows title bar and native minimize, maximize, and close controls. The
  macOS `hiddenInset` and `trafficLightPosition` options must remain conditional on `darwin`.
- Quit when the last window closes. Do not add a tray or background-app lifecycle unless the
  product requirements explicitly change.
- Package x64 with NSIS. The unpacked app lives under `release/win-unpacked/`; `npm run dist`
  creates `release/Luna-Setup-<version>-x64.exe`.
- Local builds are unsigned and may trigger SmartScreen. Public releases need Authenticode
  signing credentials kept outside the repository.
- Git hooks remain POSIX shell scripts. Git for Windows supplies their runtime; npm invokes the
  cross-platform `scripts/setup-hooks.mjs` installer, so `sh` need not be on PowerShell's PATH.

## Errors and logging

- `Result<T, E>` across the IPC boundary and for anything expected to fail (missing file,
  bad input). Throw only for programmer error.
- Errors carry a stable `code` string. The renderer switches on `code`, never on message text.
- One logger in main. Never `console.log` in shipped code.
- Wire `process.on('uncaughtException')` and `unhandledRejection` in main, plus
  `render-process-gone` and `child-process-gone`.
- Never put a file path, token, or user content in a message shown to the user or sent to a
  crash reporter.

## Privacy and secrets — YOU MUST

Luna holds the user's private conversations and their paid API keys. A leak here is not a bug,
it is a breach.

**Never commit:**

- API keys, tokens, or any credential. Not in code, not in a config file, not in a comment,
  not in a test fixture, not in a commit message.
- Signing certificates, provisioning profiles, `.env` files.
- Real conversation data, chat exports, database files, or logs from a real session.
- Screenshots containing a real conversation, a real name, or a real email address.

**Where secrets live:** API keys go into platform secure storage through Electron's
`safeStorage` (Keychain on macOS, DPAPI-backed storage on Windows), written and read **only** in
main. They never enter `shared/`, never enter preload, never cross IPC to the renderer, and never
land in a plain file under `userData`. The renderer asks main to make a request; it never sees
the key. Settings UI writes a key by sending it to main once and shows a masked placeholder
afterward, never the value.

**Logging:** never log message content, prompt text, completion text, file paths from the
user's disk, or a key — not even a prefix of a key, not even in dev. Log channel names, error
codes, and durations. If you need to debug content, do it locally and delete it before commit.

**Before any commit:**

- Run `git status` and read the untracked list. Never `git add -A` or `git add .` without
  looking at what it picks up.
- Run `git diff --cached` before committing and scan for anything that looks like a key,
  a token, an email address, or real chat text.
- If a file is personal and not covered by `.gitignore`, add it to `.gitignore` first, then
  tell me. Don't commit it and clean up after.

**If a secret is ever committed:** say so immediately and treat the key as burned. It must be
rotated at the provider. Rewriting git history does not undo the exposure.

**Git hooks.** `.githooks/pre-commit` blocks credential files, user data, oversized blobs, and
key-shaped strings. `.githooks/pre-push` runs typecheck, lint, and test. Both are committed and
enabled by `node scripts/setup-hooks.mjs`, which `package.json` must run from `prepare` so a fresh
clone gets them on `npm install`:

```json
"scripts": {
  "prepare": "node scripts/setup-hooks.mjs",
  "setup":   "node scripts/setup-hooks.mjs"
}
```

Never use `--no-verify` to get past a hook without telling me what it flagged and why it's a
false positive. If a rule is wrong, fix the rule in `.githooks/pre-commit` and say so — don't
route around it. Hooks are a backstop for accidents; the rules above are still yours to follow.

Test fixtures use synthetic data only. Invented names, `example.com` addresses, fake keys with
an obvious `test-` prefix. Never a real export, never a redacted real export.

## Testing

Tests are not optional and are not a follow-up task. A feature is not done until it has them.

**Tools**
- Vitest for unit and integration tests, colocated as `thing.test.ts` next to the source.
- Playwright for e2e against the packaged app.
- `npm run test` must pass before you report any change complete.

**What must have a test**
- Every IPC handler in `src/main/ipc/`. One test for the success path, one per `Err` code it
  can return.
- Everything in `src/shared/`. It is pure, so there is no excuse.
- Streaming: partial chunk assembly, mid-stream cancel, mid-stream error, out-of-order arrival.
  This is where a chat app actually breaks.
- Conversation persistence: save, reload, and a corrupt-file-on-disk case.
- Any React hook holding real logic. Use `@testing-library/react`.

**What not to test**
- Electron itself. Assume `dialog.showOpenDialog` works.
- Presentational components with no logic. Snapshot tests of markup rot and prove nothing.
- Third-party libraries.

**How to write them**
- Write the test name as the behavior: `returns file/denied for a path outside userData`.
  Not `test1`, not `works`.
- Arrange, act, assert. One behavior per test.
- Structure code so the test doesn't need Electron: keep handler bodies as plain functions
  that take their inputs and return a `Result`, then register them separately. If a test needs
  heavy mocking, that's the code's fault — restructure it.
- Mock the network at the boundary. Never let a test hit a real LLM API. A test that costs
  money or needs a key is a broken test.
- Tests must be deterministic. No real timers, no real clock, no random without a seed.

**Rules**
- A bug fix starts with a failing test that reproduces the bug. Write it, watch it fail, then
  fix the code. A fix without a reproducing test will regress.
- Never delete or `.skip` a failing test to get a green run. Fix the cause or report the
  failure to me.
- Never weaken an assertion to make it pass.
- New file in `src/main/ipc/` or `src/shared/` with no matching `.test.ts` is incomplete work.

## Definition of done — YOU MUST

Before reporting any code change as complete, run and show output for:

```
npm run typecheck && npm run lint && npm run test
```

If a check fails, fix the cause — never suppress the rule, loosen the tsconfig, or delete the
assertion. If you can't get a check passing, say so explicitly with the failing output rather
than reporting success.

For UI or window changes, also launch the app and screenshot it before claiming it works.

Before any commit, additionally run `git status` and `git diff --cached` and confirm nothing
personal or secret is staged.

## Anti-patterns — do not

- Commit a key, a `.env`, a real conversation, or anything else from the privacy section.
- Add `better-sqlite3` or any other SQLite package. `node:sqlite` is built in.
- Render model HTML into our own DOM. Sandboxed iframe or nothing.
- Store a credential in the database, or any setting outside it.
- Ship a setting that needs a reload or restart, or a control that changes nothing.
- Let one window's copy of a setting drift from another's. Main broadcasts; every window listens.
- `git add -A` / `git add .` without reading what it staged.
- Put an API key anywhere outside main + platform `safeStorage`.
- Log prompt text, completion text, or a user file path.
- Disable `contextIsolation` / `sandbox`, or enable `nodeIntegration`.
- Import `electron` or any `node:` module in `src/renderer/`.
- Add `@electron/remote`.
- Reach into the DOM from main, or into Electron from a React component.
- Create a `utils.ts` grab bag.
- Add a state library, ORM, or CSS framework without asking first.
- Leave `TODO` or commented-out code in a change you're calling done.
- Write a barrel `index.ts` that re-exports a whole folder — it wrecks tree-shaking and
  creates import cycles.
- Bump Electron or a major dep as a side effect of another task.

## Working with me

- Small task with an obvious diff: just do it.
- Multi-file or unfamiliar area: explore and plan first, then implement.
- When a pattern already exists in this repo, follow it rather than introducing a second way.
- Prefer editing an existing file over creating a new one.
- Ask before adding a dependency, changing the build config, or touching signing/entitlements.
- Update this file when we settle a convention that isn't written down yet.
