#!/usr/bin/env node
import { Repositories } from "./storage/repositories.ts";
import { createFileCapture, createTextCapture, createUrlCapture } from "./captures.ts";
import {
  acceptCaptureSuggestions,
  dismissCaptureSuggestions,
  processPendingCaptures
} from "./ai/analyzer.ts";
import { createManualTask, completeTask } from "./tasks.ts";
import { printAiResult, printCapture, printKnowledgeCard, printTask } from "./formatters.ts";

const repositories = new Repositories();

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "capture:text":
      await captureText(args);
      break;
    case "capture:url":
      await captureUrl(args);
      break;
    case "capture:file":
      await captureFile(args);
      break;
    case "captures":
      await listCaptures();
      break;
    case "show":
      await showCapture(args);
      break;
    case "process":
      await processCaptures(args);
      break;
    case "review":
      await review(args);
      break;
    case "task:add":
      await taskAdd(args);
      break;
    case "task:done":
      await taskDone(args);
      break;
    case "tasks":
      await listTasks();
      break;
    case "knowledge":
      await listKnowledge();
      break;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function captureText(args: string[]): Promise<void> {
  const text = args.join(" ");
  const capture = await createTextCapture(repositories, text);
  console.log("Created text capture:");
  printCapture(capture);
}

async function captureUrl(args: string[]): Promise<void> {
  const [url] = args;
  if (!url) throw new Error("Usage: npm run capture:url -- <url>");
  const capture = await createUrlCapture(repositories, url);
  console.log("Created URL capture:");
  printCapture(capture);
}

async function captureFile(args: string[]): Promise<void> {
  const [filePath] = args;
  if (!filePath) throw new Error("Usage: npm run capture:file -- <path>");
  const capture = await createFileCapture(repositories, filePath);
  console.log("Created file capture:");
  printCapture(capture);
}

async function listCaptures(): Promise<void> {
  const captures = await repositories.listCaptures();
  if (captures.length === 0) {
    console.log("No captures yet.");
    return;
  }
  for (const capture of captures) {
    printCapture(capture);
  }
}

async function showCapture(args: string[]): Promise<void> {
  const [id] = args;
  if (!id) throw new Error("Usage: npm start -- show <capture-id>");
  const capture = await repositories.getCapture(id);
  if (!capture) throw new Error(`Capture not found: ${id}`);
  printCapture(capture);
  if (capture.aiResult) {
    printAiResult(capture.aiResult);
  }
}

async function processCaptures(args: string[]): Promise<void> {
  const [id] = args;
  const results = await processPendingCaptures(repositories, id ?? null);
  if (results.length === 0) {
    console.log("No pending captures to process.");
    return;
  }
  for (const { capture, result } of results) {
    console.log(`Processed ${capture.id}:`);
    printAiResult(result);
  }
}

async function review(args: string[]): Promise<void> {
  const [action, id] = args;
  if (!action) {
    await listReviewQueue();
    return;
  }
  if (!id) throw new Error("Usage: npm start -- review <accept|dismiss> <capture-id>");

  if (action === "accept") {
    const { tasks, cards } = await acceptCaptureSuggestions(repositories, id);
    console.log(`Accepted ${id}. Created ${tasks.length} task(s) and ${cards.length} knowledge card(s).`);
    return;
  }
  if (action === "dismiss") {
    await dismissCaptureSuggestions(repositories, id);
    console.log(`Dismissed ${id}.`);
    return;
  }
  throw new Error(`Unknown review action: ${action}`);
}

async function listReviewQueue(): Promise<void> {
  const captures = await repositories.listCaptures();
  const pending = captures.filter((capture) => capture.reviewStatus === "pending");
  if (pending.length === 0) {
    console.log("Review queue is empty.");
    return;
  }
  for (const capture of pending) {
    printCapture(capture);
    if (capture.aiResult) printAiResult(capture.aiResult);
  }
}

async function taskAdd(args: string[]): Promise<void> {
  const { title, dueAt, reminderAt } = parseTaskAddArgs(args);
  const task = await createManualTask(repositories, title, "", dueAt, reminderAt);
  console.log("Created manual task:");
  printTask(task);
}

async function taskDone(args: string[]): Promise<void> {
  const [id] = args;
  if (!id) throw new Error("Usage: npm start -- task:done <task-id>");
  const task = await completeTask(repositories, id);
  console.log("Completed task:");
  printTask(task);
}

async function listTasks(): Promise<void> {
  const tasks = await repositories.listTasks();
  const openTasks = tasks.filter((task) => task.status !== "done");
  if (openTasks.length === 0) {
    console.log("No open tasks.");
    return;
  }
  for (const task of openTasks) {
    printTask(task);
  }
}

async function listKnowledge(): Promise<void> {
  const cards = await repositories.listKnowledgeCards();
  if (cards.length === 0) {
    console.log("No knowledge cards yet.");
    return;
  }
  for (const card of cards) {
    printKnowledgeCard(card);
  }
}

function printHelp(): void {
  console.log(`AI Capture Inbox

Commands:
  capture:text <text>             Save a text capture
  capture:url <url>               Save and extract a URL capture
  capture:file <path>             Save a local file capture
  captures                        List captures
  show <capture-id>               Show capture details
  process [capture-id]            Process pending captures with LLM/mock analyzer
  review                          List pending AI suggestions
  review accept <capture-id>      Accept AI suggestions into tasks/knowledge
  review dismiss <capture-id>     Archive AI suggestions
  task:add [--due YYYY-MM-DD] [--remind YYYY-MM-DDTHH:mm] <title>
                                  Create a manual todo
  task:done <task-id>             Mark a task as done
  tasks                           List open tasks
  knowledge                       List knowledge cards
`);
}

function parseTaskAddArgs(args: string[]): { title: string; dueAt: string | null; reminderAt: string | null } {
  const titleParts: string[] = [];
  let dueAt: string | null = null;
  let reminderAt: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--due") {
      dueAt = dateArgToIso(args[index + 1]);
      index += 1;
      continue;
    }
    if (value === "--remind") {
      reminderAt = dateTimeArgToIso(args[index + 1]);
      index += 1;
      continue;
    }
    titleParts.push(value);
  }

  return {
    title: titleParts.join(" "),
    dueAt,
    reminderAt
  };
}

function dateArgToIso(value: string | undefined): string {
  if (!value) throw new Error("Missing value for --due");
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) throw new Error("Use --due YYYY-MM-DD");
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
}

function dateTimeArgToIso(value: string | undefined): string {
  if (!value) throw new Error("Missing value for --remind");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Use --remind YYYY-MM-DDTHH:mm");
  return date.toISOString();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
