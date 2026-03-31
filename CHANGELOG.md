# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.1.9] - 2026-03-31

### Changed

- **`from_telegram:` marker always present** — every Telegram message injected into Copilot Chat now starts with `from_telegram: ` so the AI agent can reliably detect the source regardless of whether `addTelegramReplyInstruction` is enabled. Previously, the marker was only included inside the instruction block (when the setting was on).

---

## [0.1.8] - 2026-03-22

### Added

- **Telegram provenance prefix for inject/direct mode** — incoming messages can now be automatically wrapped with a short instruction that tells the agent the task came from Telegram and that it should call `telegram_reply` when finished. This improves reply reliability in agent mode without requiring the user to repeat the instruction manually in every message.
- New setting: `telegramBridge.addTelegramReplyInstruction` (default `true`).
- **CI build workflow** — GitHub Actions now builds the extension on every push to `main`, every pull request, and manual workflow run, then uploads the packaged `.vsix` as a workflow artifact.
- **Release automation improvements** — tag-based releases now validate that the tag matches `package.json`, publish the `.vsix` to GitHub Releases, and append useful links to the generated release notes (release page, direct download, changelog, compare diff).

### Changed

- In `inject` and `direct` mode, the message sent to Copilot can now include a Telegram-specific completion instruction before the actual user message.
- GitHub metadata and README release links now point to the actual repository: `jsedy7/telegram-copilot-bridge`.

---

## [0.1.7] - 2026-03-21

### Fixed

- **MCP reply fallback after reload** — `telegram_reply`, `replyDone`, and `replyCustom` no longer depend only on the in-memory `lastSenderChatId`. If no sender is cached but `telegramBridge.allowedChatIds` contains exactly one Chat ID, that ID is used as a safe fallback. This fixes the confusing `No Telegram sender yet, or bridge is not running.` error after a window reload when the bridge is already connected.

### Changed

- Bridge startup log now includes the running extension version, e.g. `Spouštím Telegram Bridge v0.1.7 ...`.

---

## [0.1.6] - 2026-03-20

### Fixed

- **Duplicate poller conflict** — when two VS Code windows both ran the bridge, Telegram returned `Conflict: terminated by other getUpdates request` in a tight loop, and neither instance processed messages. Now: on receiving a Conflict error, the poller sets `running=false` and stops immediately instead of retrying. A VS Code notification appears (*"⚠️ Jiná instance bridge je aktivní"*) with a **Spustit znovu zde** button to take over from the current window.
- HTTP server and port file are now also cleaned up when the poller self-stops due to a Conflict.

---

## [0.1.5] - 2026-03-20

### Added

- **Local MCP server** (`resources/mcp-server.js`) — a self-contained zero-dependency Node.js stdio server implementing the Model Context Protocol. Exposes `telegram_reply` as a proper MCP tool that Copilot agent mode discovers natively.
- **HTTP bridge** (`127.0.0.1:{random-port}/send`) — the VS Code extension starts a local HTTP server when the bridge is running. The MCP server POSTs to it. Listens on loopback only; no external exposure.
- **Auto-registration** — on first activation the extension copies `mcp-server.js` to `~/.vscode-telegram-bridge/mcp-server.js` and adds the server to `mcp.servers` in global `settings.json`. A "Restart now" notification appears; after reload, `telegram_reply` is available in Copilot as a real MCP tool.
- **Node.js binary detection** — tries common macOS/Linux paths before falling back to `node` in PATH.

### Changed

- `stopBridge()` and `deactivate()` now also stop the HTTP server and clean up the port file.

---

## [0.1.4] - 2026-03-20

### Added

- **`telegram_reply` LM tool** — registered via `vscode.lm.registerTool` and declared in `package.json` under `languageModelTools`. Superseded in v0.1.5 by the MCP server approach which is properly visible to Copilot Chat.
- Extension version now shown in Output Channel on startup, status bar tooltip on hover, and in tool call results.

---

## [0.1.3] - 2026-03-20

### Fixed

