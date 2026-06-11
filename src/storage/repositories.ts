import { JsonStore } from "./json-store.ts";
import { nowIso } from "../utils/time.ts";
import type {
  AiRun,
  Capture,
  CapturePatch,
  KnowledgeCard,
  Settings,
  SettingsPatch,
  Task,
  TaskPatch
} from "../types/models.ts";

const FILES = Object.freeze({
  captures: "captures.json",
  tasks: "tasks.json",
  knowledgeCards: "knowledge-cards.json",
  aiRuns: "ai-runs.json",
  settings: "settings.json"
});

export class Repositories {
  store: JsonStore;

  constructor(store = new JsonStore()) {
    this.store = store;
  }

  async listCaptures(): Promise<Capture[]> {
    return this.store.readJson<Capture[]>(FILES.captures);
  }

  async getCapture(id: string): Promise<Capture | null> {
    const captures = await this.listCaptures();
    return captures.find((capture) => capture.id === id) ?? null;
  }

  async createCapture(capture: Capture): Promise<Capture> {
    const captures = await this.listCaptures();
    captures.unshift(capture);
    await this.store.writeJson(FILES.captures, captures);
    return capture;
  }

  async updateCapture(id: string, patch: CapturePatch): Promise<Capture> {
    const captures = await this.listCaptures();
    const index = captures.findIndex((capture) => capture.id === id);
    if (index === -1) {
      throw new Error(`Capture not found: ${id}`);
    }
    captures[index] = {
      ...captures[index],
      ...patch,
      updatedAt: nowIso()
    };
    await this.store.writeJson(FILES.captures, captures);
    return captures[index];
  }

  async listTasks(): Promise<Task[]> {
    return this.store.readJson<Task[]>(FILES.tasks);
  }

  async createTasks(tasks: Task[]): Promise<Task[]> {
    if (tasks.length === 0) return [];
    const current = await this.listTasks();
    await this.store.writeJson(FILES.tasks, [...tasks, ...current]);
    return tasks;
  }

  async createTask(task: Task): Promise<Task> {
    const [created] = await this.createTasks([task]);
    return created;
  }

  async updateTask(id: string, patch: TaskPatch): Promise<Task> {
    const tasks = await this.listTasks();
    const index = tasks.findIndex((task) => task.id === id);
    if (index === -1) {
      throw new Error(`Task not found: ${id}`);
    }
    tasks[index] = {
      ...tasks[index],
      ...patch,
      updatedAt: nowIso()
    };
    await this.store.writeJson(FILES.tasks, tasks);
    return tasks[index];
  }

  async listKnowledgeCards(): Promise<KnowledgeCard[]> {
    return this.store.readJson<KnowledgeCard[]>(FILES.knowledgeCards);
  }

  async createKnowledgeCards(cards: KnowledgeCard[]): Promise<KnowledgeCard[]> {
    if (cards.length === 0) return [];
    const current = await this.listKnowledgeCards();
    await this.store.writeJson(FILES.knowledgeCards, [...cards, ...current]);
    return cards;
  }

  async listAiRuns(): Promise<AiRun[]> {
    return this.store.readJson<AiRun[]>(FILES.aiRuns);
  }

  async createAiRun(aiRun: AiRun): Promise<AiRun> {
    const current = await this.listAiRuns();
    await this.store.writeJson(FILES.aiRuns, [aiRun, ...current]);
    return aiRun;
  }

  async getSettings(): Promise<Settings> {
    return this.store.readJson<Settings>(FILES.settings);
  }

  async updateSettings(patch: SettingsPatch): Promise<Settings> {
    const settings = await this.getSettings();
    const next = { ...settings, ...patch, updatedAt: nowIso() };
    await this.store.writeJson(FILES.settings, next);
    return next;
  }
}
