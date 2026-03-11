# Command Definition Unification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `#17` 이슈를 위해 command 정의를 단일 source of truth로 통합하고, Telegram command sync까지 같은 정의에서 파생되게 만든다.

**Architecture:** 얇은 command registry를 추가하고, parse/help/dispatch/Telegram sync가 모두 그 registry를 읽게 만든다. 런타임 dispatcher는 과도하게 일반화하지 않고 현재 control command 흐름을 유지하며, startup에서 Telegram command sync를 비차단 경고 방식으로 연결한다.

**Tech Stack:** Bun, TypeScript, grammY, Bun test

---

### Task 1: Command Registry 추가

**Files:**
- Create: `src/bot/command-definitions.ts`
- Modify: `src/bot/commands.ts`
- Test: `tests/unit/commands.test.ts`

**Step 1: Write the failing test**

추가할 테스트:

```ts
import {
  getSupportedCommandNames,
  toTelegramCommandPayload,
} from "../../src/bot/command-definitions";

test("exports supported command names from the registry", () => {
  expect(getSupportedCommandNames()).toEqual(["start", "help", "status", "reset", "abort"]);
});

test("builds Telegram command payloads from the registry", () => {
  expect(toTelegramCommandPayload()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ command: "status", description: expect.any(String) }),
    ]),
  );
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/commands.test.ts`
Expected: FAIL because `src/bot/command-definitions.ts` and exported helpers do not exist yet.

**Step 3: Write minimal implementation**

`src/bot/command-definitions.ts`에 아래 형태의 최소 구현을 추가:

```ts
export const commandDefinitions = [
  {
    name: "start",
    kind: "help",
    helpDescription: "show the quick help message",
    telegramDescription: "Show help",
  },
  {
    name: "help",
    kind: "help",
    helpDescription: "show the quick help message",
    telegramDescription: "Show help",
  },
  {
    name: "status",
    kind: "status",
    helpDescription: "show the current session status",
    telegramDescription: "Show current status",
  },
  {
    name: "reset",
    kind: "reset",
    helpDescription: "reset the current session",
    telegramDescription: "Reset the session",
  },
  {
    name: "abort",
    kind: "abort",
    helpDescription: "request cancellation for the active run",
    telegramDescription: "Abort the active run",
  },
] as const;

export function getSupportedCommandNames() {
  return commandDefinitions.map((definition) => definition.name);
}

export function toTelegramCommandPayload() {
  return commandDefinitions.map((definition) => ({
    command: definition.name,
    description: definition.telegramDescription,
  }));
}
```

`src/bot/commands.ts`는 hardcoded 배열 대신 `getSupportedCommandNames()`를 읽게 변경.

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/commands.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bot/command-definitions.ts src/bot/commands.ts tests/unit/commands.test.ts
git commit -m "refactor: add command registry for bot commands"
```

### Task 2: Help 출력을 Registry 기반으로 전환

**Files:**
- Modify: `src/bot/create-bot.ts`
- Modify: `tests/integration/create-bot.test.ts`

**Step 1: Write the failing test**

기존 help 테스트를 강화:

```ts
test("help advertises commands from the registry", async () => {
  // /help 호출 후
  expect(replies[0]).toContain("/status");
  expect(replies[0]).toContain("/reset");
  expect(replies[0]).toContain("/abort");
});
```

그리고 help 메시지 본문이 registry에서 파생된다는 assertion을 추가.

**Step 2: Run test to verify it fails**

Run: `bun test tests/integration/create-bot.test.ts -t "help advertises"`
Expected: FAIL after removing hardcoded help construction.

**Step 3: Write minimal implementation**

[create-bot.ts](/tmp/codex-claw-review-nnSjwm/src/bot/create-bot.ts)의 `buildHelpMessage()`를 registry 기반으로 교체:

```ts
import { commandDefinitions } from "./command-definitions";

