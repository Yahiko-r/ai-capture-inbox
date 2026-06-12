use crate::models::{
    AiResult, Capture, KnowledgePoint, LlmConfig, LlmRequestResult, SuggestedTask,
};
use crate::storage::project_root;
use reqwest::{Client, Proxy};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;

const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_MODEL: &str = "gpt-4o-mini";
const DEEPSEEK_BASE_URL: &str = "https://api.deepseek.com";
const DEEPSEEK_MODEL: &str = "deepseek-v4-pro";
const GEMINI_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta/openai/";
const GEMINI_MODEL: &str = "gemini-3.5-flash";

pub fn has_llm_config() -> bool {
    resolve_llm_config().api_key.is_some()
}

pub fn resolve_llm_config() -> LlmConfig {
    let env = merged_env();
    let provider = env.get("LLM_PROVIDER").map(|value| value.to_lowercase());

    if provider.as_deref() == Some("deepseek")
        || (provider.is_none() && env.get("DEEPSEEK_API_KEY").is_some())
    {
        return LlmConfig {
            provider: "deepseek".to_string(),
            api_key: env.get("DEEPSEEK_API_KEY").cloned(),
            base_url: env
                .get("DEEPSEEK_BASE_URL")
                .cloned()
                .unwrap_or_else(|| DEEPSEEK_BASE_URL.to_string()),
            model: env
                .get("DEEPSEEK_MODEL")
                .cloned()
                .unwrap_or_else(|| DEEPSEEK_MODEL.to_string()),
            supports_image_input: false,
        };
    }

    if provider.as_deref() == Some("gemini")
        || (provider.is_none() && env.get("GEMINI_API_KEY").is_some())
    {
        return LlmConfig {
            provider: "gemini".to_string(),
            api_key: env.get("GEMINI_API_KEY").cloned(),
            base_url: env
                .get("GEMINI_BASE_URL")
                .cloned()
                .unwrap_or_else(|| GEMINI_BASE_URL.to_string()),
            model: env
                .get("GEMINI_MODEL")
                .cloned()
                .unwrap_or_else(|| GEMINI_MODEL.to_string()),
            supports_image_input: true,
        };
    }

    LlmConfig {
        provider: "openai-compatible".to_string(),
        api_key: env.get("OPENAI_API_KEY").cloned(),
        base_url: env
            .get("OPENAI_BASE_URL")
            .cloned()
            .unwrap_or_else(|| DEFAULT_BASE_URL.to_string()),
        model: env
            .get("OPENAI_MODEL")
            .cloned()
            .unwrap_or_else(|| DEFAULT_MODEL.to_string()),
        supports_image_input: env
            .get("OPENAI_SUPPORTS_IMAGE_INPUT")
            .map(|value| value == "true")
            .unwrap_or(false),
    }
}

pub async fn analyze_capture(capture: &Capture) -> Result<LlmRequestResult, String> {
    let config = resolve_llm_config();
    let api_key = config
        .api_key
        .clone()
        .ok_or_else(|| "No LLM API key configured.".to_string())?;

    let mut body = json!({
        "model": config.model,
        "temperature": 0.2,
        "response_format": build_response_format(&config),
        "messages": [
            {
                "role": "system",
                "content": system_prompt()
            },
            {
                "role": "user",
                "content": build_user_content(capture, &config)
            }
        ]
    });

    if config.provider == "deepseek" {
        let env = merged_env();
        let thinking = env
            .get("DEEPSEEK_THINKING")
            .cloned()
            .unwrap_or_else(|| "disabled".to_string());
        body["thinking"] = json!({ "type": thinking });
        if body["thinking"]["type"] == "enabled" {
            body["reasoning_effort"] = json!(env
                .get("DEEPSEEK_REASONING_EFFORT")
                .cloned()
                .unwrap_or_else(|| "high".to_string()));
        }
    }

    let endpoint = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));
    let client = http_client()?;
    let response = client
        .post(endpoint)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    let status = response.status();
    let text = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "LLM request failed: HTTP {status} {}",
            truncate(&text, 500)
        ));
    }

    let value: Value = serde_json::from_str(&text).map_err(|error| error.to_string())?;
    let content = value["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| "LLM response did not include message content.".to_string())?;
    let cleaned = strip_json_fence(content);
    let raw: Value = serde_json::from_str(&cleaned).map_err(|error| error.to_string())?;
    let result = normalize_ai_result(&raw);

    Ok(LlmRequestResult {
        result,
        provider: config.provider,
        model: config.model,
    })
}

