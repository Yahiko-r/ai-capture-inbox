import { AiCategory } from "../types/schema.ts";
import type { AiCategoryValue } from "../types/schema.ts";
import type { AiResult, KnowledgePoint, Priority, SuggestedTask } from "../types/models.ts";

type RawAiResult = Partial<{
  title: unknown;
  summary: unknown;
  category: unknown;
  why_saved: unknown;
  suggested_tasks: unknown;
  knowledge_points: unknown;
  tags: unknown;
  confidence: unknown;
}>;

export function normalizeAiResult(result: RawAiResult): AiResult {
  const category = isAiCategory(result.category)
    ? result.category
    : AiCategory.ARCHIVE;

  return {
    title: stringOrFallback(result.title, "Untitled"),
    summary: stringOrFallback(result.summary, ""),
    category,
    why_saved: stringOrFallback(result.why_saved, ""),
    suggested_tasks: normalizeTasks(result.suggested_tasks),
    knowledge_points: normalizeKnowledgePoints(result.knowledge_points),
    tags: Array.isArray(result.tags)
      ? result.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 12)
      : [],
    confidence: normalizeConfidence(result.confidence)
  };
}

function normalizeTasks(tasks: unknown): SuggestedTask[] {
  if (!Array.isArray(tasks)) return [];
  return tasks
    .map((task) => {
      const value = isRecord(task) ? task : {};
      return {
        title: stringOrFallback(value.title, "").trim(),
        reason: stringOrFallback(value.reason, "").trim(),
        priority: normalizePriority(value.priority),
        due_suggestion: value.due_suggestion ? String(value.due_suggestion) : null
      };
    })
    .filter((task) => task.title)
    .slice(0, 5);
}

function normalizeKnowledgePoints(points: unknown): KnowledgePoint[] {
  if (!Array.isArray(points)) return [];
  return points
    .map((point) => {
      const value = isRecord(point) ? point : {};
      return {
        title: stringOrFallback(value.title, "").trim(),
        content: stringOrFallback(value.content, "").trim()
      };
    })
    .filter((point) => point.title || point.content)
    .slice(0, 8);
}

function normalizePriority(priority: unknown): Priority {
  return typeof priority === "string" && ["low", "medium", "high"].includes(priority)
    ? priority as Priority
    : "medium";
}

function normalizeConfidence(confidence: unknown): number {
  const value = Number(confidence);
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isAiCategory(value: unknown): value is AiCategoryValue {
  return typeof value === "string" && Object.values(AiCategory).includes(value as AiCategoryValue);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
