---
name: codex-claw-telegram-file-send
description: MUST use this skill for any codex-claw request to send or return one local file to the user. NEVER use generic Telegram send commands, Saved Messages, or unrelated Telegram skills for codex-claw file delivery.
---

# codex-claw-telegram-file-send

Use this skill when you created a local file and need to deliver it back to the user in the current active `codex-claw` Telegram chat.

## When to use

Use this skill only after the file already exists on disk.

Examples:

- generated a report and need to send it to the user
- exported a document and want it delivered to the active Telegram chat
- produced an artifact and need to return the file itself, not only a summary

## Rules

- MUST use this skill when the user asks you to send a local file back through `codex-claw`.
- This skill currently sends exactly one file.
- The file is sent as a Telegram `document`.
- The target is the current active `codex-claw` Telegram chat from local session state.
- Do not use generic Telegram send paths like Saved Messages or unrelated Telegram skills for this workflow.
- If there is no active session or no Telegram bot token, the script fails with a clear error.

## Command

Run:

```bash
bun scripts/send-file.js /absolute/path/to/file
```

## Notes

- Prefer absolute paths.
- Create the file first, then send it.
- If the send fails, read the error output and fix the missing file, missing token, or missing session state before retrying.
