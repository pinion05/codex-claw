# Telegram Album Coalescing Sketch

## Why This Needs A Redesign

The earlier attachment intake MVP was too narrow for real Telegram behavior.

- Telegram media often arrives as multiple updates that share one `media_group_id`
- Caption may be present on only one update in the group
- A naive `message -> runTurn` mapping causes fan-out, run contention, and context noise
- Writing attachment files directly into the final inbox directory leaves orphan files and stale manifests on partial failure

The next version should treat Telegram attachment intake as a small ingestion system, not as a one-handler shortcut.

## Product Goal

Turn one logical Telegram upload into one logical Codex turn.

Supported logical uploads:

- single `document` message
- single `photo` message
- `photo` album identified by `media_group_id`
- `document` album if Telegram emits it as a grouped upload

Expected user experience:

1. User sends caption plus attachments
2. Bot waits until the logical upload is complete
3. Files are saved locally as one bundle
4. One structured prompt is sent to Codex
5. Follow-up plain text does not automatically re-attach prior files

## High-Level Architecture

The intake path should be split into four layers.

### 1. Update Collector

Responsibility:

- receive Telegram `document` and `photo` updates
- normalize them into a common `AttachmentEvent`
- key grouped uploads by `chatId + media_group_id`
- keep single non-group updates as their own bundle candidate

Input shape:

- `chatId`
- `messageId`
- `mediaGroupId?`
- `caption?`
- `attachment descriptor`
- `download handle`

Output shape:

- `PendingBundle`

### 2. Bundle Finalizer

Responsibility:

- decide when a logical upload is complete
- merge caption and attachment descriptors
- preserve original attachment ordering
- produce one finalized bundle input for storage

Proposed policy:

- non-group update: finalize immediately
- grouped upload: finalize after a quiet period
- recommended quiet period: `800ms`

Additional policy:

- keep the first message id as the bundle id
- store `media_group_id` in metadata when present
- if a later update in the same group carries the only caption, attach it to the same bundle

### 3. Transactional Bundle Writer

Responsibility:

- download files
- save files and metadata in a temporary staging directory
- write `bundle.json`
- atomically publish the finished bundle into the inbox

Required write model:

1. create staging dir under inbox root
2. download and write all successful attachments into staging dir
3. record failed attachments in metadata
4. write `bundle.json` in staging dir
5. rename staging dir to final bundle dir

Benefits:

- no orphan files in final bundle dir
- no final bundle without manifest
- retries can safely replace or reject existing bundle dirs using explicit rules

### 4. Codex Dispatch

Responsibility:

- build the final prompt
- send exactly one `runTurn` per finalized bundle
- keep the attachment prompt separate from later plain text turns

Prompt contract:

- `User caption`
- `Attachments`
- `Failed attachments`

Rules:

- caption is the main request
- if caption is absent, use a short default request
- if all attachments fail but caption exists, still dispatch
- if bundle finalization itself fails before prompt creation, reply with a user-visible failure and do not dispatch

## Inbox Layout

Base path:

```text
~/.codex-claw/workspace/inbox
```

Proposed final bundle layout:

```text
inbox/<chatId>/<bundleMessageId>/
  bundle.json
  1-report.json
  2-photo-abc.jpg
```

Proposed metadata shape:

```json
{
  "chatId": 123,
  "messageId": 456,
  "mediaGroupId": "1234567890",
  "caption": "Inspect these files",
  "attachments": [
    {
      "index": 1,
      "kind": "document",
      "name": "report.json",
      "path": "/home/.../inbox/123/456/1-report.json",
      "mimeType": "application/json",
      "sizeBytes": 128
    }
  ],
  "failedAttachments": [
    {
      "index": 2,
      "name": "broken.png",
      "reason": "download failed"
    }
  ]
}
```

Notable change from the earlier draft:

- add `mediaGroupId`
- add `index` to both success and failure records so original ordering remains explicit

## Collector State Model

Each pending grouped upload should keep:

- `chatId`
- `bundleMessageId`
- `mediaGroupId`
- `caption?`
- `attachments[]`
- `startedAt`
- `updatedAt`
- `finalizeTimer`
- `status`

Statuses:

- `collecting`
- `finalizing`
- `completed`
- `failed`

Important rule:

- do not delete the pending entry before finalization finishes
- move from `collecting` to `finalizing`
- keep a short post-finalize tombstone window if needed to reject late arrivals deterministically

This avoids the earlier bug where a late photo in the same album could create a second bundle.

## Error Model

Errors should be split by stage.

### Collection Errors

- malformed Telegram update
- unsupported attachment shape

Handling:

- reply to user
- do not start bundle dispatch

### Download Errors

- missing `file_path`
- non-200 download
- timeout

Handling:

- keep bundle alive
- record in `failedAttachments`
- continue if at least caption or other attachments remain useful

### Storage Errors

- staging dir create failure
- file write failure
- manifest write failure
- final rename failure

Handling:

- abort bundle publish
- cleanup staging dir best-effort
- do not send Codex turn if no valid published bundle exists

### Dispatch Errors

- `runTurn` failure

Handling:

- keep saved bundle for inspection
- reply with run failure
- do not delete bundle

## Recommended Implementation Order

### Phase 1. Collector Core

- add a dedicated `telegram-bundle-collector` module
- support single update finalization and grouped photo finalization
- replace timer fire-and-forget with tracked async finalization

### Phase 2. Transactional Storage

- replace direct final-dir writes with staging + atomic publish
- include `index` and `mediaGroupId` in metadata

### Phase 3. Bot Wiring

- wire `registerBotHandlers` through collector
- cover document, photo, photo album, document album if supported by Telegram shape

### Phase 4. Prompt + Docs

- align README with actual logical-upload model
- document album behavior clearly

## Minimum Test Matrix

- single document with caption
- single photo with caption
- photo album with caption on first item
- photo album with caption on later item
- document album if Telegram emits it as grouped updates
- late arrival in same `media_group_id`
- partial download failure inside album
- all attachments failed but caption present
- staging write failure leaves no final orphan bundle
- final manifest contains stable `index` ordering
- plain text follow-up does not re-inject bundle context

## Decision Summary

The next design should optimize for correctness over smallness.

- coalesce logical uploads instead of immediate per-update dispatch
- publish bundles transactionally
- preserve ordering in metadata
- treat album finalization as explicit state, not as a loose timer shortcut

This is a larger implementation than the original MVP, but it matches the actual Telegram boundary and removes the class of failures found during review.
