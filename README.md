# codex-claw

`codex-claw` is a Bun + TypeScript Telegram-native generalized agent harness that is intended to combine grammY, the Codex SDK, and OpenAI-backed tooling in a small bot-friendly repository.

## What It Does

This bot runs locally on your machine and connects one Telegram chat to one persistent Codex thread.

- Normal Telegram messages are sent to the current Codex thread.
- The bot keeps the session alive between messages until you reset it.
- Only one run is allowed at a time for the chat.
- It can also run scheduled Codex message jobs from local JSON definitions.
- On startup it installs a packaged Codex skill for creating those cronjob definitions.
- The bot keeps an operational workspace for session state and logs, but it may still read or modify files outside that workspace if the request calls for it.

## Requirements

- Bun
- A Telegram bot token from `@BotFather`
- Local Codex CLI authentication via `codex login`

## Setup

1. Authenticate the local Codex CLI.

```bash
codex login
```

This project reuses the local Codex CLI authentication by default.

2. Start the bot directly with `bunx`.

```bash
bunx @npmc_5/codex-claw
```

`bunx` downloads the published CLI and runs it immediately, so no separate install step is required.

3. On first start, if no Telegram bot token has been saved yet, the app will prompt:

```text
TELEGRAM_BOT_TOKEN을 입력하세요:
```

After you enter it once, the value is saved to `~/.codex-claw/local-config.json` and reused on later runs.
No separate configuration file is required for normal usage.

On startup, the CLI also installs the packaged cronjob creator skill to:

```text
~/.codex/skills/codex-claw-cronjob-creator/SKILL.md
```

That skill can be used by Codex to create scheduled job definition files.

## Telegram Usage

Once the process is running, open your bot in Telegram and send plain text instructions.

Example prompts:

- `이 프로젝트 구조 요약해줘`
- `~/dev/my-app 에서 테스트 실패 원인 찾아줘`
- `현재 작업 내용을 바탕으로 README 초안 써줘`
- `이 경로의 파일들을 보고 다음 작업 계획 세워줘: /Users/me/project`

The bot will keep using the same Codex thread for follow-up messages in that chat.

Example:

1. `이 저장소 구조 파악해줘`
2. `그럼 다음으로 테스트부터 돌려봐`
3. `방금 수정한 내용 요약해줘`

## Scheduled Jobs

`codex-claw` can run scheduled Codex prompts from JSON definitions stored under:

```text
~/.codex-claw/cronjobs
```

Each job lives in its own file such as `~/.codex-claw/cronjobs/daily-summary.json`.

Supported shape:

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

Notes:

- `time` is required and must use `HH:mm`.
- `date` is optional and must use `YYYY-MM-DD`.
- If `date` is omitted, the job runs every day at that local time.
- If `date` is present, the job runs once on that local date and time.
- `action.type` is currently fixed to `"message"`.
- Scheduled jobs run in fresh Codex threads, separate from the active Telegram chat thread.

## Commands

- `/status` shows whether the persistent Codex thread is idle or running.
- `/reset` clears the current session after the active run has stopped.
- `/abort` requests cancellation for the active run.
- `/help` shows the command summary.

Notes:

- `/reset` only succeeds when no run is active.
- `/abort` is best-effort cancellation for the current in-flight turn.
- If you send a new message while a run is still active, the runtime rejects the overlapping run.

## Runtime Model

`codex-claw` uses a fixed workspace at `~/.codex-claw/workspace` by default.

This workspace is the bot's operational home and contains things like:

- `state/session.json` for the persistent chat session metadata
- `logs/YYYY/MM/DD/*.json` for structured run logs

The fixed operational workspace stores local state and logs under predictable paths, but the agent is not restricted to that directory for user-requested work. When Codex decides it needs to inspect or modify files outside that workspace, it may still read and write outside that workspace.

## Repository Maintenance

This README intentionally documents the published `bunx` flow.
Repository checks and release steps remain in `package.json` scripts.

## Publishing

Before publishing, make sure your npm registry auth is available to Bun.

```bash
bun pm whoami
```

Recommended release flow:

1. Run the full checks.

```bash
bun run check
```

2. Inspect the package tarball and registry publish dry-run.

```bash
bun run pack:dry-run
bun run publish:dry-run
```

3. Bump the version.

```bash
bun run release:patch
# or
bun run release:minor
# or
bun run release:major
```

4. Publish to npm.

```bash
bun run publish:npm
```

Notes:

- `prepublishOnly` runs `bun run check` before publish.
- This package is intended for Bun-based usage and is published through `bun publish`.

## Smoke Testing

See `docs/plans/smoke-test-checklist.md` for the manual end-to-end checklist used to verify the local Telegram flow.
