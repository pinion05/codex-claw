# Cron Telegram Delivery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Send successful cron job results to the persisted Telegram chat while keeping cron execution in fresh Codex threads, preventing duplicate one-shot runs on delivery failure, and fixing cron test isolation.

**Architecture:** Extend cron wiring with narrow injected helpers for target chat resolution, interactive-run gating, Telegram delivery, and cron logging. Add a read-only session lookup for background use, keep Telegram formatting outside cron runtime, and make every cron test use an explicit temporary `codexClawHomeDir`.

**Tech Stack:** TypeScript, Bun tests, grammY Bot API, existing Codex SDK runtime client, JSON file-backed session store

---

### Task 1: Lock down cron test isolation before feature work

**Files:**
- Modify: `tests/integration/cron-runtime.test.ts`
- Modify: `tests/integration/cron-loader.test.ts`
- Modify: `tests/integration/cron-system.test.ts`
- Review: `src/lib/paths.ts`

**Step 1: Write the failing isolation regression**

- Update cron integration tests so every `createCronRuntime(...)` call passes an explicit temporary `codexClawHomeDir`.
- Add one focused assertion in `tests/integration/cron-runtime.test.ts` proving startup does not observe disabled jobs from the real `~/.codex-claw/cronjobs`.

**Step 2: Run test to verify the current baseline fails for the right reason**

Run:
```bash
bun test tests/integration/cron-runtime.test.ts
```

Expected:
- The existing startup test fails because it still reads the real home directory.

**Step 3: Apply the minimal test-only fix**

- Keep production code unchanged.
- Make the tests hermetic by always creating temp home fixtures under `os.tmpdir()` and passing them through `codexClawHomeDir`.

**Step 4: Run the isolated cron integration tests**

Run:
```bash
bun test tests/integration/cron-runtime.test.ts tests/integration/cron-loader.test.ts tests/integration/cron-system.test.ts
```

Expected:
- All three cron integration files pass without reading the real `~/.codex-claw`.

**Step 5: Commit**

```bash
git add tests/integration/cron-runtime.test.ts tests/integration/cron-loader.test.ts tests/integration/cron-system.test.ts
git commit -m "test: isolate cron integration home fixtures"
```

### Task 2: Add read-only session lookup for background cron usage

**Files:**
- Modify: `src/session/session-store.ts`
- Modify: `tests/unit/session-store.test.ts`
- Review: `src/session/session-types.ts`

**Step 1: Write the failing tests**

- Add a unit test that reads an existing persisted session without requiring a `chatId`.
- Add a unit test that returns `null` when no session file exists.
- Add a unit test that preserves current validation for malformed session JSON.

**Step 2: Run tests to verify they fail**

Run:
```bash
bun test tests/unit/session-store.test.ts
```

Expected:
- New read-only lookup tests fail because no such API exists yet.

**Step 3: Write the minimal implementation**

- Add a read-only method such as `readCurrentSession(): Promise<AgentSession | null>` to `FileSessionStore`.
- Reuse existing parsing and validation logic.
- Do not change `getOrCreate(chatId)` semantics.

**Step 4: Run tests to verify they pass**

Run:
```bash
bun test tests/unit/session-store.test.ts
```

Expected:
- Existing interactive session tests still pass.
- New read-only lookup coverage passes.

**Step 5: Commit**

```bash
git add src/session/session-store.ts tests/unit/session-store.test.ts
git commit -m "feat: add read-only session lookup for cron"
```

### Task 3: Thread narrow cron delivery dependencies through runtime wiring

**Files:**
- Modify: `src/index.ts`
- Modify: `src/runtime/create-runtime-deps.ts`
- Modify: `tests/integration/cron-loader.test.ts`
- Review: `src/bot/create-bot.ts`

**Step 1: Write the failing wiring tests**

- Extend cron wiring tests so `createRuntimeDeps()` can inject:
  - target chat resolution,
  - interactive-run check,
  - Telegram delivery callback,
  - cron execution logging callback.
- Add an assertion that runtime wiring can build cron dependencies without forcing `cron runtime` to know about `Bot` directly.

**Step 2: Run tests to verify they fail**

Run:
```bash
bun test tests/integration/cron-loader.test.ts
```

Expected:
- Wiring tests fail because cron runtime only receives Codex today.

**Step 3: Write the minimal implementation**

- Reorder or adjust `src/index.ts` so `Bot` creation happens before runtime dependency composition where needed.
- In `createRuntimeDeps()`, build narrow injected helpers:
  - `resolveCronTargetChatId()` from `FileSessionStore.readCurrentSession()`
  - `isInteractiveRunActive()` from persisted session state
  - `deliverCronResult(chatId, text)` using `bot.api.sendMessage(...)`
  - `logCronExecution(event)` using the chosen logging helper
- Keep `create-bot.ts` interactive reply flow unchanged.

**Step 4: Run tests to verify they pass**

Run:
```bash
bun test tests/integration/cron-loader.test.ts
```

Expected:
- Cron wiring tests pass with the new narrow dependency shape.

**Step 5: Commit**

