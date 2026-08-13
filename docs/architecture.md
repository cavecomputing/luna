# Luna architecture reference

Detail behind the rules in [CLAUDE.md](../CLAUDE.md). Read the section you need; don't load
the whole file into context by habit.

---

## Processes

Three build targets, three runtimes, three tsconfigs.

| Target     | Runtime          | Can import                        | Job                                  |
| ---------- | ---------------- | --------------------------------- | ------------------------------------ |
| `main`     | Node             | `node:*`, `electron`, `shared/`   | Windows, menus, filesystem, OS APIs  |
| `preload`  | Isolated bridge  | `electron` (bridge only), `shared/` | Expose a narrow, typed API           |
| `renderer` | Chromium sandbox | `shared/`, React, DOM             | UI only                              |

The preload runs in its own context with access to a subset of Electron. It is the entire
attack surface between untrusted page content and the OS. Keep it boring: no logic, no
branching on user data, just typed wrappers.

---

## IPC

### 1. Declare the contract once

`src/shared/ipc.ts` is the single source of truth. Everything else derives from it.

```ts
export type Invocations = {
  'prefs:get': { req: void; res: Prefs }
  'prefs:set': { req: Partial<Prefs>; res: Prefs }
  'files:pick': { req: { exts: string[] }; res: string | null }
  'files:read': { req: { path: string }; res: string }
}

export type Events = {
  'theme:changed': { dark: boolean }
  'update:progress': { pct: number }
}

export type Channel = keyof Invocations
export type Req<C extends Channel> = Invocations[C]['req']
export type Res<C extends Channel> = Invocations[C]['res']
```

Adding a feature = adding a line here. The compiler then flags the missing handler and the
missing bridge method.

### 2. Result type

`src/shared/result.ts`. Nothing throws across the boundary.

```ts
export type Ok<T> = { ok: true; value: T }
export type Err = { ok: false; code: string; message: string }
export type Result<T> = Ok<T> | Err

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value })
export const err = (code: string, message: string): Err => ({ ok: false, code, message })
```

`code` is stable and switchable (`'file/not-found'`, `'prefs/invalid'`). `message` is for logs
and never contains a path or user content.

### 3. Register in main

One file per domain under `src/main/ipc/`, each exporting `register()`.

```ts
// src/main/ipc/files.ts
export function register() {
  handle('files:read', async (_e, { path }) => {
    if (!isAllowed(path)) return err('file/denied', 'path outside allowed roots')
    try {
      return ok(await readFile(path, 'utf8'))
    } catch {
      return err('file/not-found', 'read failed')
    }
  })
}
```

`handle` is a thin typed wrapper over `ipcMain.handle` living in `src/main/ipc/bus.ts`. It
does three things: types the channel against `Invocations`, checks `event.senderFrame`
against our own origin, and catches anything that escapes into an `Err`.

Each new domain file gets one line in `src/main/ipc/index.ts`.

### 4. Bridge in preload

```ts
// src/preload/index.ts
const api = {
  prefs: {
    get: () => invoke('prefs:get', undefined),
    set: (p: Partial<Prefs>) => invoke('prefs:set', p),
  },
  files: {
    pick: (exts: string[]) => invoke('files:pick', { exts }),
    read: (path: string) => invoke('files:read', { path }),
  },
  onTheme: (fn: (e: Events['theme:changed']) => void) => subscribe('theme:changed', fn),
}

contextBridge.exposeInMainWorld('luna', api)
export type LunaApi = typeof api
```

Note `onTheme` takes a callback and returns an unsubscribe. Never pass the raw listener to
`ipcRenderer.on` — the first argument is an `IpcRendererEvent` carrying `sender`, which hands
the renderer a way back into the IPC system.

`subscribe` wraps it:

```ts
function subscribe<K extends keyof Events>(ch: K, fn: (data: Events[K]) => void) {
  const wrapped = (_e: IpcRendererEvent, data: Events[K]) => fn(data)
  ipcRenderer.on(ch, wrapped)
  return () => ipcRenderer.off(ch, wrapped)
}
```

