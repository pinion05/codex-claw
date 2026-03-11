# Codex Native Telegram File-Send Skill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Package and auto-install a self-contained Codex skill that can send one local file to the current active `codex-claw` Telegram chat.

**Architecture:** Add a new packaged skill directory under `assets/skills/`, extend packaged skill installation from a single markdown file to a directory copy, and bundle a small Node/Bun script that reads the current `codex-claw` session and bot token before uploading the file through the Telegram Bot API.

**Tech Stack:** Bun, TypeScript, Node filesystem APIs, Telegram Bot API, existing `codex-claw` packaged skill installer

---

### Task 1: Create failing installer tests for packaged skill directories

**Files:**
- Modify: `tests/unit/runtime-workspace.test.ts`
- Modify: `src/runtime/install-codex-skill.ts`

**Step 1: Write the failing test**

Add a test that installs a packaged skill directory containing `SKILL.md` and `scripts/send-file.js`, then expects both files to exist under `~/.codex/skills/<skill-name>/`.

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/runtime-workspace.test.ts`
Expected: FAIL because the installer currently copies only `SKILL.md`.

**Step 3: Write minimal implementation**

Refactor the packaged skill installer so it can copy a whole skill directory rather than only a single markdown file, while preserving current cronjob creator and agentty behavior.

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/runtime-workspace.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/unit/runtime-workspace.test.ts src/runtime/install-codex-skill.ts
git commit -m "refactor: install packaged skill directories"
```

### Task 2: Add the new packaged Telegram file-send skill asset

**Files:**
- Create: `assets/skills/codex-claw-telegram-file-send/SKILL.md`
- Create: `assets/skills/codex-claw-telegram-file-send/scripts/send-file.js`

**Step 1: Write the failing test**

Add a test that expects the new packaged skill to be installed during workspace setup and checks for both `SKILL.md` and `scripts/send-file.js`.

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/runtime-workspace.test.ts`
Expected: FAIL because the new packaged skill is not registered or packaged yet.

**Step 3: Write minimal implementation**

Add the new skill assets:

- `SKILL.md` describing when to use the skill and how to call the script
- `scripts/send-file.js` accepting one file path argument

The script should:

- resolve `~/.codex-claw/local-config.json`
- resolve `~/.codex-claw/workspace/state/session.json`
- validate token, session, and input file
- send the file as Telegram `document`

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/runtime-workspace.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add assets/skills/codex-claw-telegram-file-send tests/unit/runtime-workspace.test.ts
git commit -m "feat: add packaged Telegram file-send skill"
```

### Task 3: Add failing script validation tests

**Files:**
- Create: `tests/unit/telegram-file-send-skill.test.ts`
- Modify: `assets/skills/codex-claw-telegram-file-send/scripts/send-file.js`

**Step 1: Write the failing test**

Write tests covering:

- missing file path argument
- missing input file
- non-file path
- missing Telegram token
- missing active session

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/telegram-file-send-skill.test.ts`
Expected: FAIL because the script does not yet expose the validation behavior cleanly enough for tests.

**Step 3: Write minimal implementation**

Structure the script so the core logic is testable, for example by exporting internal helpers or separating validation and transport code in the same file.

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/telegram-file-send-skill.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/unit/telegram-file-send-skill.test.ts assets/skills/codex-claw-telegram-file-send/scripts/send-file.js
git commit -m "test: cover Telegram file-send skill validation"
```

### Task 4: Add Telegram upload request test

**Files:**
- Modify: `tests/unit/telegram-file-send-skill.test.ts`
- Modify: `assets/skills/codex-claw-telegram-file-send/scripts/send-file.js`

**Step 1: Write the failing test**

Add a test that stubs `fetch` and expects the script to POST to Telegram `sendDocument` using:

- token from local config
- chat id from current session
- multipart upload containing the requested file

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/telegram-file-send-skill.test.ts`
Expected: FAIL because the request format is not fully implemented yet.

**Step 3: Write minimal implementation**

Implement the upload path using `fetch` and `FormData`, targeting Telegram Bot API `sendDocument`.

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/telegram-file-send-skill.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/unit/telegram-file-send-skill.test.ts assets/skills/codex-claw-telegram-file-send/scripts/send-file.js
git commit -m "feat: send Telegram documents from packaged skill"
```

### Task 5: Wire startup installation for the new skill

**Files:**
- Modify: `src/runtime/install-codex-skill.ts`
- Modify: `src/runtime/workspace.ts`
- Modify: `tests/unit/runtime-workspace.test.ts`

**Step 1: Write the failing test**

Add or extend a startup test so `ensureWorkspaceDirectories()` installs the new packaged skill alongside the existing packaged skills.

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/runtime-workspace.test.ts`
Expected: FAIL because startup wiring does not yet install the new skill.

**Step 3: Write minimal implementation**

Add installer support and startup wiring for `codex-claw-telegram-file-send`.

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/runtime-workspace.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/runtime/install-codex-skill.ts src/runtime/workspace.ts tests/unit/runtime-workspace.test.ts
git commit -m "feat: auto-install Telegram file-send skill"
```

### Task 6: Document the new skill in README

**Files:**
- Modify: `README.md`
- Modify: `tests/smoke/readme.test.ts`

**Step 1: Write the failing test**

Update the README smoke test to expect the new packaged skill and a short description of the file-send workflow.

**Step 2: Run test to verify it fails**

Run: `bun test tests/smoke/readme.test.ts`
Expected: FAIL because README does not mention the new skill yet.

**Step 3: Write minimal implementation**

Document:

- that `codex-claw` installs the packaged Telegram file-send skill
- that Codex can use it to send a local file to the active Telegram chat
- the MVP limitation of single-file `document` sending

**Step 4: Run test to verify it passes**

Run: `bun test tests/smoke/readme.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add README.md tests/smoke/readme.test.ts
git commit -m "docs: describe packaged Telegram file-send skill"
```

### Task 7: Final verification

**Files:**
- Verify only

**Step 1: Run targeted tests**

Run:

```bash
bun test tests/unit/runtime-workspace.test.ts
bun test tests/unit/telegram-file-send-skill.test.ts
bun test tests/smoke/readme.test.ts
```

Expected: all PASS

**Step 2: Run full verification**

Run:

```bash
bun run check
```

Expected: full suite PASS, `tsc --noEmit` PASS

**Step 3: Commit any final cleanup**

If any verification-driven cleanup was needed:

```bash
git add <files>
git commit -m "chore: finalize Telegram file-send skill"
```

