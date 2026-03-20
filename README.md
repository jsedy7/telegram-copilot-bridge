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

### Three delivery modes

| Mode | Default | Description | Reply back to Telegram |
|---|---|---|---|
| **inject** | ✅ yes | Message is placed into the existing VS Code Chat input box. Preserves the full current conversation context. Auto-submitted after a short delay. | Via `telegram_reply` MCP tool (see Scenario 5) |
| **direct** | | Like inject, but submitted immediately without delay. | Via `telegram_reply` MCP tool |
| **participant** (`@tg`) | | Message goes through the `@tg` chat participant, which calls Copilot with full workspace tool access and sends the response back to Telegram automatically. | ✅ always automatic |

> **How replies work in inject/direct mode:** the `telegram_reply` MCP tool is registered automatically. When Copilot finishes a task, it can call the tool to send a summary back to Telegram. Add *"When done, call telegram_reply"* to your message or put the instruction in `AGENTS.md` once.

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

In `"chatMode": "participant"`, the `@tg` chat participant handles every incoming Telegram message. It runs a full tool-calling loop (reads/writes files, searches workspace) and sends the Copilot response back to Telegram automatically — no extra instruction needed.

You can also invoke `@tg` manually inside VS Code Chat:

```
@tg Write a unit test for the parseDate function in TypeScript
```

---

## `telegram_reply` MCP tool

The extension registers a local MCP server automatically on first run. This exposes the `telegram_reply` tool to **all** Copilot agents — including agent mode in `inject` and `direct` chat modes.

**First-run setup (automatic):**
- `mcp-server.js` is copied to `~/.vscode-telegram-bridge/mcp-server.js`
- An entry is added to `mcp.servers` in your global `settings.json`
- A "Restart now" notification appears — click it to activate the tool

**Usage in Copilot Chat:**
```
Refactor the auth module. When done, call telegram_reply with a summary.
```
Or reference the tool directly:
```
#telegram_reply Test message from VS Code
```

**Tool input:**
```json
{ "message": "text — Telegram Markdown supported: *bold* _italic_ `code`" }
```

Messages longer than 4 096 characters are split automatically.

---

## Supported scenarios

### Scenario 1 — Couch / mobile workflow (inject mode)

> *You're on the sofa with your phone. VS Code is running on your desk. You dictate tasks; Copilot executes them. You don't need the reply on your phone — you'll check the result when you sit back down.*

**Settings:**
```jsonc
"telegramBridge.chatMode": "inject",
"telegramBridge.autoSubmit": true,
"telegramBridge.submitDelay": 2000,
"telegramBridge.workspaceContext": "agent",
"telegramBridge.prefixMessage": false
```

**Flow:**
1. Open VS Code, start the bridge (`Cmd+Shift+P` → **Start bridge**)
2. From mobile: *"Refactor the auth module to use async/await"*
3. VS Code injects the text into the current Copilot Chat input
4. After 2 s the message is auto-submitted; Copilot begins working in agent mode
5. Check the result when you return to the desk

**Tip:** Press Escape within the `submitDelay` window to cancel before submission.

---

### Scenario 2 — Two-way remote control (participant mode)

> *You want a quick answer delivered back to Telegram — e.g. "Is the deployment pipeline green?" or "How many TODOs are left in the codebase?"*

**Settings:**
```jsonc
"telegramBridge.chatMode": "participant",
"telegramBridge.workspaceContext": "agent"
```

**Flow:**
1. Send from Telegram: *"Summarise what's in CHANGELOG.md"*
2. VS Code opens `@tg <message>` in Copilot Chat
3. The `@tg` participant runs a tool-calling loop — reads files, searches the workspace
4. Copilot's full response is sent back to your Telegram chat automatically
5. No need to look at VS Code at all

**Tip:** Long answers are automatically split into ≤ 4 096-character chunks.

---

### Scenario 3 — Multi-project routing

> *You have several VS Code windows open (e.g. `frontend`, `backend`, `infra`). You want Telegram messages to go to the right project.*

**Flow:**
1. All windows run the bridge simultaneously
2. Switch focus to the `backend` window → `Cmd+Shift+P` → **Set as active workspace**
3. Status bar shows `⬛ TG ✓ backend` (orange) there and `⬛ TG ⏸` (grey) elsewhere
4. Telegram messages now go only to `backend` until you switch again

---

### Scenario 4 — On-desk quick confirmation

> *VS Code is right in front of you. You finished a task and want to ping your phone without picking it up.*

**Flow:**
1. Any chat mode — work normally on the desktop
2. When done: `Cmd+Shift+P` → **✅ Reply 'Done!' to Telegram** (or click the sidebar button)
3. Your phone receives: *"✅ Done!"*
4. For a custom message: **📤 Send custom reply to Telegram**

### Scenario 5 — Hybrid: inject + telegram_reply (best of both worlds)

> *You want the full conversation context of inject mode AND a reply on your phone when Copilot finishes.*

**Settings:**
```jsonc
"telegramBridge.chatMode": "inject",
"telegramBridge.autoSubmit": true,
"telegramBridge.submitDelay": 2000,
"telegramBridge.workspaceContext": "agent",
"telegramBridge.prefixMessage": false
```

**One-time setup in `AGENTS.md`** (root of your project):
```markdown
When you have finished a task that arrived via Telegram,
call the telegram_reply tool and summarise: what was done,
which files changed, and any warnings or next steps.
```

**Flow:**
1. Send from Telegram: *"Add CSV export to the dashboard"*
2. VS Code injects into the existing chat — full context preserved
3. Copilot works in agent mode (reads/writes files)
4. At the end Copilot calls `telegram_reply` automatically
5. Your phone receives a summary — without touching the PC

**This is the recommended setup for the gauč workflow.**

---

A typical day using the couch workflow:

1. **Morning** — open your project in VS Code, start the bridge; it becomes the active receiver
2. **From mobile** — send: `Add a CSV export function to the dashboard`
3. **VS Code** — Copilot Chat opens automatically with the message; agent mode processes it
4. **Click "✅ Done!"** in the VS Code notification → Telegram receives a confirmation
5. **New idea while away** — send another message; VS Code processes it immediately if running

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

---

## Releases

Pre-built `.vsix` files are attached to every [GitHub Release](https://github.com/jirisedy/telegram-bridge/releases).
The release is created automatically by the CI workflow when a `v*` tag is pushed:

```bash
git tag v0.1.4
git push origin v0.1.4
```

See [CHANGELOG.md](CHANGELOG.md) for a full history of changes.
