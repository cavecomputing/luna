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

## Daily-driver threshold

### 1. Database backup and recovery — completed

Luna now keeps five rotating, uncompressed SQLite snapshots before migrations and at most daily
after clean checkpoints. Startup validates damaged data and backup candidates, requires explicit
consent before restoring, preserves the database/WAL bundle, and resumes interrupted recovery.
Migration failures and databases from newer Luna versions remain untouched. All database paths
and contents stay in main.

### 2. Export and delete-all — completed

Conversations export as readable per-conversation JSON with attachments inlined, either one at a
time from the conversation context menu or all at once into a folder chosen from Privacy settings.
The format is documented in [architecture.md](architecture.md#export-format) and excludes
credentials, provider metadata, preferences, internal ids, and unsent drafts.

Delete-all is a factory reset behind two gates: the word `DELETE` typed in the panel, then a native
warning. It removes conversations, attachments, preferences, provider metadata, encrypted keys,
local backups, preserved recovery archives, and Chromium's own caches, then broadcasts the empty
state so both windows follow without a reload. The reset builds its replacement database before
removing anything and never routes through the recovery path, so no interruption can resurrect
deleted conversations.

### 3. Packaged-app smoke testing

- Exercise first launch, provider setup, sending and cancelling, attachments, restart,
  sleep/wake, recovery, and uninstall/reinstall using an installed build.
- Verify Keychain behavior on macOS and DPAPI behavior on Windows.
- Test native packaging on both operating systems; do not treat a development launch as release
  validation.

Items 1–3 are the daily-driver threshold.

## Remaining work

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

> Read `CLAUDE.md` and `docs/daily-use-readiness.md`. Item 1, database backup and recovery, is
> complete. Plan and implement item 2, export and delete-all, as a focused change.
> Inspect the Privacy settings panel, SQLite ownership, attachment storage, secure provider-key
> storage, file-dialog IPC, and existing confirmation patterns before planning. Define and document
> a portable export format that excludes credentials, write only to the destination the user chose,
> and make delete-all an explicit confirmed action that removes conversations, attachments,
> preferences, provider metadata, and encrypted provider credentials. Add deterministic main/IPC/UI
> tests, visually verify the destructive confirmation flow, run typecheck/lint/test, and commit the
> completed work separately. Do not begin packaged-app smoke testing or deferred command-palette work.
