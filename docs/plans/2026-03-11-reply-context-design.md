# Reply Context Design

**Date:** 2026-03-11
**Issue:** `#6` `reply 한 메시지도 프롬프트에 포함되어 전달되도록`

## Goal

When a Telegram message replies to an earlier message, include a structured `Reply context` block in the prompt sent to Codex so the model can directly reference the replied-to content.

This applies to:

- text replies
- captioned media replies
- document/image replies where local attachment paths are already known

## Scope

This design covers only the current Telegram update plus locally available attachment information.

It does **not** introduce a long-lived message registry. A separate follow-up issue exists for that richer capability:

- `#30` `Telegram reply message registry로 과거 문맥/첨부 재구성 지원`

## Chosen Approach

Build reply context at the bot input layer.

When handling `message:text`, if the current Telegram message includes a `reply_to_message`, construct a structured prefix block and prepend it to the current user message before calling the runtime.

The prompt shape should be stable and machine-friendly rather than natural-language prose.

## Prompt Shape

Example:

```text
Reply context
- messageId: 123
- author: Alice
- text: Please summarize this
- attachment:
  - kind: document
  - name: report.pdf
  - path: /home/.../workspace/inbox/123/456/1-report.pdf

Current user message
Can you compare it with yesterday's file?
```

## Data Included

### Always include when available

- reply target message id
- reply target author display value
- reply target text
- reply target caption

### Attachment metadata

If the reply target is a document or image message, include:

- attachment kind
- attachment name or fallback name
- MIME type when available

### Local path

Only include attachment `path` when the path is already known locally.

This means:

- no forced re-download
- no new storage pass just for reply context
- no failure of the current message solely because the reply target file path is unavailable

If the local path is unknown, keep the metadata and omit the path.

## Fallback Behavior

Reply context must be best-effort.

- If `reply_to_message` is absent, keep the existing prompt flow unchanged.
- If some reply metadata is missing, include only the fields that exist.
- If attachment path resolution fails, omit the path and continue.
- The current user message must still be processed even when reply context is partial.

## Implementation Shape

Primary changes should stay in the bot layer.

- detect reply metadata from the incoming Telegram update
- build a prompt prefix helper
- prepend the structured block before dispatching to `runTurn`

Likely touch points:

- `src/bot/create-bot.ts`
- optional new reply-context helper under `src/bot/`
- `tests/integration/create-bot.test.ts`

## Attachment Path Strategy

For the MVP, attachment path support is opportunistic.

Use existing locally known information only. This keeps the feature small and avoids creating a hidden dependency on a future message registry or a re-download mechanism.

The richer version that can reconstruct reply attachments from older messages should live in the separate registry issue.

## Testing Strategy

### Integration Tests

- plain text reply adds replied text metadata to prompt
- document/image reply adds attachment metadata
- local attachment path is included only when known
- missing reply fields do not break current message processing
- non-reply messages still produce the same prompt as before

### Regression Guard

Ensure existing command handling and attachment processing flows still work unchanged for non-reply messages.

## Risks

### Incomplete Telegram metadata

Different Telegram message types expose different fields. The helper must tolerate sparse reply data without overfitting to one shape.

### Path availability

Attachment path support is intentionally partial in MVP. This is acceptable as long as the prompt clearly includes metadata and omits path cleanly when unavailable.

## Summary

The MVP for `#6` should prepend a structured reply context block built from the current Telegram update and any already-known local attachment information. This gives Codex direct access to reply context without introducing a full message registry or changing non-reply behavior.
