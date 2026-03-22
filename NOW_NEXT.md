# Now / Next

## Now

- Telegram Bridge supports inject, participant, and MCP-based `telegram_reply` replies.
- Recommended mobile workflow: `inject` + `workspaceContext: agent` + `AGENTS.md` instruction to call `telegram_reply`.

## Known Constraints

- Only one Telegram poller instance should run per bot token; duplicate windows can cause Telegram `getUpdates` conflicts.
- The MCP reply path needs the bridge running and at least one received Telegram message so the last sender chat ID is known.

## Next

- Keep task tracking in `TASKS.md`
- Keep this file short and current
- Prefer updating these summaries over relying on long chat history