### 5. Type the renderer

```ts
// src/renderer/global.d.ts
declare global {
  interface Window { luna: import('../preload').LunaApi }
}
```

Renderer code calls `window.luna.files.read(p)` and gets a `Result<string>` back with full
types. It never imports `electron`.

---

## Windows

`src/main/window.ts` owns creation and bounds persistence.

```ts
const win = new BrowserWindow({
  width, height, x, y,
  minWidth: 720, minHeight: 480,
  show: false,
  titleBarStyle: 'hiddenInset',
  trafficLightPosition: { x: 16, y: 16 },
  backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f5f5f7',
  webPreferences: {
    preload,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
  },
})

win.once('ready-to-show', () => win.show())
```

`show: false` + `ready-to-show` avoids the white flash on launch. Set `backgroundColor` to
match the theme so the pre-paint frame isn't wrong either.

Bounds are saved debounced on `resize`/`move` and validated against
`screen.getAllDisplays()` on restore — a saved position from a disconnected monitor puts the
window off-screen.

Navigation lockdown, applied to every window:

```ts
win.webContents.setWindowOpenHandler(({ url }) => {
  if (url.startsWith('https://')) shell.openExternal(url)
  return { action: 'deny' }
})
win.webContents.on('will-navigate', (e, url) => {
  if (new URL(url).origin !== APP_ORIGIN) e.preventDefault()
})
```

---

## Renderer loading

Dev: `loadURL(process.env.ELECTRON_RENDERER_URL)` — Vite dev server, HMR.

Prod: register a custom scheme (`app://`) with `protocol.handle` and serve the built assets
from it. This gives a real origin, so CSP, service workers, and same-origin checks behave
normally — `file://` gives you none of that and grants broader read access if the renderer is
ever compromised.

CSP, set as a response header from the protocol handler:

```
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'
```

If a feature needs a wider CSP, that's a design conversation, not a quick edit.

---

## State

- **Ephemeral UI state** → React `useState` inside the feature folder.
- **Shared UI state** → a context per feature. Not one global store.
- **Persisted prefs** → main owns them, on disk under `app.getPath('userData')`. Renderer reads
  via `prefs:get` and writes via `prefs:set`. Main is the only writer.
- **Anything the OS knows** (theme, window size, online status) → main pushes it over an event
  channel; renderer subscribes.

Main is the source of truth for anything that must survive a reload. The renderer can be torn
down and rebuilt at any time.

---

## Chat: streaming, storage, keys

### Who does what

The renderer never talks to the LLM provider. Main owns the API key, makes the request, and
streams tokens back over an event channel. This is not a style choice: a key in the renderer
is a key inside a sandboxed web context, one XSS away from exfiltration.

```
renderer                 main                      provider
   │ chat:send ────────────>│
   │                        │ POST /responses or /chat/completions ──>│
   │<── chat:delta ─────────│<──── token stream ───────│
   │<── chat:delta ─────────│
   │<── chat:done ──────────│
```

Channels:

```ts
export type Invocations = {
  'chat:send':   { req: { conversationId: string; text: string }; res: ChatStart }
  'chat:cancel': { req: { messageId: string }; res: undefined }
}

export type Events = {
  'chat:delta': { conversationId: string; messageId: string; text: string; seq: number }
  'chat:done':  { conversationId: string; message: Message }
  'chat:error': { conversationId: string; message: Message; code: string }
}
```

`chat:send` first inserts the user message and an assistant placeholder in one SQLite
transaction, then returns their ids. Delta events carry the full text accumulated so far and a
monotonic sequence number. Replacing by id and ignoring older sequence numbers keeps delayed
IPC events from corrupting the visible reply.

Every stream must be cancellable. Main keeps an `AbortController` per `msgId`; `chat:cancel`
aborts it. A stream that can't be stopped is a stuck UI and a wasted bill.

