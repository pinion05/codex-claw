# Reply Context Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Include structured reply context in prompts sent to Codex, including attachment metadata and locally known attachment paths when available.

**Architecture:** Detect `reply_to_message` at the Telegram bot layer, convert it into a stable `Reply context` prefix block, and prepend that block to the current user message before calling `runTurn`. Keep the feature best-effort and avoid any new message registry.

**Tech Stack:** Bun, TypeScript, grammY Telegram updates, existing bot integration tests

---

### Task 1: Add failing integration coverage for text replies

**Files:**
- Modify: `tests/integration/create-bot.test.ts`
- Modify: `src/bot/create-bot.ts`

**Step 1: Write the failing test**

Add a `message:text` integration test where the current message replies to a prior text message and expects the prompt sent to `runTurn` to include:

- `Reply context`
- replied message id
- replied text
- `Current user message`

**Step 2: Run test to verify it fails**

Run: `bun test tests/integration/create-bot.test.ts`
Expected: FAIL because reply context is not currently included.

**Step 3: Write minimal implementation**

Add reply detection and prompt prefix building for text replies only.

**Step 4: Run test to verify it passes**

Run: `bun test tests/integration/create-bot.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/integration/create-bot.test.ts src/bot/create-bot.ts
git commit -m "feat: include replied text context in prompts"
```

### Task 2: Extract a dedicated reply context helper

**Files:**
- Create: `src/bot/reply-context.ts`
- Modify: `src/bot/create-bot.ts`
- Modify: `tests/integration/create-bot.test.ts`

**Step 1: Write the failing test**

Add a focused test that requires stable formatting for the structured `Reply context` block.

**Step 2: Run test to verify it fails**

Run: `bun test tests/integration/create-bot.test.ts`
Expected: FAIL because formatting is still inline or incomplete.

**Step 3: Write minimal implementation**

Move reply prompt construction into a helper that accepts the replied Telegram message shape and returns either:

- a formatted prefix string
- or `null` when no useful reply context exists

**Step 4: Run test to verify it passes**

Run: `bun test tests/integration/create-bot.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bot/reply-context.ts src/bot/create-bot.ts tests/integration/create-bot.test.ts
git commit -m "refactor: extract reply context prompt builder"
```

### Task 3: Add failing coverage for attachment replies

**Files:**
- Modify: `tests/integration/create-bot.test.ts`
- Modify: `src/bot/reply-context.ts`

**Step 1: Write the failing test**

Add a reply test where the replied message is a document or photo message and expect attachment metadata in the prompt:

- kind
- file name or fallback name
- caption when present

**Step 2: Run test to verify it fails**

Run: `bun test tests/integration/create-bot.test.ts`
Expected: FAIL because attachment reply metadata is not yet included.

**Step 3: Write minimal implementation**

Extend the reply context helper to format document/photo reply metadata without requiring local file paths.

**Step 4: Run test to verify it passes**

Run: `bun test tests/integration/create-bot.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bot/reply-context.ts tests/integration/create-bot.test.ts
git commit -m "feat: include reply attachment metadata in prompts"
```

### Task 4: Add locally known attachment path support

**Files:**
- Modify: `src/bot/reply-context.ts`
- Modify: `tests/integration/create-bot.test.ts`

**Step 1: Write the failing test**

Add a test where the replied attachment already has a locally known path available to the helper and expect the path to appear in `Reply context`.

**Step 2: Run test to verify it fails**

Run: `bun test tests/integration/create-bot.test.ts`
Expected: FAIL because local path support is not yet wired.

**Step 3: Write minimal implementation**

Extend the helper input so it can accept locally known attachment path information and include `path` only when present.

**Step 4: Run test to verify it passes**

Run: `bun test tests/integration/create-bot.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bot/reply-context.ts tests/integration/create-bot.test.ts
git commit -m "feat: add local reply attachment paths to prompt context"
```

### Task 5: Add fallback tests for partial reply data

**Files:**
- Modify: `tests/integration/create-bot.test.ts`
- Modify: `src/bot/reply-context.ts`

**Step 1: Write the failing test**

Add a test where some reply fields are missing and assert:

- the current message still reaches `runTurn`
- the prompt includes only available reply fields
- no error is sent back to Telegram

**Step 2: Run test to verify it fails**

Run: `bun test tests/integration/create-bot.test.ts`
Expected: FAIL because sparse reply handling is incomplete.

**Step 3: Write minimal implementation**

Make the helper tolerant of partial Telegram reply shapes.

**Step 4: Run test to verify it passes**

Run: `bun test tests/integration/create-bot.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bot/reply-context.ts tests/integration/create-bot.test.ts
git commit -m "test: harden sparse reply context handling"
```

### Task 6: Run focused and full verification

**Files:**
- Verify only

**Step 1: Run focused bot tests**

Run:

```bash
bun test tests/integration/create-bot.test.ts
```

Expected: PASS

**Step 2: Run full repository verification**

Run:

```bash
bun run check
```

Expected: all tests PASS and `tsc --noEmit` PASS

**Step 3: Commit any verification cleanup**

If needed:

```bash
git add <files>
git commit -m "chore: finalize reply context support"
```

