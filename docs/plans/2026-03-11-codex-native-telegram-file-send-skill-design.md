# Codex Native Telegram File-Send Skill Design

**Date:** 2026-03-11
**Issue:** `#28` `feat: Codex native Telegram file-send skill 패키징 및 기본 설치`

## Goal

Allow Codex to send a locally generated file back to the currently active `codex-claw` Telegram chat through a packaged, self-contained skill, without making `codex-claw` parse Codex responses or maintain a wrapper-level file handoff protocol.

## Philosophy

This feature should remain Codex-native.

- Codex decides when a file should be sent.
- Codex invokes a skill directly to send it.
- `codex-claw` only packages the capability and provides the local state needed to target the current Telegram chat.

This intentionally avoids a design where `codex-claw` interprets model output and performs file delivery as a wrapper concern.

## Chosen Approach

Package a new skill, for example `codex-claw-telegram-file-send`, with:

- `SKILL.md`
- `scripts/send-file.js`

The skill instructs Codex to call the packaged script after it creates an artifact that should be delivered. The script resolves the active Telegram target from local `codex-claw` state and sends the file directly through the Telegram Bot API.

## Data Sources

The packaged script will resolve runtime context from the same local files the application already maintains:

- Bot token: `~/.codex-claw/local-config.json`
- Active session: `~/.codex-claw/workspace/state/session.json`

The active target chat is the current persisted `codex-claw` Telegram chat. If there is no active session or token, the script fails with a clear error.

## MVP Scope

The first version intentionally stays narrow:

- Input: one local file path
- Delivery type: Telegram `document`
- Target: current active `codex-claw` Telegram chat
- Transport: direct Telegram Bot API call from the packaged script

Out of scope for the MVP:

- multi-file send
- automatic `photo` vs `document` branching
- captions
- explicit alternate chat targeting
- outbox queueing
- wrapper-side parsing of Codex output

## Validation Rules

The packaged script should validate only transport-critical conditions:

- the file path exists
- the file is a regular file
- the Telegram bot token is configured
- an active persisted chat session exists

Failures should be explicit and machine-actionable through exit code and stderr output.

Expected failure examples:

- `No active codex-claw Telegram session found`
- `Telegram bot token is not configured`
- `File does not exist: ...`
- `Path is not a regular file: ...`
- `Telegram send failed: <status> <statusText>`

## Packaging Changes

Current packaged skill installation copies only `SKILL.md`. That is insufficient for a self-contained skill with scripts.

The packaging/install flow should be extended so a packaged skill directory can include additional assets such as:

- `scripts/*.js`
- optional helper files in the skill folder

That means the installer should move from "copy one markdown file" to "copy a packaged skill directory".

## Documentation

The new skill should document:

- when to use it
- how Codex should call the script
- the single-file `document` limitation
- what runtime assumptions exist
  - current active chat required
  - bot token required

The repository README should also mention that `codex-claw` installs this file-send skill alongside other packaged skills.

## Testing Strategy

### Unit Tests

- packaged skill installation copies `SKILL.md` and `scripts/`
- file-send script rejects missing file
- file-send script rejects missing token
- file-send script rejects missing session
- file-send script rejects non-file paths

### Integration Tests

- runtime workspace setup installs the new skill directory
- script reads persisted state and builds the expected Telegram request

### Smoke Coverage

- README or packaged skill documentation references the file-send workflow

## Risks

### Coupling To Internal State Paths

The packaged script depends on `codex-claw` local state layout. This is acceptable for the self-contained packaged-skill approach, but should remain localized in one script rather than spread across documentation or multiple tools.

### Single Persisted Chat Assumption

The script targets the currently persisted session. This is consistent with current `codex-claw` behavior, but it means file sends depend on an active session having been established at least once.

### Telegram API Surface

Using direct Bot API `document` upload is simple and reliable for MVP, but richer media handling should remain a separate follow-up rather than expanding the first version.

## Summary

The design keeps file delivery Codex-native by giving Codex a packaged self-contained skill that can send one local file to the current active `codex-claw` Telegram chat. The necessary product work is limited to packaging, installation, documentation, and a small script that reads existing local state and calls the Telegram Bot API.