Handle these, they all happen in practice: the user sends a second message mid-stream, the
window closes mid-stream, the network drops mid-stream, the provider returns a 429 after
partial output. Each needs a defined end state, and each needs a test.

### Storage

Conversations and messages live in `luna.db` under `app.getPath('userData')`. Main is the only
reader and writer. Foreign keys cascade message deletion with its conversation. A streaming
assistant row is finalized exactly once as `complete`, `cancelled`, or `error`; an unfinished
row found on the next launch is recovered as `error`.

Explicit `<think>…</think>` markup from compatible models is parsed from accumulated stream
text, so either tag may be split across SSE chunks without flashing fragments. Reasoning is
stored separately from the final answer and rendered in a collapsible disclosure. Chat
Completions history receives only the answer text.

Responses requests use local manual history with `store: false`. Along with visible assistant
text, main stores the Responses output items needed to replay reasoning context on the next
turn. Those provider items never cross IPC. Chat Completions history is rebuilt from the same
visible user and assistant rows.

Keep message content out of anything that leaves the machine. Crash reports get the error code
and the stack, never the conversation.

### Export format

Two paths write the same format. A conversation's context menu exports one file; Privacy settings
exports every conversation into a folder the user picks:

```
Luna Export 2026-08-13/
  manifest.json
  conversations/
    Weekend notes.json
    Weekend notes 2.json      # titles collide; names are numbered, case-insensitively
```

Each conversation file is `{ format: 'luna-conversation', version: 1, exportedAt, conversation }`,
where `conversation` carries `title`, `mode`, `updatedAt`, and `messages`. A message has `role`,
`text`, optional `reasoning`, `status`, `at`, and `attachments` — each attachment inlined as
`{ name, kind, mediaType, size, encoding: 'base64', data }`. Timestamps are ISO strings.

`manifest.json` is `{ format: 'luna-export', version: 1, exportedAt, app, conversations }`, listing
each written file with its title, `updatedAt`, and message count. It is written last, so an
interrupted export is visibly incomplete.

Never exported: API keys, provider metadata and base URLs, preferences, internal ids, unsent
drafts, pinned state, and the Responses `provider_items` replay data. Filenames come from the
conversation title, sanitized for both operating systems — control characters and `<>:"/\|?*`
replaced, trailing dots and spaces trimmed, Windows reserved device names prefixed.

Bulk export serializes one conversation at a time. Base64-encoding attachments is CPU work, and
awaiting between conversations keeps the longest uninterrupted block down to a single conversation
instead of the whole database. Attachment bytes are read through the `attachment-jobs` worker.

### Attachment storage controls

Privacy settings reports logical attachment content in the active database, split into sent and
unsent files. The aggregate runs in the attachment worker so scanning a large attachment table
does not block either window. It deliberately excludes rotating database snapshots: those are
recovery copies, not active attachment rows, and age out under the backup policy.

Cleanup removes only rows whose `message_id` is `NULL`. Those are files currently staged in a
composer but not sent. The native confirmation names that scope explicitly. Attachments referenced
by retained messages are never selected, and the worker performs the selection and deletion in one
transaction. Every affected composer receives a fresh `attachments:changed` payload, while
`attachments:storage-changed` tells Settings to reload the aggregate after imports, individual
removals, conversation deletion, cleanup, or a factory reset.

The displayed byte count is logical content, not the SQLite file's physical size. Deleted pages
remain available for SQLite to reuse, and recovery snapshots can temporarily retain older copies;
the UI therefore does not claim that cleanup immediately returns the same number of bytes to the
filesystem.

### Deleting everything

`privacy:delete-all` is a factory reset: conversations, messages, attachments, preferences,
provider metadata, model slots, and encrypted keys. Confirmation is two gates — the Privacy panel
requires the word `DELETE` to be typed, then main shows a native warning box. Cancelling at either
returns success with `deleted: false`; the user did what they meant to.

