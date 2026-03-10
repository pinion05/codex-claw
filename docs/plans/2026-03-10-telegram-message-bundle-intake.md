# Telegram Message Bundle Intake Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement Telegram attachment intake so a single Telegram message containing caption plus `document`/`photo` attachments is saved as one local bundle and sent to Codex as one turn.

**Architecture:** Add a dedicated message-bundle module that normalizes Telegram `document` and `photo` inputs into one bundle, stores all successful attachments under `~/.codex-claw/workspace/inbox/<chatId>/<messageId>/`, writes a `bundle.json` metadata file, and composes a structured prompt where the caption is the main request and attachments are supplemental context. Wire this through the existing bot/runtime path without automatic attachment reinjection on later messages.

**Tech Stack:** Bun, TypeScript, grammY, native `fetch`, local filesystem, existing Codex runtime path

---

### Task 1: Define Bundle Types And Prompt Shape

**Files:**
- Create: `src/files/telegram-message-bundle.ts`
- Create: `tests/unit/telegram-message-bundle.test.ts`

**Step 1: Write the failing tests**

Add unit tests that define the desired prompt/bundle shape:
- caption becomes the main user request
- attachments are listed in a structured text block
- failed attachments are listed separately with `name + reason`
- caption-less messages produce a short default request

**Step 2: Run test to verify it fails**

Run:

```bash
bun test tests/unit/telegram-message-bundle.test.ts
```

Expected: fail because the new module does not exist yet.

**Step 3: Write minimal implementation**

Implement in `src/files/telegram-message-bundle.ts`:
- bundle metadata types
- attachment metadata types
- failed attachment types
- prompt composer for:
  - caption present
  - caption absent
  - mixed success/failure attachments

The prompt must have these sections in plain structured text:
- `User caption`
- `Attachments`
- `Failed attachments`

**Step 4: Run test to verify it passes**

Run:

```bash
bun test tests/unit/telegram-message-bundle.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/files/telegram-message-bundle.ts tests/unit/telegram-message-bundle.test.ts
git commit -m "feat: add Telegram message bundle prompt builder"
```

### Task 2: Build Inbox Storage For Bundle Directories

**Files:**
- Modify: `src/files/telegram-message-bundle.ts`
- Modify: `src/runtime/workspace.ts`
- Modify: `tests/unit/telegram-message-bundle.test.ts`
- Modify: `tests/unit/runtime-workspace.test.ts`

**Step 1: Write the failing tests**

Add tests for storage behavior:
- bundle path is `workspace/inbox/<chatId>/<messageId>/`
- `document` attachments save with stable sanitized names
- `photo` saves only the largest resolution entry
- successful attachments are written to disk
- `bundle.json` is written with caption, message id, attachments, failed attachments
- partial failures still write successful files plus failure metadata
- workspace bootstrap creates `inbox/`

**Step 2: Run test to verify it fails**

Run:

```bash
bun test tests/unit/telegram-message-bundle.test.ts tests/unit/runtime-workspace.test.ts
```

Expected: FAIL on missing storage behavior.

**Step 3: Write minimal implementation**

Extend `src/files/telegram-message-bundle.ts` to:
- resolve bundle directory from `workspaceDir`, `chatId`, `messageId`
- save `document` and `photo` attachments into the bundle directory
- persist `bundle.json`
- preserve successful attachments even when some downloads fail
- keep failed attachments as `name + reason`

Update `src/runtime/workspace.ts` so `workspace/inbox` exists at startup.

**Step 4: Run test to verify it passes**

Run:

```bash
bun test tests/unit/telegram-message-bundle.test.ts tests/unit/runtime-workspace.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/files/telegram-message-bundle.ts src/runtime/workspace.ts tests/unit/telegram-message-bundle.test.ts tests/unit/runtime-workspace.test.ts
git commit -m "feat: add Telegram bundle inbox storage"
```

### Task 3: Wire Telegram Message Bundle Intake Into Bot Flow

**Files:**
- Modify: `src/bot/create-bot.ts`
- Modify: `src/index.ts`
- Modify: `tests/integration/create-bot.test.ts`

**Step 1: Write the failing tests**

Add integration tests that define the bot behavior:
- a `document` message with caption becomes one Codex turn
- a `photo` message with caption becomes one Codex turn
- multiple attachments from one message become one synthesized prompt
- partial failures still call `runTurn` with successful attachments and failed attachment metadata
- all attachments failed but caption exists still calls `runTurn`
- if attachment extraction throws before bundle creation, user gets an explicit failure reply and `runTurn` is not called
- no automatic attachment reinjection on later plain-text follow-ups

**Step 2: Run test to verify it fails**

Run:

```bash
bun test tests/integration/create-bot.test.ts
```

Expected: FAIL because document/photo bundle wiring does not exist.

**Step 3: Write minimal implementation**

Update `src/bot/create-bot.ts` and `src/index.ts` to:
- detect `message:document`
- detect `message:photo`
- normalize both into one bundle input
- store the bundle locally
- compose one Codex prompt from caption + structured attachment context
- call the existing `runTurn` path exactly once per Telegram message
- send explicit user-facing failure replies only when the bundle cannot be prepared at all

**Step 4: Run test to verify it passes**

Run:

```bash
bun test tests/integration/create-bot.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/bot/create-bot.ts src/index.ts tests/integration/create-bot.test.ts
git commit -m "feat: wire Telegram message bundles into Codex turns"
```

### Task 4: Final Docs, Regression Coverage, And Full Verification

**Files:**
- Modify: `README.md`
- Modify: `tests/smoke/readme.test.ts`
- Modify: `tests/unit/telegram-message-bundle.test.ts`
- Modify: `tests/integration/create-bot.test.ts`

**Step 1: Add final regression coverage**

Add the remaining tests for:
- bundle directory naming by `messageId`
- no auto reinjection on later turns
- `photo` largest-size selection
- bundle metadata file shape

**Step 2: Update docs**

Document in `README.md`:
- supported attachment types: `document`, `photo`
- bundle directory layout under `workspace/inbox`
- `message 1 = Codex turn 1`
- caption as primary request
- retention policy: keep bundles until later cleanup work

**Step 3: Run full verification**

Run:

```bash
bun test
bun run typecheck
```

Expected: all tests pass, typecheck exits 0.

**Step 4: Commit**

```bash
git add README.md tests/smoke/readme.test.ts tests/unit/telegram-message-bundle.test.ts tests/integration/create-bot.test.ts
git commit -m "docs: finalize Telegram message bundle intake"
```

### Task 5: Review And Prepare Merge

**Files:**
- Verify only: `git diff --stat`
- Verify only: PR summary

**Step 1: Request code review**

Use review pass focused on:
- Telegram boundary correctness
- partial failure behavior
- no unintended state carry-over

**Step 2: Re-run fresh verification**

Run:

```bash
bun test
bun run typecheck
```

Expected: PASS

**Step 3: Create PR**

Suggested PR title:

```text
feat: add Telegram message bundle intake for Codex
```

Suggested PR body should mention:
- `document + photo`
- `messageId` bundle directories
- caption as primary prompt
- `failed_attachments` handling

**Step 4: Stop**

Do not merge without explicit user approval.
