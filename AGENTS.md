# Agent Workflow

Use this repository with a low-context workflow.

## First Read

Before doing any substantial work, read only:

1. `NOW_NEXT.md`
2. `TASKS.md`
3. files directly relevant to the selected task

Do not scan the whole repository unless the task explicitly requires it.

## Task Rules

- Every task must have an ID like `TB-001`.
- Work from one task at a time unless the user explicitly asks for batching.
- When you start a task, move it to `In Progress` in `TASKS.md`.
- When you finish a task, move it to `Done` and update `NOW_NEXT.md`.
- Keep `NOW_NEXT.md` short: current focus, blockers, next 3 items max.

## Context Budget

- Prefer reading one target file plus `NOW_NEXT.md` over broad repo searches.
- Summarise findings into `NOW_NEXT.md` instead of re-reading old chat history.
- For follow-up work, continue from task IDs and summaries rather than past conversation.
- Avoid pasting large logs into chat; store only compact conclusions.

## Telegram Workflow

If a task came from Telegram, call `telegram_reply` when finished and include:

- what was done
- which files changed
- any warnings or next steps

Keep the reply concise.

## Prompt Templates

Use prompts like these to keep context usage low and make tool usage explicit.

### Continue current work

```text
Read NOW_NEXT.md and TASKS.md first.
Do not scan the whole repository.
Continue the current task only.
Read only the files directly needed for that task.
When finished, update TASKS.md and NOW_NEXT.md.
If the task came from Telegram, call telegram_reply with a concise summary.
```

### Start a specific task

```text
Read NOW_NEXT.md and TASKS.md first.
Start task TB-00X.
Move it to In Progress.
Read only the files directly relevant to TB-00X.
Do the work, then move the task to Done and update NOW_NEXT.md.
If this task came from Telegram, call telegram_reply when finished.
```

### Ask for task counts

```text
Read TASKS.md only.
Tell me how many tasks are in Backlog, In Progress, and Done.
Do not scan any other files.
```

### Telegram hybrid workflow

```text
This task came from Telegram.
Read NOW_NEXT.md and TASKS.md first.
Use the current chat context if needed, but avoid broad repo scans.
Do the requested work.
When finished, call telegram_reply and include:
- what was done
- which files changed
- any warnings or next steps
Then update TASKS.md and NOW_NEXT.md if the task should be tracked.
```

### Investigate without filling context

```text
Read NOW_NEXT.md first.
Investigate only the file(s) directly related to the issue.
Do not scan the whole repository unless you get blocked.
Summarise findings briefly.
If more work is needed, add or update a task in TASKS.md.
```
