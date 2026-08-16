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

1.0.2 hardened the backup and recovery paths against silent data loss. Nothing about the
feature set changed; the relevance here is that the storage layer is now trustworthy enough to
migrate, which every version below requires.

## Foundations

These are cross-cutting and are not features anyone asks for by name. Each is a prerequisite for
one or more planned versions. Building them late means retrofitting them into a schema and a UI
that assumed they were absent.

### F1. Tool calling

**Needed by:** v1.1, v1.2, v1.3, v2.0. It is now the immediate next piece of work, because
v1.1 is MCP server support and nothing in it functions without a tool loop.

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

**Needed by:** v1.1 onward. Strongly recommended before shipping any tool loop.

Luna records no usage at all. Once a model can call tools, one user message can silently trigger
many provider requests. A user must be able to see what a conversation cost. At minimum: capture
the `usage` block both APIs return, store it per assistant row, and total it per conversation.

### F3. Context management

**Needed by:** v1.1 onward.

Luna sends the entire conversation history on every turn, with no truncation, summarization, or
token counting. That is correct and simple for short chats. It fails once search results and
code output enter the transcript, and it fails first on models with smaller context windows.
Needed: a token estimate, a defined policy for what gets dropped or summarized, and a visible
indication when history has been trimmed.

### F4. Permission and consent model

**Needed by:** v1.1 onward. Moving MCP to v1.1 makes this the most urgent item in Foundations.

1.0's security posture is deny-by-default throughout: no renderer network access, navigation
denied unless allowlisted, previews sandboxed with no same-origin and no network. Tools
deliberately punch through that. They need an explicit consent model — what a tool may reach,
who approved it, and whether approval persists — designed before the first tool ships, not
added after.

MCP raises the stakes rather than changing the shape. An MCP server is an arbitrary external
program, usually a local subprocess speaking stdio, chosen by the user and not written by us.
Three things follow that Luna has no answer for today:

- **Process lifecycle.** Luna has never spawned a child process. Startup, shutdown, crash,
  hang, and a server that outlives the app all need defined behavior, and none of it may block
  a window.
- **Server credentials.** `secrets.ts` stores one key per *provider* id. MCP servers need
  their own credentials and environment, under the same rule: platform secure storage, main
  only, never the database and never across IPC.
- **Trust boundary.** Tool descriptions and tool results are attacker-controlled text arriving
  from outside. They are data, not instructions, and the consent model has to hold even when a
  server's own output argues otherwise.

This remains the item most likely to be skipped and most expensive to add later.

### F5. Update path

**Needed by:** every version after 1.0, in practice.

There is no updater. Shipping 1.1 currently means every user manually downloads it again.
`electron-updater` needs code signing on both platforms first. See the signing notes in
[development.md](development.md).

### F6. Streaming cost at scale

**Needed by:** v1.1 onward. Both halves are correct today and both scale quadratically.

1.0's replies are short enough that neither shows. Tool results land in the transcript, so
v1.1 is where they start to.

- **`parseThinkingTags` re-parses the whole accumulated reply on every delta.** Partly
  addressed in 1.0.3: the parser no longer copies the accumulated string to lowercase several
  times per delta, which cut measured cost roughly in half — 180 K accumulated characters went
  from 83 ms to 33 ms, 360 K from 474 ms to 192 ms, 720 K from 1,955 ms to 786 ms. It is still
  quadratic across a stream, because re-parsing accumulated text is what makes a tag split
  across an SSE boundary safe. Going linear needs a stateful parser fed deltas instead of
  accumulated text, which is a change to the streaming contract and belongs with the item
  below, not before it.
- **`ChatDelta` carries the full accumulated text on every delta**, deliberately, so reordered
  events are safe to ignore. The cost is n²/2 × chunk bytes over IPC — roughly 90 MB of
  cumulative traffic for a 2,000-delta reply. The `seq` field already provides the ordering
  guarantee needed to switch to append-with-resync, so the fix does not cost the property the
  current design was chosen for.

The `ChatDelta` change is still open, and is best done together with the stateful parser: both
depend on the same decision about whether the stream layer carries deltas or accumulated text.
Hold both until the tool loop's shape is known, so neither is optimized against a guess.

## Planned versions

### Reordering, 1.0.2

MCP server support was previously an open decision inside v1.2 — search integrations were to be
built either per provider or through MCP. That decision is made: **MCP**, and it moves up to
v1.1 as the next major feature.

