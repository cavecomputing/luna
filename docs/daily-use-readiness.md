# Daily-use readiness

This is the handoff checklist for taking Luna from an early build to a dependable daily-use
application. Read [CLAUDE.md](../CLAUDE.md) before implementing any item. Command-palette work
is deliberately deferred and is not part of this checklist.

## Completed baseline

- Search has keyboard navigation, focus containment, and restored focus on close.
- Search and the command palette share the current dialog styling and content-pane alignment.
- Duplicate app instances focus the existing Luna window instead of opening another instance.
- An abnormal renderer-process exit automatically reloads once; a rapid repeat shows a plain,
  text-only recovery page instead of entering a reload loop.
- React rendering failures in the chat, Settings, and Keyboard Shortcuts windows show a generic
  boundary with **Try again** and **Reload window** actions.
- The README, screenshots, getting-started guide, and development documentation are current.

## Remaining work

### 1. Database backup and recovery

This is the next task and the highest-priority daily-use risk. All persistent data currently
lives in `luna.db`, and a startup or migration failure presently logs the error and quits.

- Create rotating local backups before schema migrations and after appropriate clean database
  checkpoints.
- Keep the database, WAL, and backup operations consistent so a backup is always restorable.
- Run a SQLite integrity check during the startup recovery path.
- If the active database is damaged, restore the newest valid backup when safe or show a clear,
  text-only recovery choice instead of silently discarding data.
- Never overwrite the damaged database without preserving a recoverable copy.
- Cover clean startup, migration failure, corrupt database, valid backup restore, invalid backup,
  and interrupted recovery with deterministic tests.
- Keep all database work in main; no database paths or contents may cross into the renderer.

### 2. Export and delete-all

The Privacy settings panel currently marks these controls as unfinished.

- Export conversations in a documented portable format through a user-selected destination.
- Add a deliberate, confirmed delete-all flow covering conversations, attachments, preferences,
  provider metadata, and encrypted provider credentials.
- Ensure neither operation exposes secrets or writes private data outside the chosen destination.

### 3. Packaged-app smoke testing

- Exercise first launch, provider setup, sending and cancelling, attachments, restart,
  sleep/wake, recovery, and uninstall/reinstall using an installed build.
- Verify Keychain behavior on macOS and DPAPI behavior on Windows.
- Test native packaging on both operating systems; do not treat a development launch as release
  validation.

Items 1–3 are the daily-driver threshold.

### 4. Attachment storage controls

- Show total local attachment storage usage.
- Add a safe cleanup or retention mechanism before database growth becomes surprising.
- Preserve attachments referenced by retained messages and make destructive scope explicit.

### 5. Release and update path

- Establish a repeatable, migration-safe manual upgrade path first.
- Add automatic updates later, once release signing and hosting are settled.
- Never allow an older build to write a database schema created by a newer build.

### 6. End-to-end coverage

- Add a small packaged-Electron test suite for the highest-value window, preload, IPC, and
  persistence workflows.
- Keep unit tests as the primary detailed coverage; use end-to-end tests for integration failures
  that unit tests cannot see.

## Next-chat handoff

Use this prompt in a fresh chat:

> Read `CLAUDE.md` and `docs/daily-use-readiness.md`. Implement item 1, database backup and
> recovery, as a focused change. Inspect the existing SQLite startup and migration flow before
> planning. Preserve damaged data, add deterministic recovery tests, visually verify any recovery
> UI, run typecheck/lint/test, and commit the completed work separately. Do not begin the deferred
> command-palette work.
