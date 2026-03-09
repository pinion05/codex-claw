# Cron Skill Auto-Install Design

## Goal

Install the packaged `codex-claw-cronjob-creator` skill into `~/.codex/skills/` whenever `npx codex-claw` starts, without blocking bot startup if installation fails.

## Decisions

- The source of truth for the skill content is a packaged static Markdown asset.
- The packaged asset is copied to `~/.codex/skills/codex-claw-cronjob-creator/SKILL.md`.
- Installation runs during normal app boot, alongside other workspace/setup preparation.
- The install always overwrites the existing target content on each start.
- Any installation failure is logged as a warning and does not stop application startup.

## Architecture

The feature is a boot-time installer, not part of the cron runtime itself. The app startup path already calls `ensureWorkspaceDirectories(config.workspaceDir)` before creating runtime dependencies. That makes `src/runtime/workspace.ts` the correct home for a small installer hook.

The package will include a static asset directory such as `assets/skills/codex-claw-cronjob-creator/SKILL.md`. A small installer function will read that asset from the package location and write it to the target global Codex skills directory, creating the destination directory if necessary. The function will overwrite the target file every time it runs.

## Data Flow

1. `main()` loads config and resolves the bot token.
2. `ensureWorkspaceDirectories(workspaceDir)` prepares runtime directories as it does now.
3. The same setup path installs the packaged cron creator skill into `~/.codex/skills/codex-claw-cronjob-creator/SKILL.md`.
4. If installation fails, the app logs a warning and continues booting.
5. Bot/runtime startup proceeds unchanged.

## Error Handling

- Missing packaged asset: log a warning and continue.
- Failure creating `~/.codex/skills/...`: log a warning and continue.
- Failure writing `SKILL.md`: log a warning and continue.

The installer does not retry and does not introduce new CLI flags in the MVP.

## Testing

- Unit test that workspace setup installs the skill file into the target global Codex skills directory.
- Unit test that an existing target file is overwritten on subsequent runs.
- Unit test that installer failures are swallowed by workspace setup.
- Smoke/package metadata test that packaged files include the new asset path so npm publication does not drop it.

## Out of Scope

- Conditional installs based on hash/version comparison.
- `--force` or explicit skill update commands.
- Remote download or GitHub-based installation.
- Any change to cron runtime behavior or skill auto-creation inside workspace-local `.codex`.
