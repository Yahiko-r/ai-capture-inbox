import fs from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { URL } from "node:url";

import {
  acceptCaptureSuggestions,
  dismissCaptureSuggestions,
  processPendingCaptures
} from "./ai/analyzer.ts";
import { createFileCapture, createTextCapture, createUrlCapture } from "./captures.ts";
import { Repositories } from "./storage/repositories.ts";
import { completeTask, createManualTask, markTaskReminded, updateTaskSchedule } from "./tasks.ts";
import { getDataDir } from "./utils/files.ts";

const PORT = Number(process.env.PORT ?? 4317);
const PUBLIC_DIR = path.join(process.cwd(), "public");
const UPLOAD_DIR = path.join(getDataDir(), "uploads");
const repositories = new Repositories();

type ApiHandler = (request: IncomingMessage, response: ServerResponse, url: URL) => Promise<void>;

const server = http.createServer((request, response) => {
  void route(request, response).catch((error: unknown) => {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : String(error)
    });
  });
});

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (url.pathname.startsWith("/api/")) {
    await routeApi(request, response, url);
    return;
  }

  await serveStatic(response, url.pathname);
}

async function routeApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  const method = request.method ?? "GET";
  const routes: Record<string, ApiHandler> = {
    "GET /api/state": getState,
    "POST /api/captures/text": createText,
    "POST /api/captures/url": createUrl,
    "POST /api/captures/file": createFile,
    "POST /api/process": processCaptures,
    "POST /api/review/accept": acceptReview,
    "POST /api/review/dismiss": dismissReview,
    "POST /api/tasks": createTask,
    "POST /api/tasks/schedule": scheduleTask,
    "POST /api/tasks/reminded": markTaskReminderShown,
    "POST /api/tasks/done": markTaskDone
  };

  const handler = routes[`${method} ${url.pathname}`];
  if (!handler) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  await handler(request, response, url);
}

async function getState(_request: IncomingMessage, response: ServerResponse): Promise<void> {
  const [captures, tasks, knowledgeCards, aiRuns] = await Promise.all([
    repositories.listCaptures(),
    repositories.listTasks(),
    repositories.listKnowledgeCards(),
    repositories.listAiRuns()
  ]);

  sendJson(response, 200, {
    captures,
    tasks,
    knowledgeCards,
    aiRuns,
    stats: {
      inbox: captures.filter((capture) => capture.status === "pending" || capture.status === "failed").length,
      review: captures.filter((capture) => capture.reviewStatus === "pending").length,
      tasksOpen: tasks.filter((task) => task.status === "open").length,
      knowledge: knowledgeCards.length
    }
  });
}

async function createText(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJsonBody<{ text?: string }>(request);
  if (!body.text?.trim()) {
    sendJson(response, 400, { error: "Text is required." });
    return;
  }

  const capture = await createTextCapture(repositories, body.text);
  sendJson(response, 201, { capture });
}

async function createUrl(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJsonBody<{ url?: string }>(request);
  if (!body.url?.trim()) {
    sendJson(response, 400, { error: "URL is required." });
    return;
  }

  const capture = await createUrlCapture(repositories, body.url);
  sendJson(response, 201, { capture });
}

async function createFile(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const upload = await readMultipartFile(request);
  if (!upload) {
    sendJson(response, 400, { error: "File is required." });
    return;
  }

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const filePath = path.join(UPLOAD_DIR, `${Date.now()}-${sanitizeFileName(upload.fileName)}`);
  await fs.writeFile(filePath, upload.data);

  const capture = await createFileCapture(repositories, filePath);
  sendJson(response, 201, { capture });
}

async function processCaptures(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJsonBody<{ id?: string }>(request);
  const results = await processPendingCaptures(repositories, body.id ?? null);
  sendJson(response, 200, { results });
}

