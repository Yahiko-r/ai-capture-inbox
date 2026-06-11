import fs from "node:fs/promises";
import path from "node:path";
import { getDataDir } from "../utils/files.ts";

type JsonData = unknown[] | Record<string, unknown>;

const DEFAULT_DATA: Record<string, JsonData> = Object.freeze({
  "captures.json": [],
  "tasks.json": [],
  "knowledge-cards.json": [],
  "ai-runs.json": [],
  "settings.json": {}
});

export class JsonStore {
  dataDir: string;

  constructor(dataDir = getDataDir()) {
    this.dataDir = dataDir;
  }

  async ensureReady() {
    await fs.mkdir(this.dataDir, { recursive: true });
    for (const [fileName, defaultValue] of Object.entries(DEFAULT_DATA)) {
      const filePath = path.join(this.dataDir, fileName);
      try {
        await fs.access(filePath);
      } catch {
        await this.writeJson(fileName, defaultValue);
      }
    }
  }

  async readJson<T>(fileName: string): Promise<T> {
    await this.ensureReady();
    const filePath = path.join(this.dataDir, fileName);
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  }

  async writeJson(fileName: string, data: JsonData): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    const filePath = path.join(this.dataDir, fileName);
    const tempPath = `${filePath}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, filePath);
  }
}
