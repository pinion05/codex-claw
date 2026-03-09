---
name: codex-claw-cronjob-creator
description: Create or update codex-claw scheduled job definitions under ~/.codex-claw/cronjobs.
---

# codex-claw-cronjob-creator

Create or update scheduled job definitions for `codex-claw`.

## When to use

Use this skill when the user wants a prompt to run at a specific time through `codex-claw`.

## Behavior

1. Definitions live in `~/.codex-claw/cronjobs`.
2. Create exactly one JSON file per job.
3. File name should be `<id>.json`.
4. Supported schema:

```json
{
  "id": "daily-summary",
  "time": "09:00",
  "date": "2027-07-12",
  "disabled": false,
  "action": {
    "type": "message",
    "prompt": "Summarize yesterday's work."
  }
}
```

## Rules

- `id`: required, stable unique identifier
- `time`: required, `HH:mm`
- `date`: optional, if present the job runs once on that local date and time
- `disabled`: optional, defaults to `false`
- `action.type`: must be `"message"`
- `action.prompt`: required prompt text to send to Codex

## Output

- Write the job JSON into `~/.codex-claw/cronjobs/<id>.json`
- If updating an existing job, overwrite only that file
- Do not create shell commands or other action types