async function acceptReview(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJsonBody<{ id?: string }>(request);
  if (!body.id) {
    sendJson(response, 400, { error: "Capture id is required." });
    return;
  }

  const result = await acceptCaptureSuggestions(repositories, body.id);
  sendJson(response, 200, result);
}

async function dismissReview(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJsonBody<{ id?: string }>(request);
  if (!body.id) {
    sendJson(response, 400, { error: "Capture id is required." });
    return;
  }

  const capture = await dismissCaptureSuggestions(repositories, body.id);
  sendJson(response, 200, { capture });
}

async function createTask(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJsonBody<{
    title?: string;
    notes?: string;
    dueAt?: string | null;
    reminderAt?: string | null;
  }>(request);
  if (!body.title?.trim()) {
    sendJson(response, 400, { error: "Task title is required." });
    return;
  }

  const task = await createManualTask(
    repositories,
    body.title,
    body.notes ?? "",
    cleanOptional(body.dueAt),
    cleanOptional(body.reminderAt)
  );
  sendJson(response, 201, { task });
}

async function scheduleTask(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJsonBody<{ id?: string; dueAt?: string | null; reminderAt?: string | null }>(request);
  if (!body.id) {
    sendJson(response, 400, { error: "Task id is required." });
    return;
  }

  const task = await updateTaskSchedule(
    repositories,
    body.id,
    cleanOptional(body.dueAt),
    cleanOptional(body.reminderAt)
  );
  sendJson(response, 200, { task });
}

async function markTaskReminderShown(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJsonBody<{ id?: string }>(request);
  if (!body.id) {
    sendJson(response, 400, { error: "Task id is required." });
    return;
  }

  const task = await markTaskReminded(repositories, body.id);
  sendJson(response, 200, { task });
}

async function markTaskDone(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJsonBody<{ id?: string }>(request);
  if (!body.id) {
    sendJson(response, 400, { error: "Task id is required." });
    return;
  }

  const task = await completeTask(repositories, body.id);
  sendJson(response, 200, { task });
}

function cleanOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

async function serveStatic(response: ServerResponse, pathname: string): Promise<void> {
  const resolvedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, resolvedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    response.writeHead(200, { "content-type": getContentType(filePath) });
    response.end(file);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const text = await readRequestText(request);
  return text ? JSON.parse(text) as T : {} as T;
}

async function readRequestText(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readMultipartFile(request: IncomingMessage): Promise<{ fileName: string; data: Buffer } | null> {
  const contentType = request.headers["content-type"] ?? "";
  const boundary = contentType.match(/boundary=(.+)$/)?.[1];
  if (!boundary) return null;

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks);
  const marker = Buffer.from(`--${boundary}`);
  const parts = splitBuffer(body, marker);

  for (const part of parts) {
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd === -1) continue;
    const headers = part.subarray(0, headerEnd).toString("utf8");
    const fileName = headers.match(/filename="([^"]+)"/)?.[1];
    if (!fileName) continue;

    let data = part.subarray(headerEnd + 4);
    if (data.subarray(0, 2).toString() === "\r\n") data = data.subarray(2);
    if (data.subarray(-2).toString() === "\r\n") data = data.subarray(0, -2);
    if (data.subarray(-2).toString() === "--") data = data.subarray(0, -2);
    return { fileName, data };
  }

  return null;
}

function splitBuffer(buffer: Buffer, separator: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  let start = 0;
  let index = buffer.indexOf(separator, start);
  while (index !== -1) {
    if (index > start) parts.push(buffer.subarray(start, index));
    start = index + separator.length;
    index = buffer.indexOf(separator, start);
  }
  if (start < buffer.length) parts.push(buffer.subarray(start));
  return parts;
}

function sendJson(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(data));
}

function sanitizeFileName(fileName: string): string {
  return path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function getContentType(filePath: string): string {
  const ext = path.extname(filePath);
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  };
  return types[ext] ?? "application/octet-stream";
}

server.listen(PORT, () => {
  console.log(`AI Capture Inbox GUI running at http://localhost:${PORT}`);
});
