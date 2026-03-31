# Agent Guide: Working with Telegram Messages

This document explains how to configure AI agents to work with Telegram Bridge messages and respond appropriately.

## Understanding Telegram Messages

When you receive a message forwarded from Telegram, it will arrive in one of these modes:

### 1. Inject Mode (Recommended for Tasks)

Messages appear in your active chat with an instruction block:

```
[Telegram message from John Doe. When you finish the task, call telegram_reply with a concise summary of what was done, which files changed, and any warnings or next steps.]

Your actual telegram message text here...
```

**Agent behavior:**
- Process the task as requested
- When finished, **call the `telegram_reply` tool** with a summary
- Also respond in the VS Code chat for local visibility

**Example response pattern:**
```
I've completed the database migration task.

[calls telegram_reply with: "✅ Migration complete. Updated schema.sql and migration.ts. All tests passing."]
```

### 2. Direct Mode (Immediate Submit)

Same instruction block format, but submitted immediately without context preservation.

### 3. Participant Mode (@tg)

Messages arrive via the `@tg` chat participant without instruction blocks. The agent should automatically:
- Process the request
- Call `telegram_reply` with the result
- No need for explicit instructions

## The `telegram_reply` Tool

Available when Telegram Bridge is active. Used to send responses back to the Telegram user.

**Parameters:**
- `message` (string): The text to send back to Telegram

**Best practices:**
- Keep replies concise (mobile-friendly)
- Include outcome + changed files + warnings
- Use emojis for quick status: ✅ ❌ ⚠️ 🔄
- Don't include code blocks (Telegram has character limits)

**Example calls:**
```typescript
telegram_reply("✅ Pytest suite fixed. Updated test_api.py (3 tests now passing)")

telegram_reply("❌ Can't build: missing requirements.txt. Please commit it first.")

telegram_reply("🔄 ESLint fixes applied. Changed 5 files. Re-run npm test to verify.")
```

## Agent Configuration

### For Custom Agents (.agent.md)

Add this to your agent instructions:

```markdown
## Telegram Integration

When you receive a message with the instruction block:
> [Telegram message from ...]

1. Complete the requested task
2. Call `telegram_reply` with a concise summary (outcome + files + warnings)
3. Also respond in VS Code chat for visibility

Keep Telegram replies mobile-friendly: use emojis, short sentences, no code blocks.
```

### For Workspace Instructions (copilot-instructions.md)

Add at the top of your workspace instructions:

```markdown
## Telegram Task Responses

If the user message starts with `[Telegram message from ...]`:
- Process the task normally
- When finished, call the `telegram_reply` tool with a brief summary
- Format: outcome (✅/❌) + what changed + warnings
- Also respond in chat for local context
```

### For Skill Files (SKILL.md)

In the YAML frontmatter, you can restrict tool access:

```yaml
---
allowedTools:
  - telegram_reply
  - file_read
  - file_write
---
```

Or allow all tools (recommended for flexibility):

```yaml
---
allowedTools: ['*']
---
```

## Example Workflows

### Mobile → Agent → Mobile Reply

```
[User on phone]
  ↓ sends "fix failing pytest"
  
[Telegram Bridge]
  ↓ forwards to VS Code inject mode
  
[AI Agent]
  ✓ reads test files
  ✓ fixes assertions
  ✓ calls telegram_reply("✅ Fixed test_api.py. 12/12 tests passing.")
  ✓ responds in VS Code chat with details
  
[Telegram Bridge]
  ↓ sends reply to phone
  
[User on phone]
  ✓ sees "✅ Fixed..." notification
```

### Couch Workflow (User Away from Computer)

```
[User on couch]
  → "add CHANGELOG entry for v2.1.0"
  
[Agent processes autonomously]
  → reads git log
  → updates CHANGELOG.md
  → commits changes
  → telegram_reply("✅ CHANGELOG updated. Added 5 features, 3 fixes. Committed as a1b2c3d.")
  
[User on couch]
  → receives confirmation without touching computer
```

## Settings Reference

Configure Telegram Bridge behavior in VS Code settings:

- `telegramBridge.chatMode`: `inject` | `direct` | `participant`
- `telegramBridge.workspaceContext`: `agent` | `none` (adds @workspace /new)
- `telegramBridge.addTelegramReplyInstruction`: `true` | `false` (include instruction block)
- `telegramBridge.autoSubmit`: `true` | `false` (inject mode only)
- `telegramBridge.submitDelay`: milliseconds (default 2000)

## Troubleshooting

**Agent doesn't call `telegram_reply`:**
- Enable `addTelegramReplyInstruction` setting
- Check that MCP server is running (status bar shows "Bridge active")
- Verify agent has tool access (not restricted)

**Replies don't arrive on Telegram:**
- Check allowed chat IDs in settings
- Verify bot token is valid
- Look for errors in Output → Telegram Bridge

**Messages arrive without instruction block:**
- Disable `addTelegramReplyInstruction` if not needed
- Or manually include telegram_reply in your agent's tool list

## See Also

- [README.md](README.md) - Extension setup and configuration
- [AGENTS.md](AGENTS.md) - Low-context workflow for agent optimization
- [TASKS.md](TASKS.md) - Task tracking structure
- [MCP Documentation](https://modelcontextprotocol.io/) - Model Context Protocol details