It deliberately does **not** reuse `commitCandidate`/`resumeInstall`. Those preserve the old
database under `recovery/` so the next launch can archive it — the repair path. A privacy delete
that crashed midway through them would resurrect the deleted conversations on the next launch.
`eraseDatabase` instead builds the empty replacement first, then removes `backups/`, `recovery/`,
and the `luna.db` + `-wal` + `-shm` bundle, then renames the replacement into place. Building
first means the only step that fails for an ordinary reason fails while every byte is still
intact.

Snapshots and preserved archives are full copies of the conversations being deleted, so both
directories go. So do Chromium's own caches — previews load over `app://`, so assistant output has
passed through them — and the in-memory preview cache. Keys are removed before the database: a
crash between them must never leave a decryptable credential on disk with nothing recording that
it exists.

Streams are aborted *and awaited* first. Aborting only starts the unwind, and the unwind writes the
terminal message row; closing the database under it would lose that row. `ChatCoordinator.settle()`
is that barrier.

Afterwards main re-applies the theme and broadcasts `prefs:changed`, `providers:changed`,
`models:changed`, `chats:changed` in that order, so both windows empty out live. The reset lands on
the seeded state a fresh install starts from, not an empty schema — `model_slots` must keep its two
rows.

### API keys

`safeStorage.encryptString` / `decryptString`, backed by the macOS Keychain or Windows DPAPI.
Written once from Settings, read only in main, and never written to a plain file, a log, a
preference JSON, or an IPC response. The encrypted bytes live under `userData/provider-keys`;
SQLite stores only the provider's non-secret metadata and whether a Fast or Expert slot points
to it.

Provider responses include only a `hasApiKey` boolean. The renderer cannot ask for the key;
Settings shows a masked placeholder and a replace/remove action, never the value.

### Providers and model slots

`providers` stores a name, base URL, API surface (`responses` or `chat-completions`), and the
optional OpenAI organization/project routing IDs. `model_slots` has exactly two rows, `fast`
and `expert`; each row independently references a provider and stores a model ID.

Model discovery calls the OpenAI-compatible `GET /models` route in main. The renderer receives
only parsed model metadata. Discovery is a convenience, not a gate: compatible servers do not
all expose the same catalog, so the model field always accepts a manually typed ID.

## Startup performance

`require`/`import` at the top of `main/index.ts` is synchronous and blocks the first paint.
Rules that follow from that:

- `main/index.ts` imports only what's needed to open the first window.
- Updater, telemetry, database, heavy parsers → `await import()` after `ready-to-show`.
- The bundler (electron-vite) handles the rest; keep `asar: true` in the builder config so
  startup is a few large reads instead of thousands of small ones.
- Never `await` a network call before creating the window. Update checks get a timeout and
  run after the UI is visible.

Budget: window visible in under 800ms cold on Apple silicon. If a change pushes past that,
find out what got imported.

---

## Packaging

electron-builder targets macOS and Windows. Build release artifacts on their native operating
systems so signing and platform tooling stay predictable.

- `arch: ['arm64', 'x64']`, universal DMG.
- Hardened runtime on, notarization via `notarytool` (2–10 min typical).
- Entitlements start empty. Add one only when a shipped feature needs it, with a comment.
  `com.apple.security.cs.allow-unsigned-executable-memory` is not a default — if something
  asks for it, find out why first.
- Credentials come from the environment (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
  `APPLE_TEAM_ID`). Never in the repo.
- Windows ships as an x64 NSIS installer. The Windows icon is generated by electron-builder
  from the committed PNG source; code-signing credentials stay outside the repo.
- Verify a build with `codesign -dv --verbose=4` and `spctl -a -vvv -t install` before shipping.

---

## Adding a feature — the loop

1. Add the channel(s) to `src/shared/ipc.ts`.
2. Implement the handler in `src/main/ipc/<domain>.ts`, returning `Result`.
3. Add the wrapper to the preload bridge.
4. Build the UI under `src/renderer/features/<name>/`.
5. Unit-test the handler body (it's pure enough to call directly).
6. `npm run typecheck && npm run lint && npm run test`.
7. Launch the app and confirm the round trip.
