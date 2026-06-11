import { createId } from "./utils/id.ts";
import { nowIso } from "./utils/time.ts";
import { TaskStatus } from "./types/schema.ts";
import type { Repositories } from "./storage/repositories.ts";
import type { Task } from "./types/models.ts";

export async function createManualTask(
  repositories: Repositories,
  title: string,
  notes = "",
  dueAt: string | null = null,
  reminderAt: string | null = null
): Promise<Task> {
  const cleanTitle = title.trim();
  if (!cleanTitle) {
    throw new Error("Task title cannot be empty.");
  }
  const timestamp = nowIso();
  return repositories.createTask({
    id: createId("task"),
    captureId: null,
    title: cleanTitle,
    notes: notes.trim(),
    status: TaskStatus.OPEN,
    priority: "medium",
    dueAt,
    dueSuggestion: null,
    reminderAt,
    remindedAt: null,
    source: "manual",
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export async function completeTask(repositories: Repositories, taskId: string): Promise<Task> {
  return repositories.updateTask(taskId, {
    status: TaskStatus.DONE,
    completedAt: nowIso()
  });
}

export async function updateTaskSchedule(
  repositories: Repositories,
  taskId: string,
  dueAt: string | null,
  reminderAt: string | null
): Promise<Task> {
  return repositories.updateTask(taskId, {
    dueAt,
    reminderAt,
    remindedAt: null
  });
}

export async function markTaskReminded(repositories: Repositories, taskId: string): Promise<Task> {
  return repositories.updateTask(taskId, {
    remindedAt: nowIso()
  });
}
