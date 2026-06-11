import { AiCategory } from "../types/schema.ts";
import { normalizeAiResult } from "./schema.ts";
import type { AiResult, Capture } from "../types/models.ts";

const TASK_KEYWORDS = [
  "todo",
  "task",
  "remember to",
  "need to",
  "should",
  "try",
  "buy",
  "follow up",
  "安排",
  "提醒",
  "待办",
  "要做",
  "需要",
  "试试",
  "购买",
  "跟进"
];

const KNOWLEDGE_KEYWORDS = [
  "how to",
  "guide",
  "tutorial",
  "learn",
  "concept",
  "教程",
  "知识",
  "方法",
  "原理",
  "文章",
  "观点"
];

export async function analyzeWithMock(capture: Capture): Promise<AiResult> {
  const text = capture.normalizedText ?? capture.rawText ?? capture.title ?? "";
  const lower = text.toLowerCase();
  const hasTaskIntent = TASK_KEYWORDS.some((keyword) => lower.includes(keyword.toLowerCase()));
  const hasKnowledgeIntent = KNOWLEDGE_KEYWORDS.some((keyword) => lower.includes(keyword.toLowerCase()));
  const firstLine = text.split("\n").find((line) => line.trim())?.trim() ?? capture.title;
  const title = (capture.title || firstLine || "Untitled capture").slice(0, 90);

  const suggestedTasks = hasTaskIntent
    ? [
        {
          title: toTaskTitle(firstLine),
          reason: "The capture contains action-oriented wording.",
          priority: lower.includes("urgent") || lower.includes("重要") ? "high" : "medium",
          due_suggestion: null
        }
      ]
    : [];

  const knowledgePoints = hasKnowledgeIntent || !hasTaskIntent
    ? [
        {
          title,
          content: summarize(text)
        }
      ]
    : [];

  return normalizeAiResult({
    title,
    summary: summarize(text),
    category: hasTaskIntent ? AiCategory.TASK : hasKnowledgeIntent ? AiCategory.KNOWLEDGE : AiCategory.IDEA,
    why_saved: hasTaskIntent
      ? "This looks like something that may need a follow-up action."
      : "This looks like information worth keeping for later review.",
    suggested_tasks: suggestedTasks,
    knowledge_points: knowledgePoints,
    tags: inferTags(text, capture.sourceType),
    confidence: 0.55
  });
}

function toTaskTitle(text: string): string {
  return text
    .replace(/^[-*]\s*/, "")
    .replace(/^(todo|task|remember to|need to|should)\s*:?\s*/i, "")
    .trim()
    .slice(0, 100) || "Review captured item";
}

function summarize(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function inferTags(text: string, sourceType: string): string[] {
  const tags = new Set([sourceType]);
  const pairs = [
    ["ai", /ai|llm|agent|模型|人工智能/i],
    ["product", /product|产品|设计|竞品/i],
    ["reading", /article|blog|阅读|文章/i],
    ["work", /meeting|project|工作|项目/i]
  ];
  for (const [tag, pattern] of pairs) {
    if (pattern.test(text)) tags.add(tag);
  }
  return [...tags];
}
