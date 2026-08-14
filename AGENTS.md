# Repository instructions

Read and follow [CLAUDE.md](CLAUDE.md) before changing source. It is the authoritative project
contract for architecture, security, privacy, testing, and platform behavior. For Windows setup
and packaging details, also read [docs/windows.md](docs/windows.md).

Luna supports both macOS and Windows. Keep platform-specific window, lifecycle, storage, and
packaging behavior conditional; a fix for one operating system must not regress the other.

Before reporting a code change complete, run `npm run typecheck`, `npm run lint`, and
`npm run test`. Use `npm.cmd` from Windows PowerShell when its execution policy blocks
`npm.ps1`. For UI or window changes, launch and visually verify the application as required by
`CLAUDE.md`.

## Visual verification workflows

Two workflows exist. Pick by what the change touches.

### A. Run the real application against a scratch data directory

Prefer this whenever the change involves Electron itself: window chrome, menus, dialogs, IPC,
storage, migrations, or anything that reads `window.luna`. It exercises the real main process,
the real preload bridge, and the real database, while being unable to read or modify the user's
conversations.

1. `npm run build`
2. Launch with a throwaway data directory:
   `./node_modules/.bin/electron out/main/index.js --user-data-dir=<scratch>/luna-data`
   Electron's `--user-data-dir` switch redirects everything Luna stores, so `app.getPath('userData')`
   points there instead of at the real profile.
3. The first launch creates and migrates an empty database at `<scratch>/luna-data/luna.db`. To
   see populated states, quit the app, insert invented conversations and messages into that
   database with `node:sqlite`, then launch again.
4. Screenshot the result, then stop the process and delete `<scratch>/luna-data`.

Use invented data only. Never copy the real `luna.db` into a scratch directory, and never
screenshot the real one. A screenshot may not contain a real conversation, name, email address,
file path, or provider account detail, and no such screenshot may be committed.

### B. Render one component with Vite, without Electron

Use this for a purely presentational renderer change, where booting Electron adds nothing:

1. Build a temporary synthetic fixture in `src/renderer/main.tsx` that renders the actual changed
   component and its real CSS with invented messages or other non-personal test data. Do not render
   `App`, call `watchTheme()`, or access `window.luna` in the fixture.
2. Add a temporary root-level `visual.vite.config.ts` that uses Vite, the React plugin, and
   `root: 'src/renderer'`. Start it with
   `npm exec vite -- --config visual.vite.config.ts`. This renderer-only server is the reliable
   screenshot path: it does not start Electron, touch the user database, or depend on Luna's
   single-instance lifecycle.
3. Open `http://localhost:5173/` with the in-app browser's local web testing workflow and take a
   viewport screenshot. Exercise the relevant visual states (for a scroll treatment, capture both
   scroll extremes and content moving through each edge).
4. Restore `src/renderer/main.tsx` and delete `visual.vite.config.ts` with `apply_patch`, stop the
   Vite server, and close the temporary browser tab.
5. Run `git diff --check`, `git diff -- src/renderer/main.tsx`, and
   `test ! -e visual.vite.config.ts` before the final checks. The main-entry diff must be empty and
   the temporary config must be gone so no fixture code can survive into the change.

For native window or chrome changes, use workflow A rather than this one.

Do not enable Electron remote debugging: its port can expose private chat data and the renderer
bridge to local clients.

Prefer a window-scoped screenshot over a full-desktop one. If only a full-desktop capture is
available, workflow A's scratch data directory is what keeps real conversations out of it —
never point it at the real profile. Never save or commit a screenshot that may contain a real
conversation, name, email address, file path, or other personal data.

Do not run `npm run dev` for a visual check. It opens the real profile, and Luna's
single-instance lock means a second launch focuses the existing window instead of starting the
build you just made.
