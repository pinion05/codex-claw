# Telegram Line Break Preservation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve multiline Codex replies when sending them to Telegram instead of flattening them into a single line.

**Architecture:** Replace the whitespace-collapsing formatter helper with a newline-preserving normalizer. Keep the change scoped to outgoing run completion and failure messages so the existing command/status formatting stays simple.

**Tech Stack:** Bun, TypeScript, grammY

---

### Task 1: Preserve multiline run output in Telegram

**Files:**
- Modify: `src/bot/formatters.ts`

**Step 1: Replace the collapsing helper**

Swap the current helper that turns all whitespace into single spaces with a helper that only normalizes line endings and trims outer whitespace.

**Step 2: Keep multiline summaries and errors readable**

Use the new helper in completion and failure formatters so Telegram receives the original line structure.

**Step 3: Manually confirm in Telegram**

Send a multiline prompt through the bot and confirm that the reply keeps paragraph and line breaks.
