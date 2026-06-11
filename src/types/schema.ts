export const CaptureStatus = {
  PENDING: "pending",
  PROCESSED: "processed",
  NEEDS_REVIEW: "needs_review",
  ARCHIVED: "archived",
  FAILED: "failed"
} as const;

export const SourceType = {
  TEXT: "text",
  URL: "url",
  FILE: "file"
} as const;

export const TaskStatus = {
  OPEN: "open",
  DONE: "done",
  DISMISSED: "dismissed"
} as const;

export const ReviewStatus = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  DISMISSED: "dismissed"
} as const;

export const AiCategory = {
  TASK: "task",
  KNOWLEDGE: "knowledge",
  READING: "reading",
  IDEA: "idea",
  DECISION: "decision",
  ARCHIVE: "archive"
} as const;

export type CaptureStatusValue = (typeof CaptureStatus)[keyof typeof CaptureStatus];
export type SourceTypeValue = (typeof SourceType)[keyof typeof SourceType];
export type TaskStatusValue = (typeof TaskStatus)[keyof typeof TaskStatus];
export type ReviewStatusValue = (typeof ReviewStatus)[keyof typeof ReviewStatus];
export type AiCategoryValue = (typeof AiCategory)[keyof typeof AiCategory];
