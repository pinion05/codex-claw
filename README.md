<img width="2760" height="1504" alt="Gemini_Generated_Image_yo0et3yo0et3yo0e" src="https://github.com/user-attachments/assets/a11d870c-a12e-4f28-91ea-a7a184d4f280" />


# codex-claw

`codex-claw` is a Bun + TypeScript Telegram-native generalized agent harness that is intended to combine grammY, the Codex SDK, and OpenAI-backed tooling in a small bot-friendly repository.

## What It Does

This bot runs locally on your machine and connects one Telegram chat to one persistent Codex thread.

- Normal Telegram messages are sent to the current Codex thread.
- The bot keeps the session alive between messages until you reset it.
- Only one run is allowed at a time for the chat.
- Telegram albums are coalesced into one prepared run before Codex sees them.
- It can also run scheduled Codex message jobs from local JSON definitions.
- On startup it attempts to install packaged Codex skills for cronjob creation and interactive CLI automation guidance.
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

On startup, the CLI also attempts to install packaged skills to:

```text
~/.codex/skills/codex-claw-cronjob-creator/SKILL.md
~/.codex/skills/codex-claw-agentty/SKILL.md
~/.codex/skills/codex-claw-telegram-file-send/SKILL.md
```

Those skills can be used by Codex to create scheduled job definition files and to prefer `npx -y agentty-cli` for interactive CLI login and approval flows.
The packaged `codex-claw-telegram-file-send` skill lets Codex send one local file to the current active `codex-claw` Telegram chat as a Telegram document.

The CLI attempts to sync the Telegram slash-command menu on startup so it stays aligned with the commands the bot actually supports. If Telegram rejects that sync request, bot startup still continues and the CLI only logs a warning.

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

## Telegram Attachments

Document uploads, single photos, and media-group albums are normalized into one bundle before the runtime prepares the Codex prompt.

- Telegram albums are coalesced into one prepared run keyed by the lowest message id in the media group.
- The lowest message id remains the inbox bundle directory id even if a later album item provides the caption.
- Failed downloads do not discard the whole bundle. Successful attachments stay in the prompt, and failed ones are recorded in `failedAttachments`.
- If every download fails, the runtime still prepares one Codex turn using the user caption or the default attachment request plus failure metadata.
- Late album items that arrive during the tombstone window are ignored, and items that arrive after that window are treated as a new delivery attempt instead of being appended to the already finalized bundle.

Attachment bundles are written under the fixed workspace inbox:

```text
~/.codex-claw/workspace/inbox/<chatId>/<messageId>/bundle.json
```

The inbox metadata format is v2. The saved `bundle.json` and the prepared prompt both reflect the same attachment ordering and the same `failedAttachments` entries.

Example `bundle.json`:

```json
{
  "version": 2,
  "chatId": 123,
  "messageId": 456,
  "mediaGroupId": "album-1",
  "caption": "Check what arrived and what failed.",
  "attachments": [
    {
      "index": 2,
      "kind": "photo",
      "name": "album-second.jpg",
      "path": "/home/me/.codex-claw/workspace/inbox/123/456/2-album-second.jpg"
    }
  ],
  "failedAttachments": [
    {
      "index": 1,
      "name": "album-first.jpg",
      "reason": "download failed"
    }
  ]
}
```

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
- Cron results may still notify the persisted Telegram chat even though the Codex execution happens in a fresh thread.
- A delivery failure does not mean the scheduled prompt did not run; execution and delivery are tracked separately.
- If there is no persisted target chat yet, the cron job will skip execution entirely instead of running without a delivery target.
- Cron jobs still run immediately and deliver to the persisted Telegram chat even if an interactive run is already active.

## Commands

- `/start` shows the same quick help as `/help`.
- `/status` shows whether the persistent Codex thread is idle or running.
- `/reset` clears the current session after the active run has stopped.
- `/abort` requests cancellation for the active run.
- `/help` shows the command summary.

Notes:

- The Telegram slash-command menu is synced automatically during startup.
- `/reset` only succeeds when no run is active.
- `/abort` is best-effort cancellation for the current in-flight turn.
- If you send a new message while a run is still active, the runtime rejects the overlapping run.

## Runtime Model

`codex-claw` uses a fixed workspace at `~/.codex-claw/workspace` by default.

This workspace is the bot's operational home and contains things like:

- `state/session.json` for the persistent chat session metadata
- `logs/YYYY/MM/DD/*.json` for structured run logs and cron execution/delivery/skip logs

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
