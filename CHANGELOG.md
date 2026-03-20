# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
