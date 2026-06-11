import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { processCapture, acceptCaptureSuggestions } from "../src/ai/analyzer.ts";
import { resolveLlmConfig } from "../src/ai/openai-compatible.ts";
import { createTextCapture } from "../src/captures.ts";
import { JsonStore } from "../src/storage/json-store.ts";
import { Repositories } from "../src/storage/repositories.ts";
import { createManualTask, markTaskReminded, updateTaskSchedule } from "../src/tasks.ts";

async function createTestRepositories(): Promise<Repositories> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-capture-inbox-"));
  return new Repositories(new JsonStore(dataDir));
}

test("text capture can be processed and accepted into tasks", async () => {
  const repositories = await createTestRepositories();

  const capture = await createTextCapture(
    repositories,
    "需要试试把截图和网页整理成 todo 的 AI inbox 项目"
  );

  assert.equal(capture.status, "pending");

  const result = await processCapture(repositories, capture);
  assert.equal(result.category, "task");
  assert.equal(result.suggested_tasks.length, 1);

  const updatedCapture = await repositories.getCapture(capture.id);
  assert.equal(updatedCapture.status, "needs_review");
  assert.equal(updatedCapture.reviewStatus, "pending");

  const accepted = await acceptCaptureSuggestions(repositories, capture.id);
  assert.equal(accepted.tasks.length, 1);
  assert.equal(accepted.cards.length, 0);

  const tasks = await repositories.listTasks();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].source, "ai");

  const finalCapture = await repositories.getCapture(capture.id);
  assert.equal(finalCapture.status, "processed");
  assert.equal(finalCapture.reviewStatus, "accepted");
});

test("DeepSeek env config resolves to deepseek-v4-pro by default", () => {
  const config = resolveLlmConfig({
    LLM_PROVIDER: "deepseek",
    DEEPSEEK_API_KEY: "test-key"
  });

  assert.equal(config.provider, "deepseek");
  assert.equal(config.apiKey, "test-key");
  assert.equal(config.baseUrl, "https://api.deepseek.com");
  assert.equal(config.model, "deepseek-v4-pro");
  assert.equal(config.supportsImageInput, false);
});

test("Gemini env config resolves to Gemini OpenAI-compatible endpoint", () => {
  const config = resolveLlmConfig({
    LLM_PROVIDER: "gemini",
    GEMINI_API_KEY: "test-key"
  });

  assert.equal(config.provider, "gemini");
  assert.equal(config.apiKey, "test-key");
  assert.equal(config.baseUrl, "https://generativelanguage.googleapis.com/v1beta/openai/");
  assert.equal(config.model, "gemini-3.5-flash");
  assert.equal(config.supportsImageInput, true);
});

test("manual task stores due date and reminder state", async () => {
  const repositories = await createTestRepositories();
  const dueAt = "2026-06-12T15:59:59.999Z";
  const reminderAt = "2026-06-12T01:30:00.000Z";

  const task = await createManualTask(repositories, "写项目周报", "", dueAt, reminderAt);
  assert.equal(task.dueAt, dueAt);
  assert.equal(task.reminderAt, reminderAt);
  assert.equal(task.remindedAt, null);

  const rescheduled = await updateTaskSchedule(
    repositories,
    task.id,
    "2026-06-13T15:59:59.999Z",
    "2026-06-13T01:30:00.000Z"
  );
  assert.equal(rescheduled.dueAt, "2026-06-13T15:59:59.999Z");
  assert.equal(rescheduled.remindedAt, null);

  const reminded = await markTaskReminded(repositories, task.id);
  assert.equal(typeof reminded.remindedAt, "string");
});
