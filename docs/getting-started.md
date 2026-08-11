# Getting started

Luna is an early desktop chat client for macOS and Windows. It connects directly to a provider
you configure; Luna does not include a hosted model service or API credits.

## Requirements

- macOS or Windows
- Node.js 22 or newer
- npm, included with Node.js

There are no stable installers yet. Follow the source-based quick start in the
[README](../README.md#quick-start) to launch Luna.

## Configure a provider

Open Settings with `CmdOrCtrl+,`, then:

1. Under **Providers**, edit the preconfigured OpenAI entry or add another compatible server.
2. Choose **Responses API** for providers that implement OpenAI's current Responses surface, or
   **Chat Completions** for servers that implement that compatibility surface.
3. Enter an API key if the server requires one. Keyless local servers are supported. OpenAI
   organization and project IDs are optional.
4. Select **Save & test** to verify the connection and retrieve the provider's model list.
5. Under **Models**, assign a provider and model to the **Fast** and **Expert** slots. Both slots
   may use the same provider or model.

The Fast/Expert choice is saved per conversation. Reopening a chat restores the mode used for
that conversation.

## Start chatting

Create a conversation with the plus button and type in the composer. Press Enter to send or
Shift+Enter for a new line. Replies stream as they arrive and can be stopped from the composer.

Luna renders Markdown, code blocks, links, and supported model reasoning. Conversation search
looks through titles and message text with `CmdOrCtrl+F`.

## Attach files

Use the paperclip, drag files onto the composer, or paste an image. Luna accepts supported
images, PDFs, and text files. Attachment support also depends on the selected provider and
model; Luna reports when a provider rejects an attachment type or payload size.

## Data and privacy

Conversations, messages, attachments, provider settings, and preferences are stored locally in
Luna's application-data directory. API keys are stored separately using Electron's operating
system encryption, backed by macOS Keychain or Windows DPAPI.

Message content and selected attachments are sent to the provider assigned to the current mode
when you submit them. Luna requests non-persistent provider handling where the API supports it,
but the provider's own privacy, retention, and account policies still apply.

Luna is early software. Back up anything important independently, and never commit the local
application-data directory, API keys, or screenshots of private conversations to the project.

## Troubleshooting

- If **Save & test** fails, confirm the base URL, API type, credentials, and whether the server's
  model-list endpoint is available.
- If a mode cannot send, confirm that both its provider and exact model ID are assigned.
- If PowerShell blocks `npm.ps1`, use `npm.cmd` for the commands in the README.
- For Windows-specific setup and packaging, see [Windows development](windows.md).
