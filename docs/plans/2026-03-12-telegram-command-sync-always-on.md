# Telegram Command Sync Always-On Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the optional startup gate so `codex-claw` always attempts Telegram slash-command sync on startup.

**Architecture:** Delete the config flag, unconditionalize the existing startup sync call, and keep the existing warning-only, non-blocking sync helper behavior. Update focused tests and README to match the new contract without broad startup refactors.

**Tech Stack:** Bun, TypeScript, grammY, Bun test

---

### Task 1: Lock the new startup contract with tests

**Files:**
- Modify: `tests/unit/config.test.ts`
- Modify: `tests/unit/index-telegram-command-sync.test.ts`

**Step 1: Write the failing test**

Change the config tests to stop expecting `syncTelegramCommandsOnStartup`, and change the startup tests to expect Telegram command sync to be called by default.

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/config.test.ts tests/unit/index-telegram-command-sync.test.ts`
Expected: FAIL because the production code still exposes the flag and still skips sync by default.

**Step 3: Write minimal implementation**

Update `src/config.ts` to remove the flag from `AppConfig` and `loadConfig()`, then update `src/index.ts` to always call `syncTelegramCommands(bot)`.

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/config.test.ts tests/unit/index-telegram-command-sync.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config.ts src/index.ts tests/unit/config.test.ts tests/unit/index-telegram-command-sync.test.ts
git commit -m "feat: always sync telegram commands on startup"
```

### Task 2: Update user-facing docs and README assertions

**Files:**
- Modify: `README.md`
- Modify: `tests/smoke/readme.test.ts`

**Step 1: Write the failing test**

Update the README smoke test so it expects always-on startup sync wording and no longer expects `TELEGRAM_SYNC_COMMANDS=1`.

**Step 2: Run test to verify it fails**

Run: `bun test tests/smoke/readme.test.ts`
Expected: FAIL because the README still describes the old opt-in flow.

**Step 3: Write minimal implementation**

Edit `README.md` to describe Telegram slash-command sync as a default startup behavior.

**Step 4: Run test to verify it passes**

Run: `bun test tests/smoke/readme.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add README.md tests/smoke/readme.test.ts
git commit -m "docs: make telegram command sync always-on"
```

### Task 3: Run focused verification for the changed surface

**Files:**
- Verify only

**Step 1: Run the focused verification suite**

Run: `bun test tests/unit/config.test.ts tests/unit/index-telegram-command-sync.test.ts tests/smoke/readme.test.ts`
Expected: PASS

**Step 2: Review diff for unintended scope**

Run: `git status --short && git diff -- src/config.ts src/index.ts README.md tests/unit/config.test.ts tests/unit/index-telegram-command-sync.test.ts tests/smoke/readme.test.ts`
Expected: Only the planned always-on sync changes are present.
