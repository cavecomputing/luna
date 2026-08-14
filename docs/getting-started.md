# Getting started

This guide explains how to set Luna up and how to use it day to day.

## Terms used in this guide

- **Provider** — a server that Luna sends your messages to. You choose and configure it. Luna
  does not provide one.
- **Model** — the specific AI model on that provider, identified by a model ID such as
  `gpt-4o-mini`. One provider usually offers several models.
- **Slot** — a saved provider-and-model pairing. Luna has exactly two slots, named **Fast** and
  **Expert**.
- **Mode** — which of the two slots a conversation is currently using.
- **Conversation** — one thread of messages. The sidebar lists all of your conversations.

## Requirements

- macOS, or Windows 10 or 11 (64-bit).
- A provider you can reach. This is either an online service such as OpenAI, or a server running
  on your own computer.
- An API key, if your provider requires one. Local servers often do not.

Luna does not include an AI model or API credits. Costs, rate limits, and privacy policies come
from the provider you choose, not from Luna.

## Install Luna

Follow the install steps in the [README](../README.md#install). Those steps include what to do
about the security warning your operating system shows for unsigned applications.

## Configure a provider

Luna cannot send a message until a provider and a model are assigned. Do this once, before your
first conversation.

1. Open Settings. Press `Cmd+,` on macOS, or `Ctrl+,` on Windows. Settings opens in its own
   window.
2. Select **Providers** in the left-hand list.
3. Luna includes one provider entry named OpenAI, with the base URL
   `https://api.openai.com/v1`. Select it to edit it, or select **Add provider** to create a new
   one.
4. Fill in these fields:
   - **Name** — any label you want. This is only shown to you.
   - **Base URL** — the address of the provider's API. For OpenAI this is
     `https://api.openai.com/v1`. For a local server this is usually something like
     `http://localhost:1234/v1`. Do not include a trailing slash.
   - **Conversation API** — choose one of the two options. See "Choosing the API type" below.
   - **Organization ID** and **Project ID** — optional. These apply to OpenAI accounts that use
     organization or project routing. Leave both empty if you are unsure.
   - **API key** — paste your key here. Leave it empty if the provider does not require one.
5. Select **Save & test**. (**Save** stores the provider without contacting it. **Save & test**
   stores it and then checks that it works. Use **Save & test** the first time.)

After step 5, one of two things happens:

- **The test succeeds.** Luna saves the provider and downloads the provider's list of models.
- **The test fails.** Luna shows an error. See "If something does not work" at the end of this
  guide.

### Choosing the API type

Luna supports two APIs. You must pick the one your provider actually implements.

| Choose this          | When                                                                       |
| -------------------- | -------------------------------------------------------------------------- |
| **Responses**        | Your provider implements OpenAI's Responses API. This is correct for OpenAI itself. |
| **Chat Completions** | Your provider implements the older `/chat/completions` API. This is correct for most local servers and most non-OpenAI services. |

If you choose the wrong one, **Save & test** fails, usually reporting that the endpoint was not
found. Change **Conversation API** and test again.

## Assign models to the Fast and Expert slots

1. In Settings, select **Models** in the left-hand list.
2. Under **Fast**, choose a provider from the dropdown.
3. Under **Fast**, choose a model. You can select one from the list, or type a model ID directly
   into the field. Typing a model ID is always allowed, because some providers do not publish a
   complete model list.
4. Repeat steps 2 and 3 under **Expert**.
5. Close Settings.

Both slots may point at the same provider and the same model. Nothing requires them to differ.

Every setting in Luna applies immediately. You never need to restart Luna after changing one.

## How Fast and Expert modes work

Each conversation remembers which mode it is using. When you reopen a conversation, it returns
to the mode it had when you last used it.

The **Default mode** setting, in the **Chat** section of Settings, only decides which mode a
*new* conversation starts in. Changing it does not change any existing conversation.

To change the mode of the conversation you have open, use the Fast/Expert switch at the bottom
right of the composer, or press `Cmd+Shift+M` on macOS or `Ctrl+Shift+M` on Windows.

## Have a conversation

1. Select the **+** button at the top of the sidebar. Luna creates a new conversation.
2. Type your message in the box at the bottom of the window.
3. Press `Enter` to send. Press `Shift+Enter` if you want a new line inside your message instead
   of sending.

The reply appears one piece at a time as the provider produces it. While a reply is arriving,
the send button becomes a stop button. Select it to stop the reply. Luna keeps whatever text
had already arrived.

Luna names each conversation automatically after the first exchange, using your Fast model. If
you do not want this, turn off **Name chats automatically** in the **Chat** section of Settings.

### Right-click a message

Right-click any message to open a menu. It contains **Copy Message**. On a reply that failed or
that you stopped, it also contains **Retry Response**, which asks the model again.

### Right-click a conversation

Select the **…** button on a conversation row in the sidebar, or right-click the row. The menu
contains **Pin Conversation**, **Rename Conversation**, **Export Conversation…**, and **Delete
Conversation**. Pinned conversations are listed above the others.

## Attach files

There are three ways to attach a file:

- Select the paperclip button in the composer.
- Drag a file onto the composer.
- Paste an image from your clipboard.

Luna accepts these file types:

| Type       | Formats                     |
| ---------- | --------------------------- |
| Images     | PNG, JPEG, WebP, GIF        |
| Documents  | PDF                         |
| Text       | Any plain-text file, including source code, Markdown, JSON, CSV, and logs |

Luna checks the actual contents of each file, not its file extension. Renaming a file does not
change whether Luna accepts it.

These limits apply:

| Limit                          | Value  |
| ------------------------------ | ------ |
| Files per message              | 5      |
| Size of a single file          | 10 MiB |
| Total size of one message      | 20 MiB |
| Total size of one conversation | 50 MiB |

Whether an attachment actually works also depends on your provider and model. Many models
cannot read images or PDFs. If a provider rejects an attachment, Luna tells you that the
provider refused it, rather than failing silently.

## Render HTML from a reply

When a model returns a block of HTML, Luna shows it as source code with two buttons: **Source**
and **Render**.

Source is selected by default. Nothing is rendered until you select **Render**.

When you select Render, Luna displays the HTML inside an isolated frame. That frame cannot run
scripts, cannot reach the network, and cannot reach any of your data. Links inside it open in
your normal web browser.

## Export your conversations

To export one conversation, right-click it in the sidebar and choose **Export Conversation…**.
Luna asks where to save a single `.json` file.

To export all conversations, open Settings, select **Privacy**, and choose **Export all
conversations…**. Luna asks you to pick a folder, then writes one `.json` file per conversation
into a new folder inside it, plus a `manifest.json` file listing every file written.

Exports contain conversation titles, message text, reasoning, timestamps, and attachments. They
never contain API keys, provider settings, base URLs, or preferences.

## Where your data is stored

Everything is stored on your own computer, in one folder:

- **macOS:** `~/Library/Application Support/Luna`
- **Windows:** `%APPDATA%\Luna`

Your conversations, messages, attachments, preferences, and provider settings are in a SQLite
database file named `luna.db` in that folder. Luna also keeps up to five recent copies of that
database in a `backups` subfolder, so it can recover if the database is damaged.

Your API keys are stored separately, encrypted by your operating system, in a `provider-keys`
subfolder. On macOS this uses the Keychain. On Windows this uses DPAPI. API keys are never
written into `luna.db`, never written to a log, and never sent to Luna's interface — only the
part of Luna that talks to the network can read them.

### What leaves your computer

When you send a message, Luna sends the following to the provider assigned to that
conversation's current mode:

- The text of that conversation's messages.
- Any attachments in that conversation.
- A short system instruction that tells the model it is Luna.

Luna asks each provider not to keep a copy of the conversation, using the `store: false` option.
Whether a provider honors that is the provider's decision. The provider's own privacy,
retention, and account policies still apply. Read them before sending anything sensitive.

Luna has no telemetry, no analytics, and no crash reporting. It never contacts any server except
the providers you configure.

### Delete everything

Open Settings and select **Privacy**. Find the **Delete all data** row. Type the word `DELETE`
into the box, which enables the delete button. Select that button. Luna then shows a system
warning dialog that you must confirm a second time.

This removes your conversations, messages, attachments, preferences, provider settings, saved
API keys, and Luna's local backups. Nothing can be recovered afterward. Files you already
exported are not affected.

## If something does not work

**"Save & test" fails.**

Check these, in this order:

1. The base URL is exactly right, including `http://` or `https://`, and has no trailing slash.
2. The **API** setting matches what your provider implements. If you chose Responses, try Chat
   Completions, or the other way around.
3. Your API key is correct and has not expired.
4. If the provider is a local server, confirm it is running and is listening on the port in your
   base URL.

**A conversation says a provider or model is missing.**

Open Settings, select **Models**, and confirm that both a provider and a model ID are set for
the mode that conversation is using.

**The provider rejected an attachment.**

The model you chose probably cannot read that file type. Try the same message with a model that
supports images or PDFs, or remove the attachment.

**Luna says the rate limit was reached.**

Your provider is refusing requests because too many were sent recently. Wait, then try again.
This limit comes from the provider, not from Luna.

**Luna reports that the database is damaged.**

Luna shows a recovery window when it cannot open its database. It offers to restore the most
recent backup. Luna does not delete your damaged database; it keeps it so it can be inspected.

**PowerShell reports that `npm.ps1` cannot be loaded.**

This only affects building Luna from source. Use `npm.cmd` instead of `npm`. See
[Windows](windows.md).