function buildHelpMessage() {
  const commandList = commandDefinitions.map((definition) => `/${definition.name}`);
  return [
    "Send a prompt to run Codex.",
    `Available commands: ${commandList.join(" ")}`,
  ].join("\n");
}
```

1차 구현에서는 help 설명문을 길게 늘리지 말고 현재 README/테스트와 맞는 최소 문구만 유지.

**Step 4: Run test to verify it passes**

Run: `bun test tests/integration/create-bot.test.ts -t "help advertises"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bot/create-bot.ts tests/integration/create-bot.test.ts
git commit -m "refactor: derive help output from command registry"
```

### Task 3: Handler Dispatch를 Registry 메타데이터와 맞추기

**Files:**
- Modify: `src/bot/create-bot.ts`
- Test: `tests/integration/create-bot.test.ts`

**Step 1: Write the failing test**

기존 `/status`, `/reset`, `/abort` 통합 테스트를 유지한 채, registry `kind`를 통해 같은 동작이 계속 연결되는지 검증하는 assertion을 추가.

```ts
test("routes registry-backed commands to the expected runtime methods", async () => {
  // /status -> getStatusMessage
  // /reset -> resetSession
  // /abort -> abortRun
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/integration/create-bot.test.ts -t "routes registry-backed commands"`
Expected: FAIL before dispatcher refactor.

**Step 3: Write minimal implementation**

`parseCommand()` 결과 문자열을 직접 `switch`하지 말고, registry에서 definition을 찾아 `kind`로 분기:

```ts
const definition = getCommandDefinition(command.name);

switch (definition.kind) {
  case "help":
    await replyAfterStoppingTyping(buildHelpMessage());
    return;
  case "status":
    await replyAfterStoppingTyping(await deps.getStatusMessage(chatId));
    return;
  case "reset":
    await replyAfterStoppingTyping(formatResetMessage(await deps.resetSession(chatId)));
    return;
  case "abort":
    await replyAfterStoppingTyping(formatAbortMessage(await deps.abortRun(chatId)));
    return;
}
```

핵심은 문자열 리터럴 분기를 registry 정의와 연결하는 것이다. generic plugin system까지 만들지 않는다.

**Step 4: Run test to verify it passes**

Run: `bun test tests/integration/create-bot.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bot/create-bot.ts tests/integration/create-bot.test.ts
git commit -m "refactor: route control commands from command registry"
```

### Task 4: Telegram Command Sync Helper 추가

**Files:**
- Create: `src/bot/telegram-command-sync.ts`
- Modify: `src/index.ts`
- Test: `tests/integration/create-bot.test.ts`

**Step 1: Write the failing test**

추가할 테스트:

```ts
test("syncs Telegram commands from the registry during startup", async () => {
  const setMyCommands = mock(async () => true);
  await syncTelegramCommands({ setMyCommands });
  expect(setMyCommands).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({ command: "status" }),
    ]),
  );
});

test("does not throw when Telegram command sync fails", async () => {
  const setMyCommands = mock(async () => {
    throw new Error("telegram failed");
  });

  await expect(syncTelegramCommands({ setMyCommands, logWarning })).resolves.toBeUndefined();
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/integration/create-bot.test.ts -t "syncs Telegram commands"`
Expected: FAIL because sync helper does not exist.

**Step 3: Write minimal implementation**

`src/bot/telegram-command-sync.ts`에 최소 helper 추가:

```ts
import { toTelegramCommandPayload } from "./command-definitions";

export async function syncTelegramCommands({
  setMyCommands,
  logWarning = console.warn,
}: {
  setMyCommands: (commands: Array<{ command: string; description: string }>) => Promise<unknown>;
  logWarning?: (message: string, error: unknown) => void;
}) {
  try {
    await setMyCommands(toTelegramCommandPayload());
  } catch (error) {
    logWarning("[codex-claw] failed to sync Telegram commands", error);
  }
}
```

그리고 [index.ts](/tmp/codex-claw-review-nnSjwm/src/index.ts)에 연결:

```ts
await syncTelegramCommands({
  setMyCommands: async (commands) => {
    await bot.api.setMyCommands(commands);
  },
});
```

`registerBotHandlers()` 전에 두는 것을 기본안으로 유지.

**Step 4: Run test to verify it passes**

Run: `bun test tests/integration/create-bot.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bot/telegram-command-sync.ts src/index.ts tests/integration/create-bot.test.ts
git commit -m "feat: sync Telegram commands from command registry"
```

### Task 5: README와 Smoke Coverage 정리

**Files:**
- Modify: `README.md`
- Modify: `tests/smoke/readme.test.ts`

**Step 1: Write the failing test**

README smoke test에 Telegram command sync 관련 문구를 추가:

```ts
expect(readme).toContain("Telegram command");
expect(readme).toContain("setMyCommands");
```

문구는 실제 README 표현에 맞춰 조정.

**Step 2: Run test to verify it fails**

Run: `bun test tests/smoke/readme.test.ts`
Expected: FAIL because README does not mention command sync yet.

**Step 3: Write minimal implementation**

README의 `Commands` 또는 startup 설명 부분에 다음 취지 문구를 추가:

```md
Telegram slash commands are synchronized from the shared command definition on startup.
If command sync fails, the bot logs a warning and continues running.
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/smoke/readme.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add README.md tests/smoke/readme.test.ts
git commit -m "docs: describe command registry Telegram sync"
```

### Task 6: Final Verification

**Files:**
- Test: `tests/unit/commands.test.ts`
- Test: `tests/integration/create-bot.test.ts`
- Test: `tests/smoke/readme.test.ts`

**Step 1: Run focused checks**

Run:

```bash
bun test tests/unit/commands.test.ts
bun test tests/integration/create-bot.test.ts
bun test tests/smoke/readme.test.ts
```

Expected: PASS

**Step 2: Run broader regression check**

Run:

```bash
bun test tests/integration/control-commands.test.ts
```

Expected: PASS

**Step 3: Review acceptance mapping**

수동 확인:

- 새 command를 registry 한 곳에 추가하면 parse/help/Telegram sync가 모두 따라오는지 확인
- 기존 `/start`, `/help`, `/status`, `/reset`, `/abort` 동작 회귀가 없는지 확인

**Step 4: Commit**

```bash
git add src/bot/command-definitions.ts src/bot/commands.ts src/bot/create-bot.ts src/bot/telegram-command-sync.ts src/index.ts README.md tests/unit/commands.test.ts tests/integration/create-bot.test.ts tests/integration/control-commands.test.ts tests/smoke/readme.test.ts
git commit -m "feat: unify command definitions and Telegram sync"
```
