# codex-claw

`codex-claw` is a Bun + TypeScript Telegram-native generalized agent harness that is intended to combine grammY, the Codex SDK, and OpenAI-backed tooling in a small bot-friendly repository.

## Setup

Install dependencies with `bun install`, copy `.env.example` to `.env`, fill in `TELEGRAM_BOT_TOKEN`, `OPENAI_API_KEY`, and `CODEX_WORKSPACE_DIR`, then use `bun test` for smoke checks or `bun run dev` once runtime code is added.
