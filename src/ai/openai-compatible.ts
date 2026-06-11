import { normalizeAiResult } from "./schema.ts";
import type { AiResult, Capture } from "../types/models.ts";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_MODEL = "deepseek-v4-pro";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
const GEMINI_MODEL = "gemini-3.5-flash";

export function hasLlmConfig(env = process.env): boolean {
  return Boolean(resolveLlmConfig(env).apiKey);
}

export async function analyzeWithOpenAiCompatible(
  capture: Capture,
  env = process.env
): Promise<AiResult> {
  const config = resolveLlmConfig(env);
  if (!config.apiKey) {
    throw new Error("No LLM API key configured.");
  }

  const requestBody: Record<string, unknown> = {
    model: config.model,
    temperature: 0.2,
    response_format: buildResponseFormat(config.provider),
    messages: [
      {
        role: "system",
        content: [
          "You turn messy personal captures into structured tasks and knowledge cards.",
          "Return only valid JSON with this shape:",
          "{",
          "\"title\": string,",
          "\"summary\": string,",
          "\"category\": \"task\" | \"knowledge\" | \"reading\" | \"idea\" | \"decision\" | \"archive\",",
          "\"why_saved\": string,",
          "\"suggested_tasks\": [{\"title\": string, \"reason\": string, \"priority\": \"low\" | \"medium\" | \"high\", \"due_suggestion\": string | null}],",
          "\"knowledge_points\": [{\"title\": string, \"content\": string}],",
          "\"tags\": string[],",
          "\"confidence\": number",
          "}",
          "Do not invent facts. If the capture is too vague, use low confidence and create a review task."
        ].join("\n")
      },
      {
        role: "user",
        content: buildUserContent(capture, config)
      }
    ]
  };

  if (config.provider === "deepseek") {
    const thinking = env.DEEPSEEK_THINKING ?? "disabled";
    requestBody.thinking = { type: thinking };
    if (thinking === "enabled") {
      requestBody.reasoning_effort = env.DEEPSEEK_REASONING_EFFORT ?? "high";
    }
  }

  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LLM request failed: HTTP ${response.status} ${body.slice(0, 500)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("LLM response did not include message content.");
  }
  return normalizeAiResult(JSON.parse(content) as Record<string, unknown>);
}

interface LlmConfig {
  provider: "deepseek" | "gemini" | "openai-compatible";
  apiKey: string | undefined;
  baseUrl: string;
  model: string;
  supportsImageInput: boolean;
}

export function resolveLlmConfig(env = process.env): LlmConfig {
  const provider = env.LLM_PROVIDER?.toLowerCase();

  if (provider === "deepseek" || (!provider && env.DEEPSEEK_API_KEY)) {
    return {
      provider: "deepseek",
      apiKey: env.DEEPSEEK_API_KEY,
      baseUrl: env.DEEPSEEK_BASE_URL ?? DEEPSEEK_BASE_URL,
      model: env.DEEPSEEK_MODEL ?? DEEPSEEK_MODEL,
      supportsImageInput: false
    };
  }

  if (provider === "gemini" || (!provider && env.GEMINI_API_KEY)) {
    return {
      provider: "gemini",
      apiKey: env.GEMINI_API_KEY,
      baseUrl: env.GEMINI_BASE_URL ?? GEMINI_BASE_URL,
      model: env.GEMINI_MODEL ?? GEMINI_MODEL,
      supportsImageInput: true
    };
  }

  return {
    provider: "openai-compatible",
    apiKey: env.OPENAI_API_KEY,
    baseUrl: env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL,
    model: env.OPENAI_MODEL ?? DEFAULT_MODEL,
    supportsImageInput: env.OPENAI_SUPPORTS_IMAGE_INPUT === "true"
  };
}

function buildUserContent(capture: Capture, config: LlmConfig): string | Array<Record<string, unknown>> {
  const text = [
    `Capture id: ${capture.id}`,
    `Source type: ${capture.sourceType}`,
    capture.sourceUrl ? `Source URL: ${capture.sourceUrl}` : null,
    capture.filePath ? `File path: ${capture.filePath}` : null,
    capture.ocrText ? `Local OCR provider: ${capture.ocrProvider ?? "unknown"}` : null,
    capture.ocrText ? `Local OCR text:\n${capture.ocrText}` : null,
    capture.ocrError ? `Local OCR error: ${capture.ocrError}` : null,
    "",
    "Content:",
    capture.normalizedText ?? capture.rawText ?? capture.title ?? ""
  ].filter(Boolean);

  if (capture.imageDataUrl && config.supportsImageInput) {
    return [
      {
        type: "text",
        text: `${text.join("\n")}\n\nAnalyze the attached image directly. Extract visible text, explain why it may have been saved, and decide whether it should become tasks or knowledge. Prefer direct visual evidence over OCR if they conflict.`
      },
      {
        type: "image_url",
        image_url: {
          url: capture.imageDataUrl
        }
      }
    ];
  }

  if (capture.imageDataUrl) {
    text.push("");
    text.push(
      capture.ocrText
        ? "The selected model does not support image input, so use the local OCR text above to infer why this image was saved and whether it should become tasks or knowledge."
        : "The selected model does not support image input and local OCR did not produce text. Be conservative and ask for review instead of inventing image details."
    );
  }

  return text.join("\n");
}

function buildResponseFormat(provider: LlmConfig["provider"]): Record<string, unknown> {
  if (provider === "gemini") {
    return {
      type: "json_schema",
      json_schema: {
        name: "capture_analysis",
        strict: true,
        schema: aiResultJsonSchema()
      }
    };
  }

  return { type: "json_object" };
}

function aiResultJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "title",
      "summary",
      "category",
      "why_saved",
      "suggested_tasks",
      "knowledge_points",
      "tags",
      "confidence"
    ],
    properties: {
      title: { type: "string" },
      summary: { type: "string" },
      category: {
        type: "string",
        enum: ["task", "knowledge", "reading", "idea", "decision", "archive"]
      },
      why_saved: { type: "string" },
      suggested_tasks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "reason", "priority", "due_suggestion"],
          properties: {
            title: { type: "string" },
            reason: { type: "string" },
            priority: { type: "string", enum: ["low", "medium", "high"] },
            due_suggestion: {
              anyOf: [{ type: "string" }, { type: "null" }]
            }
          }
        }
      },
      knowledge_points: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "content"],
          properties: {
            title: { type: "string" },
            content: { type: "string" }
          }
        }
      },
      tags: {
        type: "array",
        items: { type: "string" }
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1
      }
    }
  };
}