What that changes:

- **v1.1 is now MCP server support.** Reusable skills, previously v1.1, move to v1.2.
- **Search integrations no longer exist as their own version.** Search arrives as an MCP
  server like anything else, which was the argument for MCP in the first place.
- **F1 through F4 all move up with it.** They were sequenced behind skills on the assumption
  that v1.1 needed nothing from Foundations. That assumption is gone: v1.1 now depends on all
  four, and F4 in particular is no longer something to design later.

The reason is leverage. Building search by hand first would mean writing a tool layer twice —
once Luna-specific, once standard — and the second write would land after the schema and
consent model had already hardened around the first.

### v1.1 — MCP server support

Let the user connect Model Context Protocol servers and let the model call their tools.

**Depends on:** F1, F2, F3, F4. All four, and F4 is the long pole.

**Work:** a client for the protocol; server configuration in Settings (add, edit, remove,
enable, disable) with credentials in platform secure storage; a `mcp_servers` table for
non-secret metadata; tool discovery and a per-server enable list; the consent surface from F4;
and the tool loop from F1 wired to dispatch to a server rather than to a built-in.

**Schema.** `messages.role` is `CHECK (role IN ('user', 'assistant'))`. Tool calls and tool
results need a role or a separate table, plus a migration, and one user turn will produce
several rows. This lands before any MCP code, not alongside it.

**Open decision:** stdio subprocesses only, or stdio plus remote HTTP servers? Stdio alone is
a smaller first release and covers most existing servers. Remote servers add a network trust
boundary and an auth story that F4 would have to cover in its first version rather than its
second.

**Open decision:** how much of a server's tool surface is exposed by default. Enabling every
discovered tool is the simplest thing to build and the hardest to reason about once a server
updates and quietly gains a tool the user never approved.

### v1.2 — Reusable skills

Saved, reusable instructions a user can insert into a conversation with a `/` shorthand in the
composer.

**Work:** a `skills` table; a management section in Settings (create, edit, delete, reorder);
`/` autocomplete in the composer; import and export so skills are portable.

**Depends on:** nothing in Foundations, *if* skills are prompt text only.

Skills stayed independent of Foundations, which is why they were v1.1. That is also why they
moved: an independent version does not have to come first, and MCP does.

**Open decision:** are skills purely text that gets inserted or prepended, or can a skill also
declare which tools it may use and with what settings? Text-only keeps this version small and
independent. Anything more makes it depend on F1 — which by then exists, so the cost of the
larger shape is lower than it was when this decision was first written down.

### v1.3 — Python execution environment

A sandboxed Python scratch space the model can use to compute, work with images, and produce
files.

**Depends on:** F1, F2, F3, F4, and everything in v1.1's tool plumbing.

Even with the tool loop already built and proven by v1.1, this is a large step. Beyond it:

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

Too far out to plan in detail. The decision that affects it most has now been made: because
v1.1 speaks MCP, an external wrapper meets a standard interface rather than a Luna-specific
one, and v2.0 should need less adaptation than it would have. F1's tool interface is the
remaining variable.

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
  1.0's scale. Tool loops make conversations much longer, so this should be fixed before v1.1
  rather than after.
Both of the hardening items listed here previously shipped in 1.0.3. Every file in
`src/main/ipc/` now has a matching `.test.ts`.

## Shipped

- **1.0** — Two-pane chat client. Providers with Responses and Chat Completions support, Fast
  and Expert model slots, streaming replies, Markdown and sandboxed HTML rendering, reasoning
  display, attachments, conversation search, command palette, four themes, export, delete-all,
  database backup and recovery, and API keys in platform secure storage.
- **1.0.2** — Backup and recovery hardening. A truncated database no longer opens as an empty
  one, a blank snapshot is no longer offered as a restorable backup, snapshot rotation keeps
  the newest *valid* snapshots rather than the newest by date, a clock correction no longer
  suspends backups indefinitely, and the privacy delete now destroys the working copies an
  interrupted recovery leaves beside the database.
- **1.0.3** — Pre-MCP hardening. Halved the streamed-reply parse cost (see F6), swept the
  recovery working copies at startup so a crash no longer leaves conversations readable on
  disk until the next erase, and covered `ipc/settings.ts` — including the authorization
  branch deciding which window may close Settings.
