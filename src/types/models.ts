import type {
  AiCategoryValue,
  CaptureStatusValue,
  ReviewStatusValue,
  SourceTypeValue,
  TaskStatusValue
} from "./schema.ts";

export type Priority = "low" | "medium" | "high";
export type TaskSource = "manual" | "ai";
export type AiRunStatus = "success" | "failed";

export interface SuggestedTask {
  title: string;
  reason: string;
  priority: Priority;
  due_suggestion: string | null;
}

export interface KnowledgePoint {
  title: string;
  content: string;
}

export interface AiResult {
  title: string;
  summary: string;
  category: AiCategoryValue;
  why_saved: string;
  suggested_tasks: SuggestedTask[];
  knowledge_points: KnowledgePoint[];
  tags: string[];
  confidence: number;
}

export interface Capture {
  id: string;
  sourceType: SourceTypeValue;
  status: CaptureStatusValue;
  reviewStatus: ReviewStatusValue | null;
  aiResult: AiResult | null;
  title: string;
  rawText?: string;
  normalizedText?: string;
  sourceUrl?: string;
  site?: string;
  filePath?: string;
  mimeType?: string;
  imageDataUrl?: string | null;
  ocrText?: string;
  ocrProvider?: "macos-vision";
  ocrError?: string;
  extractionError?: string;
  processingError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  captureId: string | null;
  title: string;
  notes: string;
  status: TaskStatusValue;
  priority: Priority;
  dueAt: string | null;
  dueSuggestion: string | null;
  reminderAt: string | null;
  remindedAt: string | null;
  source: TaskSource;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeCard {
  id: string;
  captureId: string;
  title: string;
  content: string;
  tags: string[];
  source: "ai";
  createdAt: string;
  updatedAt: string;
}

export interface AiRun {
  id: string;
  captureId: string;
  provider: "deepseek" | "gemini" | "openai-compatible" | "local-mock";
  model: string | null;
  inputSnapshot: {
    title: string;
    sourceType: SourceTypeValue;
    normalizedText?: string;
  };
  outputJson: AiResult | null;
  status: AiRunStatus;
  error?: string;
  startedAt: string;
  createdAt: string;
}

export interface Settings {
  updatedAt?: string;
}

export type NewCaptureFields = Omit<
  Capture,
  "id" | "status" | "reviewStatus" | "aiResult" | "createdAt" | "updatedAt"
>;

export type CapturePatch = Partial<Omit<Capture, "id" | "createdAt">>;
export type TaskPatch = Partial<Omit<Task, "id" | "createdAt">>;
export type SettingsPatch = Partial<Settings>;
