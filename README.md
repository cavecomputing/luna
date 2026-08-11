<p align="center">
  <img src="assets/readme-mascot.png" alt="Luna, a blue and white moon-fox mascot, working at a laptop" width="420">
</p>

<h1 align="center">Luna</h1>

<p align="center">
  A friendly desktop client for chatting with OpenAI-compatible models on macOS and Windows.
  Bring your own provider, switch between Fast and Expert models, and keep your conversations
  organized in one focused app.
</p>

## Screenshots

![A conversation in Luna with the sidebar, Fast and Expert mode switch, and composer](assets/screenshots/luna-chat.png)

![Luna's conversation search dialog](assets/screenshots/luna-search.png)

> [!WARNING]
> Luna is early, unstable software. Features, storage formats, and behavior may change, and
> unreleased builds may lose data. Keep anything important somewhere else and avoid relying on
> Luna as your only copy of a conversation.

## Quick start

Luna currently runs from source. Install [Node.js 22 or newer](https://nodejs.org/), then:

```bash
git clone https://github.com/cavecomputing/luna.git
cd luna
npm install
npm run dev
```

Open Settings with `CmdOrCtrl+,`, add or edit an OpenAI-compatible provider, and use
**Save & test**. Then assign models to the **Fast** and **Expert** slots and start a chat.

For provider options, keyless local servers, and data-storage details, see
[Getting started](docs/getting-started.md).

## Highlights

- OpenAI Responses API and Chat Completions-compatible providers
- Separate Fast and Expert model assignments for everyday and demanding tasks
- Streaming replies with Markdown, code blocks, and collapsible reasoning
- Searchable, pinnable, persistent conversation history
- Image, PDF, and text attachments
- Light and dark appearance on macOS and Windows
- API keys protected by macOS Keychain or Windows DPAPI

## Documentation

- [Getting started](docs/getting-started.md)
- [Development](docs/development.md)
- [Architecture](docs/architecture.md)
- [Windows development and packaging](docs/windows.md)
- [Project contribution and security contract](CLAUDE.md)

## License

Apache 2.0. See [LICENSE](LICENSE).
