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

## Visual verification workflow

Use this workflow for renderer UI changes so visual checks are repeatable and never expose real
conversation data or Luna's preload bridge:

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

For native window or chrome changes, also launch the real application with `npm run dev` and inspect
the affected platform behavior. Do not enable Electron remote debugging: its port can expose private
chat data and the renderer bridge to local clients.

Never use a full-desktop screenshot for this check, and never save or commit a screenshot that may
contain a real conversation, name, email address, file path, or other personal data.