```bash
git add src/index.ts src/runtime/create-runtime-deps.ts tests/integration/cron-loader.test.ts
git commit -m "refactor: inject narrow cron delivery dependencies"
```

### Task 4: Implement cron execution, skip policies, and separated delivery failure handling

**Files:**
- Modify: `src/cron/runtime.ts`
- Modify: `src/bot/formatters.ts`
- Modify: `tests/integration/cron-runtime.test.ts`
- Modify: `tests/integration/cron-system.test.ts`

**Step 1: Write the failing behavior tests**

- Add a test that cron skips when no target chat is available.
- Add a test that cron skips when an interactive run is active.
- Add a test that one-shot jobs are disabled after Codex success even if Telegram delivery fails.
- Add a test that Codex execution failure still leaves one-shot jobs enabled.
- Add a test that the delivered Telegram message contains the formatted summary text.

**Step 2: Run tests to verify they fail**

Run:
```bash
bun test tests/integration/cron-runtime.test.ts tests/integration/cron-system.test.ts
```

Expected:
- New skip/delivery separation tests fail with the current runtime behavior.

**Step 3: Write the minimal implementation**

- Update `src/cron/runtime.ts` so each due job:
  - resolves target chat,
  - skips when chat is missing,
  - skips when an interactive run is active,
  - executes Codex with `threadId: null`,
  - disables one-shot jobs immediately after Codex success,
  - formats a Telegram message outside cron runtime internals,
  - attempts delivery afterward without coupling one-shot disable to delivery success.
- Add formatter helpers in `src/bot/formatters.ts` or a narrowly scoped formatter helper used by `createRuntimeDeps()`.

**Step 4: Run tests to verify they pass**

Run:
```bash
bun test tests/integration/cron-runtime.test.ts tests/integration/cron-system.test.ts tests/integration/create-bot.test.ts
```

Expected:
- Cron runtime tests pass for success, skip, and delivery-failure cases.
- Interactive bot handler tests remain unchanged and passing.

**Step 5: Commit**

```bash
git add src/cron/runtime.ts src/bot/formatters.ts tests/integration/cron-runtime.test.ts tests/integration/cron-system.test.ts tests/integration/create-bot.test.ts
git commit -m "feat: deliver cron results to telegram"
```

### Task 5: Add cron observability and document the new semantics

**Files:**
- Modify: `src/runtime/logging.ts`
- Modify: `README.md`
- Modify: `tests/integration/run-agent-turn.test.ts`
- Modify: `tests/integration/cron-runtime.test.ts`

**Step 1: Write the failing tests/docs expectations**

- Add assertions that cron execution emits structured metadata distinguishing `phase=execution` and `phase=delivery`.
- Add or extend README smoke coverage if the repository has one, so the new cron notification semantics are enforced.

**Step 2: Run tests to verify they fail**

Run:
```bash
bun test tests/integration/cron-runtime.test.ts tests/smoke/readme.test.ts
```

Expected:
- Cron observability assertions fail because cron success paths are not logged.
- README smoke fails until the new behavior is documented.

**Step 3: Write the minimal implementation**

- Extend logging helpers to support cron execution metadata with `jobId`, `chatId`, and `phase`.
- Document in `README.md` that:
  - cron jobs still execute in fresh Codex threads,
  - successful jobs may notify the persisted Telegram chat,
  - delivery failure does not imply prompt re-execution,
  - no target chat means skip rather than fatal error.

**Step 4: Run targeted verification**

Run:
```bash
bun test tests/integration/cron-runtime.test.ts tests/smoke/readme.test.ts
```

Expected:
- Cron logging expectations pass.
- README smoke reflects the new semantics.

**Step 5: Commit**

```bash
git add src/runtime/logging.ts README.md tests/integration/cron-runtime.test.ts tests/smoke/readme.test.ts
git commit -m "docs: describe cron telegram delivery semantics"
```

### Task 6: Full verification in the worktree

**Files:**
- Verify: `src/session/session-store.ts`
- Verify: `src/runtime/create-runtime-deps.ts`
- Verify: `src/cron/runtime.ts`
- Verify: `src/runtime/logging.ts`
- Verify: `src/bot/formatters.ts`
- Verify: `README.md`
- Verify: `tests/integration/cron-runtime.test.ts`
- Verify: `tests/integration/cron-loader.test.ts`
- Verify: `tests/integration/cron-system.test.ts`
- Verify: `tests/unit/session-store.test.ts`

**Step 1: Run focused regression suites**

Run:
```bash
bun test tests/unit/session-store.test.ts tests/integration/cron-runtime.test.ts tests/integration/cron-loader.test.ts tests/integration/cron-system.test.ts tests/integration/create-bot.test.ts
```

Expected:
- Session lookup, cron runtime, cron wiring, cron system, and bot integration suites all pass.

**Step 2: Run full project verification**

Run:
```bash
bun test
bun run typecheck
```

Expected:
- Full suite passes with no home-directory leakage.
- TypeScript compilation passes.

**Step 3: Commit final verification-only adjustments if needed**

```bash
git add -A
git commit -m "chore: finalize cron telegram delivery"
```
