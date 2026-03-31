# Development Guide

## Quick Start

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Package extension
npm run package

# Watch mode for development
npm run watch
```

## Project Structure

```
telegram-bridge/
├── src/
│   ├── extension.ts          # Main extension entry point
│   ├── telegramPoller.ts     # Telegram Bot API client (long-polling)
│   ├── chatParticipant.ts    # @tg participant for Copilot Chat
│   ├── statusView.ts         # Activity Bar sidebar panel
│   ├── constants.ts          # Application-wide constants
│   ├── errorHandler.ts       # Error sanitization and formatting
│   └── rateLimit.ts          # Rate limiting for incoming messages
├── resources/
│   └── mcp-server.js         # MCP stdio server for telegram_reply tool
├── .github/workflows/
│   ├── ci.yml               # Build on push/PR
│   └── release.yml          # Auto-release on v* tag push
├── AGENTS.md                 # Low-context workflow for AI agents
├── TASKS.md                  # Task tracking with TB-xxx IDs
└── NOW_NEXT.md               # Current state and next steps
```

## Architecture

### Message Flow

**Telegram → VS Code:**
1. `TelegramPoller` uses `getUpdates` long-polling (25s timeout)
2. Only messages from `allowedChatIds` are processed
3. `handleTelegramMessage()` routes based on `chatMode`:
   - **inject** (default): Inserts message into chat input, preserves context
   - **direct**: Auto-submits message immediately
   - **participant**: Routes to `@tg` participant with isolated context

**VS Code → Telegram:**
1. Copilot agent calls `#telegram_reply` LM tool
2. Tool POSTs JSON to localhost HTTP server (127.0.0.1:random-port)
3. HTTP server authenticates request (shared secret) and enforces limits
4. Extension chunks message (4096 char limit) and sends via Bot API

### MCP Integration

**MCP Server** (`resources/mcp-server.js`):
- Implements Model Context Protocol over stdio
- Exposes `telegram_reply` tool to Copilot and all AI agents
- Reads port and secret from `~/.vscode-telegram-bridge/` files
- Zero external dependencies (Node.js built-ins only)

**HTTP Bridge** (in `extension.ts`):
- Listens on `127.0.0.1:random-port` (loopback only)
- Requires `X-MCP-Secret` header for authentication
- Enforces request size (1 MB) and message length (100 KB) limits
- Chunks long messages for Telegram API compatibility

### Security Architecture

**v0.2.0 Security Enhancements:**

1. **Authentication**
   - Shared secret generated on HTTP server startup
   - MCP client must provide `X-MCP-Secret` header
   - Secret stored in `~/.vscode-telegram-bridge/secret`

2. **Input Validation**
   - Request body size limit: 1 MB (MAX_REQUEST_BODY_SIZE)
   - Message length limit: 100 KB (MAX_MESSAGE_LENGTH)
   - Chat ID format validation
   - Token format validation (regex)

3. **Rate Limiting**
   - Sliding window: 10 messages per minute per Chat ID
   - User notification on rate limit exceeded
   - Automatic cleanup of expired timestamps

4. **Setup Command Protection**
   - `/chatid` and `/start` only allowed when `allowedChatIds` is empty
   - Prevents information disclosure after initial setup
   - Logged in output channel for auditing

5. **Error Sanitization**
   - Tokens, Chat IDs, file paths removed from user-visible errors
   - Generic error messages for common failure modes
   - Detailed logging for debugging (with token redaction)

## Development Workflow

### Adding a New Feature

1. Create task in `TASKS.md` with unique TB-xxx ID
2. Move task to "In Progress"
3. Implement feature with:
   - Type safety (TypeScript strict mode enabled)
   - Error handling and logging
   - Security considerations (input validation, sanitization)
4. Test manually (no automated tests yet - see TB-011)
5. Update `CHANGELOG.md` with change
6. Move task to "Done"

### Constants Management

All magic numbers should be defined in `constants.ts`:
- Telegram API limits
- Retry/resilience parameters
- Security limits
- UI display settings
- Time conversions

### Error Handling

Use `errorHandler.ts` functions:
- `sanitizeError(err, context)` - For user-facing messages
- `formatErrorForLog(err, context)` - For logging (includes details)
- `isRetryableError(err)` - Check if error warrants retry

### Rate Limiting