- **`@tg` participant now has full workspace file access.** Rewrote `chatParticipant.ts` with a complete tool-calling loop using `vscode.lm.tools` + `vscode.lm.invokeTool`. The `@tg` participant now reads/writes files and searches the workspace exactly like `@workspace`, and still sends the Copilot response back to Telegram.
- Used `request.model` (user's currently active Copilot model) instead of the deprecated `vscode.lm.selectChatModels`.
- Fixed `TS2504` compile error: iterate `response.stream` instead of `response` directly.
- `stream.progress()` now displays the name of the tool being invoked (e.g. `🔧 vscode_readFile`).

### Added

- **Timestamp logging** — all Output Channel entries now include `[HH:MM:SS]` timestamps.
- **`sendReplyWithRetry()`** — shared helper with **Retry** and **View Log** buttons on send failure.

---

## [0.1.2] - 2026-03-19

### Added

- **`inject` mode** (new default `chatMode`): places the Telegram message into the existing VS Code Chat input box, preserving the full conversation context.
- **`autoSubmit`** setting (default `true`): automatically submits after a configurable delay. Set to `false` to review before pressing Enter.
- **`submitDelay`** setting (default `1500 ms`): time before auto-submit; press Escape to cancel.
- **`workspaceContext`** setting (`none` / `workspace` / `agent`): controls whether `@workspace` or `/new` is prepended.

### Fixed

- **`/chatid` chicken-and-egg problem** — `/chatid` and `/start` now always bypass the allowlist.

---

## [0.1.1] - 2026-03-18

### Added

- **Multi-window routing** via `globalState` — only the active window processes incoming messages.
- **`Set as active workspace`** command.
- **`Reply 'Done!'`** and **`Send custom reply`** commands.
- **Activity Bar sidebar** (`StatusViewProvider`) with live status, auto-refresh every 5 s.
- Extension icon (`resources/icon.svg`).

---

## [0.1.0] - 2026-03-17

### Added

- Initial release.
- Telegram long-polling with zero external dependencies (Node.js `https` only).
- `direct` mode: auto-submit into Copilot Chat.
- `participant` mode (`@tg`): two-way bridge — replies sent back to Telegram.
- Setup wizard — bot token stored in VS Code Secrets API, never in `settings.json`.
- Chat ID allowlist — secure-by-default.
- Status bar item with one-click toggle.
- Output Channel with debug logs.


### Added

- **Local MCP server** (`resources/mcp-server.js`) — a self-contained zero-dependency Node.js stdio server implementing the Model Context Protocol. Exposes `telegram_reply` as a proper MCP tool that Copilot agent mode discovers natively (no `#` hashtag workarounds needed).
- **HTTP bridge** (`127.0.0.1:{random-port}/send`) — the VS Code extension starts a local HTTP server when the bridge is running. The MCP server POSTs to it. Listens on loopback only; no external exposure.
- **Auto-registration** — on first activation the extension copies `mcp-server.js` to `~/.vscode-telegram-bridge/mcp-server.js` (stable path, survives extension updates) and adds the server to `mcp.servers` in global `settings.json`. A "Restart now" notification appears; after reload, `telegram_reply` is available in Copilot as a real MCP tool.
- **Node.js binary detection** — tries common macOS/Linux paths (`/opt/homebrew/bin/node`, `/usr/local/bin/node`, `/usr/bin/node`) before falling back to `node` in PATH.

### Changed

- `stopBridge()` and `deactivate()` now also stop the HTTP server and clean up the port file so the MCP server returns a clear "bridge not running" error instead of a connection refused.

---

## [0.1.4] - 2026-03-20

### Added

- **`telegram_reply` LM tool** — registered via `vscode.lm.registerTool` and declared in `package.json` under `languageModelTools`. Any VS Code agent (Copilot in agent mode, `@tg` participant, custom agents) can now call `#telegram_reply` to send a message back to the Telegram user.
  - Input: `{ "message": "text" }` — Telegram Markdown supported (`*bold*`, `_italic_`, `` `code` ``, ` ```block``` `)
  - Long messages are automatically split into ≤ 4 096-character chunks (Telegram API limit)
  - Shows `invocationMessage` in the chat panel while sending (no confirmation prompt required — fully non-blocking for the gauč workflow)
  - Shows a VS Code notification after successful send
  - Tool reads `lastSenderChatId` from the most recent incoming Telegram message; returns an error if no message was received yet or if the bridge is not running

**How to use in inject / direct mode (hybrid workflow):**

Add to your Telegram message or to a prompt file (e.g. AGENTS.md):
```
When you have finished the task, call the telegram_reply tool and summarise what was done.
```

Copilot will complete the work and then call `telegram_reply` automatically. You stay on the couch.

---

## [0.1.3] - 2026-03-20

### Fixed

- **`@tg` participant now has full workspace file access.** Rewrote `chatParticipant.ts` with a complete tool-calling loop using `vscode.lm.tools` + `vscode.lm.invokeTool`. The `@tg` participant now reads/writes files and searches the workspace exactly like `@workspace`, and still sends the Copilot response back to Telegram.
- Used `request.model` (user's currently active Copilot model) instead of the deprecated `vscode.lm.selectChatModels`.
- Fixed `TS2504` compile error: iterate `response.stream` instead of `response` directly.
- `stream.progress()` now displays the name of the tool being invoked (e.g. `🔧 vscode_readFile`) so you can watch the agent work in the chat panel.

### Added

- **Timestamp logging** — all Output Channel entries now include `[HH:MM:SS]` timestamps via `logInfo()` / `logError()` helpers.
- **`sendReplyWithRetry()`** — shared helper for the `replyDone` and `replyCustom` commands; shows **Retry** and **View Log** buttons when a Telegram send fails.

---

## [0.1.2] - 2026-03-19

### Added

- **`inject` mode** (new default `chatMode`): places the Telegram message into the existing VS Code Chat input box with `isPartialQuery: true`, preserving the full current conversation context. This is the recommended "couch workflow" mode.
- **`autoSubmit`** setting (default `true`): automatically submits the injected message after a configurable delay. Set to `false` to review the message before pressing Enter.
- **`submitDelay`** setting (default `1500 ms`): time in ms before auto-submit in inject mode; press Escape within this window to cancel.
- **`workspaceContext`** setting (`none` / `workspace` / `agent`): controls whether `@workspace` or `/new` (agent mode) is prepended to each message in inject/direct modes.

### Fixed

- **`/chatid` chicken-and-egg problem.** The `/chatid` and `/start` bot commands now always bypass the Chat ID allowlist so you can obtain your ID before adding it to `allowedChatIds`.

---

## [0.1.1] - 2026-03-18

### Added

- **Multi-window routing.** When multiple VS Code windows are open, only the *active* window processes incoming Telegram messages. The active window is tracked via `globalState` (key `telegramBridge.activeWorkspaceId`), shared across all VS Code windows via `vscode.ExtensionContext.globalState`.
- **`Set as active workspace` command** — switch message routing to the current window.
- **`Reply 'Done!' to Telegram`** command — sends a quick ✅ confirmation to the last Telegram sender.
- **`Send custom reply to Telegram`** command — opens an input box; whatever you type is sent back to the last sender.
- **Activity Bar sidebar panel** (`StatusViewProvider`) — shows live bridge status: running/stopped, bot name, active workspace, allowed chat count, last received message. Auto-refreshes every 5 seconds.
- **Extension icon** (`resources/icon.svg`) shown in the Activity Bar.

---

## [0.1.0] - 2026-03-17

### Added

- Initial release.
- **Telegram long-polling** with zero external dependencies — uses only the Node.js built-in `https` module.
- **`direct` mode**: Telegram messages are auto-submitted into VS Code Copilot Chat via `workbench.action.chat.open`.
- **`participant` mode** (`@tg`): two-way bridge — messages are routed through the `@tg` VS Code Chat Participant; Copilot responds and the reply is sent back to Telegram automatically.
- **Setup wizard** command — securely stores the bot token in the VS Code Secrets API. The token never appears in `settings.json` or logs.
- **Chat ID allowlist** — secure-by-default: the bridge ignores all messages unless the sender's Chat ID is explicitly listed in `telegramBridge.allowedChatIds`.
- **Status bar item** (`⬛ TG`) with one-click toggle and active-workspace indicator.
- **`Show log` command** — dedicated Output Channel with detailed debug logs.
