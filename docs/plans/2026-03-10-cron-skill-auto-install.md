# Cron Skill Auto-Install Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Install the packaged cronjob creator skill into `~/.codex/skills/codex-claw-cronjob-creator/SKILL.md` on every `codex-claw` startup without blocking the app if installation fails.

**Architecture:** Add a packaged static skill asset, create a small runtime installer that copies it into the global Codex skills directory on boot, and keep failure handling warning-only. Wire the installer into existing workspace setup so the behavior runs before runtime startup without coupling it to cron scheduling code.

**Tech Stack:** TypeScript, Bun tests, Node `fs/promises`, existing runtime workspace setup

---

### Task 1: Add failing tests for boot-time skill installation

**Files:**
- Create: `tests/unit/runtime-workspace.test.ts`
- Modify: `tests/smoke/package-metadata.test.ts`
- Review: `src/runtime/workspace.ts`
- Review: `package.json`

**Step 1: Write the failing tests**

- Add a unit test that calls `ensureWorkspaceDirectories()` with a temp workspace and expects `~/.codex/skills/codex-claw-cronjob-creator/SKILL.md` to be created under a temporary home override.
- Add a unit test that pre-creates the target skill file with old content, re-runs setup, and expects the file to be overwritten.
- Add a unit test that forces the installer read/write path to fail and asserts `ensureWorkspaceDirectories()` still resolves.
- Add a smoke test that asserts `package.json.files` includes the asset directory that will be published.

**Step 2: Run tests to verify they fail**

Run:
```bash
bun test tests/unit/runtime-workspace.test.ts tests/smoke/package-metadata.test.ts
```

Expected:
- New runtime workspace tests fail because no installer exists yet.
- Package metadata test fails because the asset path is not listed in `package.json.files`.

**Step 3: Commit**

```bash
git add tests/unit/runtime-workspace.test.ts tests/smoke/package-metadata.test.ts
git commit -m "test: cover cron skill auto-install"
```

### Task 2: Add the packaged skill asset and installer

**Files:**
- Create: `assets/skills/codex-claw-cronjob-creator/SKILL.md`
- Create: `src/runtime/install-codex-skill.ts`
- Modify: `package.json`
- Test: `tests/unit/runtime-workspace.test.ts`
- Test: `tests/smoke/package-metadata.test.ts`

**Step 1: Write the minimal implementation**

- Add the static skill Markdown asset to `assets/skills/codex-claw-cronjob-creator/SKILL.md`.
- Add a small installer helper in `src/runtime/install-codex-skill.ts` that:
  - resolves the packaged asset path from the current module location,
  - resolves the target directory under `os.homedir()/.codex/skills/codex-claw-cronjob-creator`,
  - creates the target directory recursively,
  - reads the packaged `SKILL.md`,
  - writes the target `SKILL.md`, always overwriting.
- Update `package.json.files` to include `assets`.

**Step 2: Run tests to verify they pass**

Run:
```bash
bun test tests/unit/runtime-workspace.test.ts tests/smoke/package-metadata.test.ts
```

Expected:
- Installer tests pass.
- Metadata test confirms the asset is publishable.

**Step 3: Commit**

```bash
git add assets/skills/codex-claw-cronjob-creator/SKILL.md src/runtime/install-codex-skill.ts package.json tests/unit/runtime-workspace.test.ts tests/smoke/package-metadata.test.ts
git commit -m "feat: package cron creator skill asset"
```

### Task 3: Wire the installer into startup workspace setup with warning-only failure handling

**Files:**
- Modify: `src/runtime/workspace.ts`
- Review: `src/index.ts`
- Test: `tests/unit/runtime-workspace.test.ts`

**Step 1: Write/extend the failing test**

- Add a focused test that makes the installer helper throw and asserts `ensureWorkspaceDirectories()` still resolves while warning once.

**Step 2: Run test to verify it fails**

Run:
```bash
bun test tests/unit/runtime-workspace.test.ts
```

Expected:
- The warning-only behavior test fails until workspace setup catches installer errors.

**Step 3: Write minimal implementation**

- Update `ensureWorkspaceDirectories()` to call the installer after creating runtime directories.
- Catch installer errors, log a warning, and continue without changing existing workspace directory behavior.
- Keep `src/index.ts` unchanged unless import flow requires a narrow wiring tweak.

**Step 4: Run tests to verify they pass**

Run:
```bash
bun test tests/unit/runtime-workspace.test.ts
```

Expected:
- Installer success, overwrite, and warning-only failure tests all pass.

**Step 5: Commit**

```bash
git add src/runtime/workspace.ts tests/unit/runtime-workspace.test.ts
git commit -m "feat: install cron creator skill on startup"
```

### Task 4: Run full verification

**Files:**
- Verify: `src/runtime/install-codex-skill.ts`
- Verify: `src/runtime/workspace.ts`
- Verify: `assets/skills/codex-claw-cronjob-creator/SKILL.md`
- Verify: `tests/unit/runtime-workspace.test.ts`
- Verify: `tests/smoke/package-metadata.test.ts`

**Step 1: Run targeted tests**

Run:
```bash
bun test tests/unit/runtime-workspace.test.ts tests/smoke/package-metadata.test.ts
```

Expected:
- All targeted tests pass.

**Step 2: Run full project verification**

Run:
```bash
bun test
bun run typecheck
```

Expected:
- Full test suite passes.
- `tsc --noEmit` passes.

**Step 3: Commit final verification-only adjustments if needed**

```bash
git add -A
git commit -m "chore: finalize cron skill auto-install"
```
