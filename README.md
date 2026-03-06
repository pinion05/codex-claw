# codex-claw

`codex-claw` is a Bun + TypeScript Telegram-native generalized agent harness that is intended to combine grammY, the Codex SDK, and OpenAI-backed tooling in a small bot-friendly repository.

## What It Does

This bot runs locally on your machine and connects one Telegram chat to one persistent Codex thread.

- Normal Telegram messages are sent to the current Codex thread.
- The bot keeps the session alive between messages until you reset it.
- Only one run is allowed at a time for the chat.
- The bot keeps an operational workspace for session state and logs, but it may still read or modify files outside that workspace if the request calls for it.

## Requirements

- Bun
- A Telegram bot token from `@BotFather`
- Local Codex CLI authentication via `codex login`

## Setup

1. Install dependencies.

```bash
bun install
```

2. Copy `.env.example` to `.env`.

```bash
cp .env.example .env
```

3. Authenticate the local Codex CLI.

```bash
codex login
```

This project reuses the local Codex CLI authentication by default.

4. Choose how to provide the Telegram bot token.

Option A: let `bun run dev` ask for it on first start.

- If `TELEGRAM_BOT_TOKEN` is not set in env or `.env`, the app prompts in the terminal.
- The entered token is saved in `~/.codex-claw/local-config.json`.
- On later runs, that saved token is reused until you override it with an env value.

Option B: pre-fill `.env` yourself.

```dotenv
TELEGRAM_BOT_TOKEN=123456:your-telegram-bot-token
# Optional override if you do not want to reuse local `codex login`
OPENAI_API_KEY=
CODEX_WORKSPACE_DIR=
```

- `TELEGRAM_BOT_TOKEN`: optional if you want interactive first-run setup
- `OPENAI_API_KEY`: optional override
  If left empty, the SDK reuses your local Codex CLI authentication.
- `CODEX_WORKSPACE_DIR`: optional
  If omitted or left blank, the bot uses `~/.codex-claw/workspace`.

5. Run the local checks.

```bash
bun run check
```

6. Start the bot.

```bash
bun run dev
```

If no Telegram token is configured yet, the app will prompt:

```text
TELEGRAM_BOT_TOKEN을 입력하세요:
```

After you enter it once, the value is reused from `~/.codex-claw/local-config.json`.

For a non-watch run, use:

```bash
bun run start
```

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

`codex-claw` uses a fixed workspace at `~/.codex-claw/workspace` by default. You can override that location with `CODEX_WORKSPACE_DIR`.

This workspace is the bot's operational home and contains things like:

- `state/session.json` for the persistent chat session metadata
- `logs/YYYY/MM/DD/*.json` for structured run logs

The fixed operational workspace stores local state and logs under predictable paths, but the agent is not restricted to that directory for user-requested work. When Codex decides it needs to inspect or modify files outside that workspace, it may still read and write outside that workspace.

## Local Development

- `bun run dev` starts the Telegram bot with file watching.
- `bun run start` starts the bot once without watch mode.
- `bun run check` runs the full verification suite.
- `bun run typecheck` runs the TypeScript typecheck.
- `bun test` runs the unit, integration, and smoke tests.

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
