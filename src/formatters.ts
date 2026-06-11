import type { AiResult, Capture, KnowledgeCard, Task } from "./types/models.ts";

export function printCapture(capture: Capture): void {
  console.log(`${capture.id} [${capture.status}] ${capture.title}`);
  console.log(`  source: ${capture.sourceType}`);
  if (capture.sourceUrl) console.log(`  url: ${capture.sourceUrl}`);
  if (capture.filePath) console.log(`  file: ${capture.filePath}`);
  if (capture.reviewStatus) console.log(`  review: ${capture.reviewStatus}`);
  if (capture.extractionError) console.log(`  extraction warning: ${capture.extractionError}`);
  if (capture.processingError) console.log(`  processing error: ${capture.processingError}`);
}

export function printAiResult(result: AiResult): void {
  console.log(`  category: ${result.category}`);
  console.log(`  summary: ${result.summary}`);
  console.log(`  why: ${result.why_saved}`);
  if (result.tags?.length) console.log(`  tags: ${result.tags.join(", ")}`);
  if (result.suggested_tasks?.length) {
    console.log("  suggested tasks:");
    for (const task of result.suggested_tasks) {
      console.log(`    - [${task.priority}] ${task.title}`);
      if (task.reason) console.log(`      ${task.reason}`);
    }
  }
  if (result.knowledge_points?.length) {
    console.log("  knowledge:");
    for (const point of result.knowledge_points) {
      console.log(`    - ${point.title}`);
    }
  }
}

export function printTask(task: Task): void {
  console.log(`${task.id} [${task.status}] [${task.priority}] ${task.title}`);
  if (task.notes) console.log(`  ${task.notes}`);
  if (task.dueAt) console.log(`  due: ${task.dueAt}`);
  if (task.dueSuggestion) console.log(`  suggested due: ${task.dueSuggestion}`);
  if (task.reminderAt) console.log(`  reminder: ${task.reminderAt}`);
  if (task.remindedAt) console.log(`  reminded: ${task.remindedAt}`);
  if (task.source) console.log(`  source: ${task.source}`);
}

export function printKnowledgeCard(card: KnowledgeCard): void {
  console.log(`${card.id} ${card.title}`);
  if (card.tags?.length) console.log(`  tags: ${card.tags.join(", ")}`);
  console.log(`  ${card.content}`);
}
