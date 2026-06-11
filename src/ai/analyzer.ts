import { createId } from "../utils/id.ts";
import { nowIso } from "../utils/time.ts";
import { CaptureStatus, ReviewStatus, TaskStatus } from "../types/schema.ts";
import { hasLlmConfig, analyzeWithOpenAiCompatible, resolveLlmConfig } from "./openai-compatible.ts";
import { analyzeWithMock } from "./mock-analyzer.ts";
import type { Repositories } from "../storage/repositories.ts";
import type { AiResult, Capture, KnowledgeCard, Task } from "../types/models.ts";

export interface ProcessedCapture {
  capture: Capture;
  result: AiResult;
}

export interface AcceptedSuggestions {
  tasks: Task[];
  cards: KnowledgeCard[];
}

export async function processCapture(repositories: Repositories, capture: Capture): Promise<AiResult> {
  const startedAt = nowIso();
  const llmConfig = hasLlmConfig() ? resolveLlmConfig() : null;
  const provider = llmConfig?.provider ?? "local-mock";
  const model = llmConfig?.model ?? null;

  try {
    const result = provider !== "local-mock"
      ? await analyzeWithOpenAiCompatible(capture)
      : await analyzeWithMock(capture);

    await repositories.createAiRun({
      id: createId("airun"),
      captureId: capture.id,
      provider,
      model,
      inputSnapshot: {
        title: capture.title,
        sourceType: capture.sourceType,
        normalizedText: capture.normalizedText
      },
      outputJson: result,
      status: "success",
      startedAt,
      createdAt: nowIso()
    });

    await repositories.updateCapture(capture.id, {
      status: CaptureStatus.NEEDS_REVIEW,
      reviewStatus: ReviewStatus.PENDING,
      aiResult: result,
      processingError: undefined
    });

    return result;
  } catch (error) {
    const message = getErrorMessage(error);
    await repositories.createAiRun({
      id: createId("airun"),
      captureId: capture.id,
      provider,
      model,
      inputSnapshot: {
        title: capture.title,
        sourceType: capture.sourceType,
        normalizedText: capture.normalizedText
      },
      outputJson: null,
      status: "failed",
      error: message,
      startedAt,
      createdAt: nowIso()
    });

    await repositories.updateCapture(capture.id, {
      status: CaptureStatus.FAILED,
      processingError: message
    });
    throw error;
  }
}

export async function processPendingCaptures(
  repositories: Repositories,
  captureId: string | null = null
): Promise<ProcessedCapture[]> {
  const captures = await repositories.listCaptures();
  const targets = captureId
    ? captures.filter((capture) => capture.id === captureId)
    : captures.filter((capture) => capture.status === CaptureStatus.PENDING || capture.status === CaptureStatus.FAILED);

  const results: ProcessedCapture[] = [];
  for (const capture of targets) {
    results.push({
      capture,
      result: await processCapture(repositories, capture)
    });
  }
  return results;
}

export async function acceptCaptureSuggestions(
  repositories: Repositories,
  captureId: string
): Promise<AcceptedSuggestions> {
  const capture = await repositories.getCapture(captureId);
  if (!capture) {
    throw new Error(`Capture not found: ${captureId}`);
  }
  if (!capture.aiResult) {
    throw new Error(`Capture has no AI result: ${captureId}`);
  }

  const timestamp = nowIso();
  const tasks = capture.aiResult.suggested_tasks.map((task) => ({
    id: createId("task"),
    captureId: capture.id,
    title: task.title,
    notes: task.reason,
    status: TaskStatus.OPEN,
    priority: task.priority,
    dueAt: null,
    dueSuggestion: task.due_suggestion,
    reminderAt: null,
    remindedAt: null,
    source: "ai",
    createdAt: timestamp,
    updatedAt: timestamp
  }));

  const cards = capture.aiResult.knowledge_points.map((point) => ({
    id: createId("kc"),
    captureId: capture.id,
    title: point.title || capture.aiResult.title,
    content: point.content,
    tags: capture.aiResult.tags,
    source: "ai",
    createdAt: timestamp,
    updatedAt: timestamp
  }));

  await repositories.createTasks(tasks);
  await repositories.createKnowledgeCards(cards);
  await repositories.updateCapture(capture.id, {
    status: CaptureStatus.PROCESSED,
    reviewStatus: ReviewStatus.ACCEPTED
  });

  return { tasks, cards };
}

export async function dismissCaptureSuggestions(
  repositories: Repositories,
  captureId: string
): Promise<Capture> {
  const capture = await repositories.getCapture(captureId);
  if (!capture) {
    throw new Error(`Capture not found: ${captureId}`);
  }
  return repositories.updateCapture(captureId, {
    status: CaptureStatus.ARCHIVED,
    reviewStatus: ReviewStatus.DISMISSED
  });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
