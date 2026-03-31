# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.2.1] - 2026-03-31

### Added

- **Configurable message formatting** — New `telegramBridge.replyFormat` setting allows choosing between four Telegram formatting modes:
  - `plain` — No formatting (safest, no escaping needed)
  - `Markdown` — Legacy format with `*bold*`, `_italic_`, `` `code` ``, `[links](url)` support
  - `MarkdownV2` — Strict Markdown with full feature support and required escaping
  - `HTML` — HTML tags (`<b>`, `<i>`, `<code>`, `<a href="">`). **Default and recommended**.
- **Text formatting utilities** (`src/textFormatter.ts`) — New module with automatic escaping functions for each format mode, ensuring special characters are properly handled.
- **Message Formatting documentation** — New README section explaining all format options, their trade-offs, and when to use each.

### Changed

- All `sendMessage()` calls now apply configured formatting with automatic text escaping based on selected mode.
- Telegram replies now use HTML formatting by default (instead of plain text), providing better readability with bold text, code blocks, and clickable links while remaining reliable.
- MCP `telegram_reply` tool, rate limit notifications, `/chatid` responses, and manual reply commands all use configured formatting.

### Fixed

- **Message formatting regression** — Restored rich text formatting in Telegram replies. Version 0.1.9 removed all formatting to fix parsing errors; this version reintroduces formatting with proper escaping to prevent those errors.

---

## [0.2.0] - 2026-03-31

### Added

- **MCP HTTP authentication** — HTTP bridge now requires shared secret authentication via `X-MCP-Secret` header. Secret is auto-generated on server startup and stored in `~/.vscode-telegram-bridge/secret`. Prevents unauthorized access to MCP endpoint.
- **Request size limits** — HTTP server enforces 1 MB maximum request body size to prevent denial-of-service attacks. Returns HTTP 413 (Payload Too Large) when exceeded.
- **Message length validation** — Incoming messages validated against 100 KB maximum size before processing. Protects against memory exhaustion and excessive API calls.
- **Rate limiting** — Sliding window rate limiter enforces 10 messages per minute per Chat ID. Users receive notification when limit exceeded with retry-after time. Prevents spam and API quota abuse.
- **Setup command protection** — `/chatid` and `/start` commands only allowed when `allowedChatIds` is empty (initial setup). After configuration, these commands are blocked to prevent information disclosure attacks.
- **Constants module** (`src/constants.ts`) — All magic numbers extracted to application-wide constants with documentation. Improves maintainability and consistency.
- **Error sanitization** (`src/errorHandler.ts`) — New error handling module sanitizes sensitive information (tokens, Chat IDs, file paths) from user-visible errors. Provides user-friendly generic messages while preserving detailed logs.
- **Rate limiter module** (`src/rateLimit.ts`) — Reusable sliding window rate limiter with timestamp tracking and retry-after calculation.
- **Development guide** (`DEVELOPMENT.md`) — Comprehensive developer documentation covering architecture, security model, testing, release process, and common issues.

### Changed

- **TypeScript strict mode enabled** — Full TypeScript strict compilation already active, ensuring type safety across the codebase.
- **Enhanced security logging** — Setup mode state (enabled/disabled) now logged on bridge startup. Authentication failures logged with context.
- **HTTP message chunking** — Uses `TELEGRAM_MESSAGE_MAX_LENGTH` constant (4096) instead of hardcoded value for consistency.
- **Error messages** — All user-facing errors now sanitized to remove sensitive information. Detailed errors still logged for debugging.

### Security

- **HIGH:** Fixed `/chatid` bypass vulnerability (TB-010) — Setup commands no longer bypass allowlist after initial configuration
- **HIGH:** Added MCP endpoint authentication (TB-006) — Prevents unauthorized tool invocations
- **MEDIUM:** Implemented request size limits (TB-007) — Protects against DOS attacks
- **MEDIUM:** Added message length validation (TB-008) — Prevents memory exhaustion
- **MEDIUM:** Error message sanitization (TB-009) — Prevents information leakage

### Fixed

- **Crypto import** — Node.js `crypto` module now properly imported for secure random generation in `generateSecret()`.

---

## [0.1.9] - 2026-03-31

### Added

- **Agent documentation** — new `AGENT_TELEGRAM_GUIDE.md` with comprehensive instructions for AI agents on handling Telegram messages, calling `telegram_reply`, and configuring custom agents/skills/workspace instructions.

### Changed

- **Removed `from_telegram:` prefix** — the instruction block already identifies Telegram origin, making the prefix redundant.
- **Removed Markdown parsing** — `parse_mode: 'Markdown'` removed from `sendMessage` to prevent entity parsing errors when AI responses contain unescaped special characters. Telegram replies now sent as plain text.

### Fixed

- **Entity parsing errors** — fixes "Can't find end of the entity starting at byte offset X" errors that occurred when AI responses contained Markdown-like syntax without proper escaping.

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
