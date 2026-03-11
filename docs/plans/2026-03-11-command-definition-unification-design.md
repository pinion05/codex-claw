# Command Definition Unification Design

**Date:** 2026-03-11
**Issue:** `#17` command 정의 모듈화 및 Telegram 자동완성 일괄 동기화

## Goal

하나의 command definition 모듈에서 slash command 파싱 허용 목록, 런타임 handler dispatch, help 출력, Telegram command 자동완성 등록을 함께 파생시켜서 명령 체계의 불일치를 제거한다.

## Scope

- 명령 정의를 단일 source of truth로 승격
- 기존 `/start`, `/help`, `/status`, `/reset`, `/abort`를 같은 정의 형식으로 표현
- help 메시지를 정의 기반으로 생성
- Telegram `setMyCommands` 동기화 추가
- command sync 실패는 경고 로그만 남기고 봇 기동은 계속 유지

## Non-Goals

- `/stop` 구현
- model/thinking level 제어
- command permission model 추가
- locale별 Telegram command 분기

## Current State

- [commands.ts](/tmp/codex-claw-review-nnSjwm/src/bot/commands.ts)에는 허용 명령 이름 배열만 있다.
- [create-bot.ts](/tmp/codex-claw-review-nnSjwm/src/bot/create-bot.ts)에는 handler 분기와 help 문자열이 별도로 하드코딩돼 있다.
- [index.ts](/tmp/codex-claw-review-nnSjwm/src/index.ts)에는 Telegram command sync 호출이 없다.

이 구조에서는 새 명령을 추가할 때 파싱, 실제 처리, help, Telegram 자동완성이 쉽게 어긋난다.

## Recommended Approach

### 1. Command definition registry 도입

`src/bot/command-definitions.ts` 같은 모듈을 만들어 각 명령을 메타데이터로 정의한다.

각 항목은 최소한 아래 정보를 가진다.

- `name`
- `telegramDescription`
- `helpDescription`
- `kind`

`kind`는 실제 dispatcher가 어떤 동작을 수행할지 결정하는 얇은 키다. 1차 범위에서는 `help`, `status`, `reset`, `abort` 정도면 충분하다.

### 2. 파싱과 help를 registry 기반으로 전환

[commands.ts](/tmp/codex-claw-review-nnSjwm/src/bot/commands.ts)는 registry에서 허용 명령 이름을 읽어 파싱만 담당한다.  
[create-bot.ts](/tmp/codex-claw-review-nnSjwm/src/bot/create-bot.ts)의 help 출력은 registry를 기반으로 조합한다.

이렇게 하면 명령을 추가하거나 제거할 때 help가 자동으로 따라온다.

### 3. Dispatcher를 registry-aware하게 유지

실제 명령 처리는 여전히 [create-bot.ts](/tmp/codex-claw-review-nnSjwm/src/bot/create-bot.ts)에 두되, 큰 `switch`에 문자열 리터럴을 직접 늘리는 대신 registry의 `kind`를 기준으로 분기한다.

이 단계에서는 과도한 generic dispatcher를 만들지 않는다. `#17`의 핵심은 “한 정의에서 파생”이지, command framework를 크게 재설계하는 것이 아니다.

### 4. Telegram command sync 추가

시작 시점에 registry를 Telegram Bot API 형식으로 변환해 `setMyCommands`를 호출한다. 위치는 [index.ts](/tmp/codex-claw-review-nnSjwm/src/index.ts)에서 bot 생성 직후, handler 등록 전이 가장 단순하다.

실패 시 정책:

- `console.warn` 또는 `console.error`로 경고 로그 남김
- 프로세스는 계속 시작
- 런타임 명령 처리 자체는 영향을 받지 않음

## Data Flow

1. 앱 시작
2. command registry 로드
3. registry 기반 Telegram command sync 시도
4. registry 기반 parse/help/dispatch로 bot 실행

## Error Handling

- Telegram API sync 실패: 경고 로그, 계속 진행
- registry에 잘못된 중복 이름이 생기면 단위 테스트에서 잡도록 설계
- help/parse/Telegram sync 결과가 모두 같은 registry를 읽도록 해서 drift를 구조적으로 줄임

## Testing Strategy

### Unit

- registry에서 Telegram command payload가 올바르게 생성되는지 검증
- `parseCommand()`가 registry 기반 허용 목록만 통과시키는지 검증

### Integration

- help 메시지가 registry 기반으로 생성되는지 검증
- 기존 명령들이 올바른 runtime dependency로 연결되는지 검증
- startup 시 `setMyCommands`가 호출되는지 검증
- `setMyCommands` 실패가 startup 전체를 막지 않는지 검증

### Smoke / Docs

- README의 명령 목록이 여전히 현재 정의와 일치하는지 검증

## Tradeoffs

### 장점

- 명령 추가 시 수정 지점을 줄인다.
- help와 Telegram command 목록 불일치를 크게 줄인다.
- 다음 제어 명령 이슈(`/#stop` 등) 작업이 쉬워진다.

### 비용

- 시작 경로와 테스트 픽스처를 조금 만져야 한다.
- command handling이 약간 더 간접화된다.

## Acceptance Mapping

- command definition single source of truth 도입: registry로 충족
- command 추가 시 handler와 자동완성 동기화: registry + sync helper로 충족
- `/stop` 같은 새 명령이 같은 패턴으로 추가 가능: registry 구조로 충족