fn merged_env() -> HashMap<String, String> {
    let mut env: HashMap<String, String> = HashMap::new();
    if let Some(root) = project_root() {
        let path = root.join(".env");
        if let Ok(content) = fs::read_to_string(path) {
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') {
                    continue;
                }
                if let Some((key, value)) = trimmed.split_once('=') {
                    env.insert(
                        key.trim().to_string(),
                        value.trim().trim_matches('"').to_string(),
                    );
                }
            }
        }
    }

    for (key, value) in std::env::vars() {
        env.insert(key, value);
    }

    env
}

fn http_client() -> Result<Client, String> {
    let env = merged_env();
    let mut builder = Client::builder();
    if let Some(proxy_url) = proxy_url(&env) {
        builder = builder.proxy(Proxy::all(proxy_url).map_err(|error| error.to_string())?);
    }
    builder.build().map_err(|error| error.to_string())
}

fn proxy_url(env: &HashMap<String, String>) -> Option<String> {
    [
        "HTTPS_PROXY",
        "https_proxy",
        "ALL_PROXY",
        "all_proxy",
        "HTTP_PROXY",
        "http_proxy",
    ]
    .iter()
    .find_map(|key| {
        env.get(*key)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

fn system_prompt() -> String {
    [
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
        "Do not invent facts. If the capture is too vague, use low confidence and create a review task.",
    ]
    .join("\n")
}

fn build_user_content(capture: &Capture, config: &LlmConfig) -> Value {
    let text = [
        format!("Capture id: {}", capture.id),
        format!("Source type: {}", capture.source_type),
        capture
            .source_url
            .as_ref()
            .map(|value| format!("Source URL: {value}"))
            .unwrap_or_default(),
        capture
            .file_path
            .as_ref()
            .map(|value| format!("File path: {value}"))
            .unwrap_or_default(),
        capture
            .ocr_provider
            .as_ref()
            .map(|value| format!("Local OCR provider: {value}"))
            .unwrap_or_default(),
        capture
            .ocr_text
            .as_ref()
            .map(|value| format!("Local OCR text:\n{value}"))
            .unwrap_or_default(),
        capture
            .ocr_error
            .as_ref()
            .map(|value| format!("Local OCR error: {value}"))
            .unwrap_or_default(),
        "Content:".to_string(),
        capture
            .normalized_text
            .clone()
            .or_else(|| capture.raw_text.clone())
            .unwrap_or_else(|| capture.title.clone()),
    ]
    .into_iter()
    .filter(|value| !value.is_empty())
    .collect::<Vec<_>>()
    .join("\n");

    if let Some(image_data_url) = &capture.image_data_url {
        if config.supports_image_input {
            return json!([
                {
                    "type": "text",
                    "text": format!("{text}\n\nAnalyze the attached image directly. Extract visible text, explain why it may have been saved, and decide whether it should become tasks or knowledge. Prefer direct visual evidence over OCR if they conflict.")
                },
                {
                    "type": "image_url",
                    "image_url": { "url": image_data_url }
                }
            ]);
        }

        let fallback = if capture.ocr_text.is_some() {
            "The selected model does not support image input, so use the local OCR text above to infer why this image was saved and whether it should become tasks or knowledge."
        } else {
            "The selected model does not support image input and local OCR did not produce text. Be conservative and ask for review instead of inventing image details."
        };
        return json!(format!("{text}\n\n{fallback}"));
    }

    json!(text)
}

fn build_response_format(config: &LlmConfig) -> Value {
    if config.provider == "gemini" {
        return json!({
            "type": "json_schema",
            "json_schema": {
                "name": "capture_analysis",
                "strict": true,
                "schema": ai_result_json_schema()
            }
        });
    }

    json!({ "type": "json_object" })
}

fn ai_result_json_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["title", "summary", "category", "why_saved", "suggested_tasks", "knowledge_points", "tags", "confidence"],
        "properties": {
            "title": { "type": "string" },
            "summary": { "type": "string" },
            "category": { "type": "string", "enum": ["task", "knowledge", "reading", "idea", "decision", "archive"] },
            "why_saved": { "type": "string" },
            "suggested_tasks": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["title", "reason", "priority", "due_suggestion"],
                    "properties": {
                        "title": { "type": "string" },
                        "reason": { "type": "string" },
                        "priority": { "type": "string", "enum": ["low", "medium", "high"] },
                        "due_suggestion": { "anyOf": [{ "type": "string" }, { "type": "null" }] }
                    }
                }
            },
            "knowledge_points": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["title", "content"],
                    "properties": {
                        "title": { "type": "string" },
                        "content": { "type": "string" }
                    }
                }
            },
            "tags": { "type": "array", "items": { "type": "string" } },
            "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
        }
    })
}

