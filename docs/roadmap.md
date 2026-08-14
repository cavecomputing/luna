# Roadmap

Planned direction for Luna after 1.0.

This file is a plan, not a promise. Versions may be reordered or dropped. What it must always
do is describe the *current* plan accurately.

## Maintaining this file

Update it as part of the work, not afterward:

- When a version ships, move it to "Shipped" with the version number it shipped in.
- When a decision in "Open decisions" gets made, delete the entry and write the outcome into the
  version it belonged to. If the decision changes a rule in [CLAUDE.md](../CLAUDE.md), update
  that file in the same change.
- When work reveals a new prerequisite, add it to "Foundations" rather than burying it inside a
  version description.
- Do not silently reorder versions. If the order changes, say so and say why.

## Where Luna is now

1.0 is a single-turn chat client. One user message produces exactly one assistant reply, which
ends in exactly one terminal state (`complete`, `cancelled`, or `error`). The model produces
text and optional reasoning. It cannot call anything, and Luna cannot run anything on its
behalf.

That single-turn shape is the main thing the roadmap changes.

## Foundations

These are cross-cutting and are not features anyone asks for by name. Each is a prerequisite for
one or more planned versions. Building them late means retrofitting them into a schema and a UI
that assumed they were absent.

### F1. Tool calling

**Needed by:** v1.2, v1.3, v2.0. Nothing after v1.1 works without it.

Today `chat-api.ts` sends no `tools` array and parses only text and reasoning deltas. Adding
tool calling touches five things at once:

1. **Request bodies** gain a tool list, in two different shapes — the Responses API and Chat
   Completions describe tools differently, and Luna supports both.
2. **Stream parsing** must accumulate tool-call fragments. Arguments arrive as partial JSON
   strings keyed by call index, split across SSE chunks, and are only parseable once complete.
   This is the same class of problem as `parseThinkingTags` and deserves the same care.
3. **The turn loop** stops being one request. It becomes: request → tool call → execute →
   feed the result back → request again, until the model stops calling tools. `ChatCoordinator`
   currently assumes one request per assistant row.
4. **Storage.** `messages.role` is `CHECK (role IN ('user', 'assistant'))`. Tool calls and tool
   results need a role, or a separate table, plus a migration. One user turn will produce
   several rows.
5. **Cancellation** must interrupt the loop, not just the current HTTP request, and must still
   leave every row in a terminal state.

Treat this as its own piece of work with its own tests before any tool that depends on it.

### F2. Token and cost accounting

**Needed by:** v1.2 onward. Strongly recommended before shipping any tool loop.

Luna records no usage at all. Once a model can call tools, one user message can silently trigger
many provider requests. A user must be able to see what a conversation cost. At minimum: capture
the `usage` block both APIs return, store it per assistant row, and total it per conversation.

### F3. Context management

**Needed by:** v1.2 onward.

Luna sends the entire conversation history on every turn, with no truncation, summarization, or
token counting. That is correct and simple for short chats. It fails once search results and
code output enter the transcript, and it fails first on models with smaller context windows.
Needed: a token estimate, a defined policy for what gets dropped or summarized, and a visible
indication when history has been trimmed.

### F4. Permission and consent model

**Needed by:** v1.2 onward.

1.0's security posture is deny-by-default throughout: no renderer network access, navigation
denied unless allowlisted, previews sandboxed with no same-origin and no network. Search and
code execution both deliberately punch through that. They need an explicit consent model —
what a tool may reach, who approved it, and whether approval persists — designed before the
first tool ships, not added after.

This is the item most likely to be skipped and most expensive to add later.

### F5. Update path

**Needed by:** every version after 1.0, in practice.

There is no updater. Shipping 1.1 currently means every user manually downloads it again.
`electron-updater` needs code signing on both platforms first. See the signing notes in
[development.md](development.md).

## Planned versions

### v1.1 — Reusable skills

Saved, reusable instructions a user can insert into a conversation with a `/` shorthand in the
composer.

**Work:** a `skills` table; a management section in Settings (create, edit, delete, reorder);
`/` autocomplete in the composer; import and export so skills are portable.

**Depends on:** nothing in Foundations, *if* skills are prompt text only.

**Open decision:** are skills purely text that gets inserted or prepended, or can a skill also
declare which tools it may use and with what settings? Text-only keeps v1.1 genuinely small and
independent. Anything more makes v1.1 depend on F1 and should move after it.

### v1.2 — Search integrations

Let the model search the web and use the results.

**Depends on:** F1, F2, F3, F4. All four.

**Open decision:** hand-build a search tool per provider, or implement the Model Context
Protocol and get search — and much else — through MCP servers. MCP is more work up front and
much less work per integration afterward, and it is the interface an external agent wrapper is
most likely to speak. Decide this before writing the first tool, because it determines whether
F1's tool layer is Luna-specific or standard.

### v1.3 — Python execution environment

A sandboxed Python scratch space the model can use to compute, work with images, and produce
files.

**Depends on:** F1, F2, F3, F4, and everything in v1.2's tool plumbing.

This is a substantially larger step than v1.1 or v1.2. Beyond the tool loop it needs:

- **A sandbox.** The recommended option is Pyodide — CPython compiled to WebAssembly — run in a
  dedicated hidden renderer or worker. It inherits Chromium's sandbox, adds no native module,
  needs no Python on the user's machine, and provides numpy, pandas, and matplotlib. The cost is
  bundle size. The alternative, a real Python subprocess, requires Python to be installed and
  requires separate OS-level sandboxing on macOS and Windows; it is considerably more work and
  more attack surface.
- **Resource limits.** Wall-clock timeout, memory ceiling, and cancellation that actually stops
  a running loop.
- **Output capture.** stdout, stderr, exceptions, matplotlib figures, and files the code writes.
- **Model-produced artifacts.** Luna's attachment system is currently input-only: user to model.
  Files coming *back* need storage, display, and a way to save them. This is a new path through
  attachments, not a small extension of the existing one.

**Recommendation:** split this. Ship the sandbox with computation and text output first, and
treat file and image artifacts as a separate release. The artifact path is where most of the
surface area is.

### v2.0 — Agent wrapper integration

Integration with an external agent wrapper for code mode.

Too far out to plan in detail. The decisions that affect it are F1's tool interface and the MCP
question in v1.2 — those determine how much adaptation v2.0 needs.

## Recommended additions

Proposals, not decisions. Each is small relative to the versions above.

- **Conversation import.** Luna exports conversations but cannot read them back. The format is
  already specified in [architecture.md](architecture.md#export-format), so this is mostly a
  validator and an insert. It makes export a real backup rather than a one-way dump.
- **Edit and resend a user message; regenerate a reply.** 1.0 can only retry a reply that failed
  or was stopped. Editing a message and re-running from that point is expected behavior in a
  chat client, and it becomes more valuable once turns are expensive.
- **Conversation list performance.** `chats.load()` reads every message of every conversation on
  every `chats:changed` broadcast, which fires on each stream start and finish. It is fine at
  1.0's scale. Tool loops make conversations much longer, so this should be fixed before v1.2
  rather than after.

## Shipped

- **1.0** — Two-pane chat client. Providers with Responses and Chat Completions support, Fast
  and Expert model slots, streaming replies, Markdown and sandboxed HTML rendering, reasoning
  display, attachments, conversation search, command palette, four themes, export, delete-all,
  database backup and recovery, and API keys in platform secure storage.
