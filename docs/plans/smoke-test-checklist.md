# Smoke Test Checklist

Use this checklist after running `codex login`. `OPENAI_API_KEY` and `CODEX_WORKSPACE_DIR` are optional overrides.

1. Start the bot locally with `bun run dev`.
2. If `TELEGRAM_BOT_TOKEN` is not set in env, confirm the terminal prompts for it.
3. Enter the token once and confirm it is saved to `~/.codex-claw/local-config.json`.
4. Confirm the process starts without crashing and logs the configured workspace path.
5. Stop and restart the bot, then confirm it does not ask for the token again unless env overrides it.
6. Send a normal Telegram message to the bot.
7. Confirm the bot replies and creates local session state under the fixed workspace.
8. Send another normal Telegram message.
9. Confirm the second reply continues the same Codex context instead of starting from scratch.
10. Send `/status`.
11. Confirm the response shows the current thread and whether the bot is idle or running.
12. Start a longer-running request, then send `/abort`.
13. Confirm the bot acknowledges the abort request and the in-flight run stops cleanly.
14. Send `/reset`.
15. Confirm the bot resets the session and the next normal message starts a fresh Codex thread.