pub fn normalize_ai_result(value: &Value) -> AiResult {
    AiResult {
        title: string_or(value.get("title"), "Untitled"),
        summary: string_or(value.get("summary"), ""),
        category: category_or(value.get("category")),
        why_saved: string_or(value.get("why_saved"), ""),
        suggested_tasks: normalize_tasks(value.get("suggested_tasks")),
        knowledge_points: normalize_points(value.get("knowledge_points")),
        tags: normalize_tags(value.get("tags")),
        confidence: value
            .get("confidence")
            .and_then(|value| value.as_f64())
            .unwrap_or(0.5)
            .clamp(0.0, 1.0),
    }
}

fn normalize_tasks(value: Option<&Value>) -> Vec<SuggestedTask> {
    value
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let title = string_or(item.get("title"), "");
                    if title.is_empty() {
                        return None;
                    }
                    Some(SuggestedTask {
                        title,
                        reason: string_or(item.get("reason"), ""),
                        priority: priority_or(item.get("priority")),
                        due_suggestion: item
                            .get("due_suggestion")
                            .and_then(|value| value.as_str())
                            .map(|value| value.to_string()),
                    })
                })
                .take(5)
                .collect()
        })
        .unwrap_or_default()
}

fn normalize_points(value: Option<&Value>) -> Vec<KnowledgePoint> {
    value
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let title = string_or(item.get("title"), "");
                    let content = string_or(item.get("content"), "");
                    if title.is_empty() && content.is_empty() {
                        return None;
                    }
                    Some(KnowledgePoint { title, content })
                })
                .take(8)
                .collect()
        })
        .unwrap_or_default()
}

fn normalize_tags(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(|value| value.trim().to_string()))
                .filter(|value| !value.is_empty())
                .take(12)
                .collect()
        })
        .unwrap_or_default()
}

fn string_or(value: Option<&Value>, fallback: &str) -> String {
    value
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn category_or(value: Option<&Value>) -> String {
    match value.and_then(|value| value.as_str()) {
        Some(category @ ("task" | "knowledge" | "reading" | "idea" | "decision" | "archive")) => {
            category.to_string()
        }
        _ => "archive".to_string(),
    }
}

fn priority_or(value: Option<&Value>) -> String {
    match value.and_then(|value| value.as_str()) {
        Some(priority @ ("low" | "medium" | "high")) => priority.to_string(),
        _ => "medium".to_string(),
    }
}

fn strip_json_fence(content: &str) -> String {
    let trimmed = content.trim();
    if trimmed.starts_with("```") {
        return trimmed
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim()
            .to_string();
    }
    trimmed.to_string()
}

fn truncate(value: &str, max: usize) -> String {
    if value.len() <= max {
        return value.to_string();
    }
    format!("{}...", &value[..max])
}