Use `RateLimiter` class from `rateLimit.ts`:
```typescript
const limiter = new RateLimiter();
if (!limiter.check(key)) {
  const retryAfter = limiter.getRetryAfter(key);
  // Reject request
}
```

## Building and Testing

### Manual Testing

1. **Setup:**
   ```bash
   npm run compile
   ```
   Press F5 in VS Code to launch Extension Development Host

2. **Test Bot Token:**
   - Run "Telegram Bridge: Průvodce nastavením"
   - Verify token with Telegram API
   - Check Output panel for connection logs

3. **Test Message Flow:**
   - Send message to bot from Telegram
   - Verify message appears in VS Code
   - Check rate limiting (send 11 messages quickly)
   - Verify error sanitization (invalid requests)

4. **Test MCP Tool:**
   - Open Copilot Chat
   - Include instruction: "Use #telegram_reply to send result"
   - Verify tool appears in tool list
   - Check authentication (secret validation)
   - Verify message chunking (send >4096 chars)

### Release Process

1. Update version in `package.json`
2. Update `CHANGELOG.md` with new version section
3. Commit changes: `git commit -am "Release vX.Y.Z"`
4. Tag: `git tag vX.Y.Z`
5. Push: `git push && git push --tags`
6. GitHub Actions will automatically:
   - Build `.vsix` package
   - Extract changelog section
   - Create GitHub Release with download link

## Configuration

### User Settings

All settings are under `telegramBridge.*`:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `autoStart` | boolean | `false` | Auto-start bridge on VS Code launch |
| `chatMode` | enum | `"inject"` | Message delivery mode (`inject`/`direct`/`participant`) |
| `allowedChatIds` | string[] | `[]` | Allowlist of Telegram Chat IDs |
| `autoSubmit` | boolean | `false` | Auto-submit in direct mode |
| `submitDelay` | number | `500` | Delay before auto-submit (ms) |
| `prefixMessage` | boolean | `true` | Add emoji prefix to messages |
| `workspaceContext` | enum | `"workspace"` | Workspace awareness (`none`/`workspace`/`agent`) |
| `addTelegramReplyInstructionfalse` | boolean | `true` | Add instruction to use telegram_reply tool |

### Secret Storage

Bot token stored in VS Code Secrets API:
- Key: `telegramBridge.botToken`
- Encrypted storage
- Never written to `settings.json` or logs

### MCP Registration

Extension auto-registers MCP server in `.vscode/settings.json`:
```json
{
  "mcpServers": {
    "telegram-bridge": {
      "command": "node",
      "args": ["~/.vscode-telegram-bridge/mcp-server.js"]
    }
  }
}
```

## Debugging

### Output Panel

View detailed logs:
1. Open Output panel (Ctrl+Shift+U / Cmd+Shift+U)
2. Select "Telegram Bridge" from dropdown
3. Timestamps format: `[HH:MM:SS.mmm]`

### Common Issues

**"Telegram Bridge is not running"**
- MCP server can't read port file
- Solution: Stop/start bridge, check `~/.vscode-telegram-bridge/port`

**"Conflict – another instance active"**
- Two VS Code windows polling same bot
- Solution: Run "Set as active workspace" in desired window

**"Rate limit exceeded"**
- More than 10 messages per minute from one Chat ID
- Solution: Wait 60 seconds, then retry

**"Unauthorized: invalid or missing secret"**
- MCP secret file missing or incorrect
- Solution: Restart bridge (regenerates secret)

##Known Limitations

1. **No automated tests** (TB-011 backlog item)
2. **Long functions** (TB-014 - refactoring planned)
3. **No circuit breaker** for Telegram API (TB-016)
4. **No EventEmitter pattern** in TelegramPoller (TB-018)
5. **Centralized state management** not implemented (TB-019)

These are tracked in `TASKS.md` for future versions.

## Contributing

1. Read `AGENTS.md` for low-context workflow guidelines
2. Create task in `TASKS.md` before starting work
3. Use prompt templates from `AGENTS.md` when working with AI agents
4. Update `CHANGELOG.md` for all user-facing changes
5. Ensure TypeScript compiles without errors
6. Test manually in Extension Development Host

## Resources

- [Telegram Bot API](https://core.telegram.org/bots/api)
- [VS Code Extension API](https://code.visualstudio.com/api)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Keep a Changelog](https://keepachangelog.com/)
