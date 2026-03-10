# Cron Concurrent Execution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make cron jobs execute and deliver immediately at their scheduled time even when an interactive Codex reply is still running.

**Architecture:** Remove the interactive-run skip gate from cron dispatch while keeping cron execution on fresh Codex threads. Update runtime wiring, tests, and docs so the supported behavior is explicit and regression-covered.

**Tech Stack:** Bun, TypeScript, Grammy, OpenAI Codex SDK, Bun test

---

### Task 1: Replace the old skip expectation with a failing concurrent-execution test

**Files:**
- Modify: `tests/integration/cron-runtime.test.ts`

**Step 1: Write the failing test**

- Replace the current `interactive-run-active` skip test with a test that:
- creates a due cron job,
- injects `isInteractiveRunActive: async () => true`,
- expects `codex.runTurn()` to still be called,
- expects immediate delivery to still happen,
- expects no `skip/interactive-run-active` log entry.

**Step 2: Run test to verify it fails**

Run: `bun test tests/integration/cron-runtime.test.ts`

Expected: FAIL because cron runtime still skips the job when `isInteractiveRunActive()` is true.

**Step 3: Commit**

```bash
git add tests/integration/cron-runtime.test.ts
git commit -m "test: cover cron execution during active interactive run"
```

### Task 2: Remove the interactive-run execution gate from cron runtime

**Files:**
- Modify: `src/cron/runtime.ts`

**Step 1: Write minimal implementation**

- Delete the `isInteractiveRunActive()` early-return skip branch.
- Keep the `no-target-chat` skip behavior unchanged.
- Keep existing execution and delivery logging unchanged.

**Step 2: Run targeted tests**

Run: `bun test tests/integration/cron-runtime.test.ts`

Expected: PASS for the new concurrent-execution test and existing cron runtime coverage.

**Step 3: Commit**

```bash
git add src/cron/runtime.ts tests/integration/cron-runtime.test.ts
git commit -m "feat: allow cron execution during active interactive runs"
```

### Task 3: Simplify runtime wiring around cron interactive state

**Files:**
- Modify: `src/runtime/create-runtime-deps.ts`
- Modify: `tests/integration/cron-loader.test.ts`

**Step 1: Write the failing integration expectation**

- Update runtime-deps integration coverage so it no longer treats interactive state as a cron execution gate.
- Remove assertions that specifically validate the old skip-oriented wiring if they are no longer meaningful.

**Step 2: Run test to verify it fails**

Run: `bun test tests/integration/cron-loader.test.ts`

Expected: FAIL until runtime wiring matches the new behavior.

**Step 3: Write minimal implementation**

- Stop depending on `isInteractiveRunActive()` for cron execution decisions.
- Either remove the dependency from cron wiring or leave it optional and unused, whichever keeps the API smaller and the tests clearer.

**Step 4: Run test to verify it passes**

Run: `bun test tests/integration/cron-loader.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/runtime/create-runtime-deps.ts tests/integration/cron-loader.test.ts
git commit -m "refactor: remove cron interactive-run gating"
```

### Task 4: Update documentation to match concurrent cron behavior

**Files:**
- Modify: `README.md`
- Modify: `tests/smoke/readme.test.ts`

**Step 1: Write the failing smoke expectation**

- Replace the README smoke assertion that says active interactive runs cause cron skips.

**Step 2: Run test to verify it fails**

Run: `bun test tests/smoke/readme.test.ts`

Expected: FAIL because the README still documents the old skip behavior.

**Step 3: Write minimal implementation**

- Update README cron notes to say:
- cron jobs still run in fresh threads,
- cron completion messages may arrive while a live run is still responding,
- active interactive runs no longer block scheduled execution.

**Step 4: Run test to verify it passes**

Run: `bun test tests/smoke/readme.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add README.md tests/smoke/readme.test.ts
git commit -m "docs: update cron behavior for concurrent execution"
```

### Task 5: Run focused verification before calling the work complete

**Files:**
- Verify only

**Step 1: Run focused test suite**

Run: `bun test tests/integration/cron-runtime.test.ts tests/integration/cron-loader.test.ts tests/smoke/readme.test.ts`

Expected: PASS.

**Step 2: Sanity-check for stale references**

Run: `rg -n "interactive-run-active|skip that scheduled minute" src tests README.md docs/plans`

Expected: only intentional historical references remain, with product docs updated.

**Step 3: Commit**

```bash
git add README.md src/cron/runtime.ts src/runtime/create-runtime-deps.ts tests/integration/cron-runtime.test.ts tests/integration/cron-loader.test.ts tests/smoke/readme.test.ts
git commit -m "feat: run cron jobs during active interactive sessions"
```
