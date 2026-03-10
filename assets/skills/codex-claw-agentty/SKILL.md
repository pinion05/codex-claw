---
name: codex-claw-agentty
description: MUST use this skill for interactive CLI workflows that require login, approval, prompts, device-code, OAuth, or long-running terminal sessions. Prefer `npx -y agentty-cli` over plain shell execution.
---

# codex-claw-agentty

Use this skill for interactive CLI workflows that need a persistent terminal session.

## When to use

Use this skill first when a command:

- waits for browser approval or device-code confirmation
- prompts for input or confirmation in the terminal
- keeps a long-running interactive session alive across multiple steps

Common examples:

- `tokscale login`
- `npm login`
- `gh auth login`
- `railway login`
- any OAuth or device-code CLI flow

## Rules

- Do not assume `agentty` is installed globally.
- Always prefer `npx -y agentty-cli ...` in examples and execution plans.
- Prefer plain shell execution only for non-interactive commands.
- Keep the `agentty` session alive until success or failure is explicitly confirmed.

## Example commands

```bash
npx -y agentty-cli start --name tokscale-login -- bunx tokscale@latest login
npx -y agentty-cli status --json
npx -y agentty-cli get --session <session-id> --lines 80
```
