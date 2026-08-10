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
