# Telegram Bridge for VS Code Copilot Chat

Send messages from **Telegram directly into VS Code Copilot / AI Chat**. The bridge runs entirely locally — no external infrastructure, no webhooks, no cloud.

---

## How it works

```
[Telegram] ──long-poll──► [VS Code Extension] ──► [Copilot Chat window]
                                                           │
                               (participant mode)          ▼
                                               [Copilot LM response]
                                                           │
                                              ◄────────────┘
                                        [Reply sent back to Telegram]
```

### Two modes

| Mode | Description |
|---|---|
| **direct** _(default)_ | Telegram message is sent directly into the Copilot Chat input and submitted automatically. One-way. |
| **participant** | Message is routed through the `@tg` chat participant, which calls the Copilot LM and sends the response back to Telegram. Two-way. |

---

## Installation

### Prerequisites

- VS Code **1.93** or newer
- **GitHub Copilot Chat** extension (required for participant mode)
- **Node.js 18+** and npm

### Step 1 — Clone / download the project

```bash
cd telegram-bridge
npm install
```

### Step 2 — Build and package into .vsix

```bash
npm run package
```

This produces `telegram-bridge-0.1.0.vsix` in the project root.

### Step 3 — Install into VS Code

**Option A — Terminal:**
```bash
code --install-extension telegram-bridge-0.1.0.vsix
```

**Option B — VS Code UI:**

| macOS | Windows / Linux |
|---|---|
| `Cmd+Shift+X` | `Ctrl+Shift+X` |

→ Click the **`···`** menu (top-right of the Extensions panel) → **Install from VSIX...** → select the file.

---

## Setup guide

### Step 1 — Create a Telegram bot

1. Open Telegram and search for **@BotFather**
2. Send `/newbot` and follow the prompts (choose a name and username)
3. Copy the **Bot Token** you receive — it looks like `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`

### Step 2 — Run the setup wizard

Open the VS Code **Command Palette**:

| macOS | Windows / Linux |
|---|---|
| `Cmd+Shift+P` | `Ctrl+Shift+P` |

Type and select: **Telegram Bridge: Setup Wizard**

The wizard will:
1. Ask for your Bot Token (stored securely, never in settings.json)
2. Verify the token against the Telegram API
3. Ask for your **Chat ID** (see below how to find it)

### Step 3 — Find your Chat ID

After entering your token, **send `/chatid` to your bot** from Telegram.  
The bot will reply with your Chat ID, e.g. `🆔 Your Chat ID: 123456789`.

> **Groups:** Add the bot to a group and send `/chatid` — the ID will be a negative number like `-1001234567890`.

### Step 4 — Start the bridge

**Command Palette** (`Cmd+Shift+P` / `Ctrl+Shift+P`) → **Telegram Bridge: Start bridge**

Or click the **`⬛ TG`** icon in the bottom-right status bar.

---

## VS Code Settings

You can view and edit all extension settings in two ways:

### Option A — Settings UI

| macOS | Windows / Linux |
|---|---|
| `Cmd+,` | `Ctrl+,` |

In the search box type `telegramBridge` to filter all extension settings.

### Option B — settings.json

Open the JSON settings file directly:

| macOS | Windows / Linux |
|---|---|
| `Cmd+Shift+P` | `Ctrl+Shift+P` |

Type **"Open User Settings JSON"** and select it. Add the following block:

```jsonc
{
  // List of Telegram Chat IDs allowed to send messages.
  // Leave empty = bridge rejects ALL messages (secure by default).
  "telegramBridge.allowedChatIds": ["123456789"],

  // Automatically start the bridge when VS Code opens.
  "telegramBridge.autoStart": false,

  // "direct"      → message goes straight into Copilot Chat (one-way)
  // "participant" → message goes via @tg, Copilot responds back to Telegram (two-way)
  "telegramBridge.chatMode": "direct",

  // Prefix messages with "📱 Name:" in the chat input.
  "telegramBridge.prefixMessage": true
}
```

> ⚠️ **The bot token is never stored in settings.json.** It is kept in the encrypted VS Code Secrets store (same place as GitHub authentication tokens).

---

## Commands

Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and type `Telegram Bridge`:

| Command | Description |
|---|---|
| **Setup Wizard** | Interactive wizard: enter token + Chat ID |
| **Start bridge** | Start Telegram long-polling |
| **Stop bridge** | Stop polling |
| **Toggle** | Start / stop (same as clicking the status bar icon) |
| **Set as active workspace** | Route incoming messages to this VS Code window |
| **✅ Reply 'Done!' to Telegram** | Send a "Done!" confirmation to the last sender |
| **📤 Send custom reply to Telegram** | Type any message and send it back |
| **Show log** | Open the Output Channel with debug logs |

---

## Multi-project routing

If you have **multiple VS Code windows open** at the same time (different projects), only one window should receive Telegram messages at a time.

**To switch which project receives messages:**

`Cmd+Shift+P` → **Telegram Bridge: Set as active workspace**

The status bar reflects the current state:

| Status bar icon | Meaning |
|---|---|
| `⬛ TG ✓ my-project` (orange) | This window **receives** Telegram messages |
| `⬛ TG ⏸ other-project` (grey) | Polling runs but messages go elsewhere |
| `⬛ TG` (inactive) | Bridge is stopped |

---

## Special Telegram commands

| Command | Effect |
|---|---|
| `/start` or `/chatid` | Bot replies with your Chat ID |

---

## Participant mode (@tg)

In two-way mode (`"chatMode": "participant"`), you can also type `@tg` directly inside VS Code Chat:

```
@tg Write a unit test for the parseDate function in TypeScript
```

When a message arrives from Telegram, VS Code automatically opens the chat with `@tg <your message>`. Copilot responds in the chat and the response is also sent back to Telegram.

---

## Mobile workflow example

A typical use case when working from your phone:

1. **Morning** — open your project in VS Code, bridge auto-starts and becomes the active receiver
2. **From mobile** — send: `Add a CSV export function to the dashboard`
3. **VS Code** — Copilot Chat opens automatically with the message, processes it
4. **Click "✅ Done!"** in the VS Code notification → Telegram receives a confirmation
5. **New idea while away** — send another message → VS Code processes it immediately if running, or on next launch

---

## Security

- **Bot token** is stored in the encrypted VS Code Secrets store — never in `settings.json`, never logged
- **Chat ID allowlist** — the bridge only accepts messages from explicitly listed Chat IDs; an empty list means the bridge refuses all messages
- Communication uses HTTPS long-polling to `api.telegram.org` only — no inbound ports, no webhook server, no public endpoints

---

## Troubleshooting

**Bridge won't start / "No allowed Chat IDs"**
→ Run the Setup Wizard and add your Chat ID.

**Messages don't appear in Copilot Chat**
→ Make sure you are on VS Code 1.93+. Check the `Telegram Bridge` Output Channel for errors (`Cmd+Shift+P` → **Show log**).

**Participant mode / "No Copilot model available"**
→ Sign in to your GitHub account with an active Copilot subscription and verify the **GitHub Copilot Chat** extension is installed and enabled.

**How do I find a group Chat ID?**
→ Add your bot to the group, send `/chatid` — the bot replies with a negative number (e.g. `-1001234567890`).

**Messages go to the wrong VS Code window**
→ Switch focus to the correct window and run **Telegram Bridge: Set as active workspace**.
