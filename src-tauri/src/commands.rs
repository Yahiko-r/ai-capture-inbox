use crate::llm::{analyze_capture, has_llm_config, normalize_ai_result, resolve_llm_config};
use crate::models::{AiResult, AiRun, Capture, InputSnapshot, KnowledgeCard, LlmRequestResult, Task};
use crate::storage;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use reqwest::{Client, Url};
use serde::Serialize;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

const TEXT_EXTENSIONS: &[&str] = &["txt", "md", "json", "html", "csv"];
const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "heic"];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessedCapture {
    pub capture: Capture,
    pub result: AiResult,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptedSuggestions {
    pub tasks: Vec<Task>,
    pub cards: Vec<KnowledgeCard>,
}

#[tauri::command]
pub fn get_state(app: AppHandle) -> Result<crate::models::AppState, String> {
    storage::get_state(&app)
}

#[tauri::command]
pub fn create_text_capture(app: AppHandle, text: String) -> Result<Capture, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("Text is required.".to_string());
    }
    let normalized_text = trimmed.to_string();

    create_capture(
        &app,
        Capture {
            source_type: "text".to_string(),
            title: normalized_text.chars().take(80).collect(),
            raw_text: Some(text),
            normalized_text: Some(normalized_text),
            ..new_capture_base()
        },
    )
}

#[tauri::command]
pub async fn create_url_capture(app: AppHandle, url: String) -> Result<Capture, String> {
    let clean_url = url.trim();
    if clean_url.is_empty() {
        return Err("URL is required.".to_string());
    }

    let parsed = Url::parse(clean_url).map_err(|error| error.to_string())?;
    let mut capture = create_capture(
        &app,
        Capture {
            source_type: "url".to_string(),
            title: parsed.as_str().to_string(),
            source_url: Some(parsed.as_str().to_string()),
            normalized_text: Some(parsed.as_str().to_string()),
            ..new_capture_base()
        },
    )?;

    match extract_url(parsed).await {
        Ok(extracted) => {
            capture.title = extracted.title;
            capture.site = Some(extracted.site);
            capture.normalized_text = Some(extracted.normalized_text);
        }
        Err(error) => {
            capture.extraction_error = Some(error);
        }
    }

    capture.updated_at = storage::now_iso();
    replace_capture(&app, capture.clone())?;
    Ok(capture)
}

#[tauri::command]
pub fn create_file_capture(
    app: AppHandle,
    file_name: String,
    mime_type: Option<String>,
    data_base64: String,
) -> Result<Capture, String> {
    if file_name.trim().is_empty() {
        return Err("File name is required.".to_string());
    }
    if data_base64.trim().is_empty() {
        return Err("File data is required.".to_string());
    }

    let bytes = STANDARD
        .decode(data_base64.trim())
        .map_err(|error| format!("Invalid file data: {error}"))?;
    let upload_path = save_upload(&app, &file_name, &bytes)?;
    create_file_capture_from_path(&app, &upload_path, Some(file_name), mime_type)
}

#[tauri::command]
pub async fn process_captures(app: AppHandle, id: Option<String>) -> Result<Vec<ProcessedCapture>, String> {
    let captures = storage::list_captures(&app)?;
    let targets: Vec<Capture> = if let Some(id) = id {
        captures
            .into_iter()
            .filter(|capture| capture.id == id)
            .collect()
    } else {
        captures
            .into_iter()
            .filter(|capture| capture.status == "pending" || capture.status == "failed")
            .collect()
    };

    let mut results = Vec::new();
    for capture in targets {
        let result = process_capture(&app, capture.clone()).await?;
        let updated = get_capture(&app, &capture.id)?
            .ok_or_else(|| format!("Capture not found after processing: {}", capture.id))?;
        results.push(ProcessedCapture {
            capture: updated,
            result,
        });
    }

    Ok(results)
}

#[tauri::command]
pub fn accept_review(app: AppHandle, id: String) -> Result<AcceptedSuggestions, String> {
    let mut capture = get_capture(&app, &id)?.ok_or_else(|| format!("Capture not found: {id}"))?;
    let ai_result = capture
        .ai_result
        .clone()
        .ok_or_else(|| format!("Capture has no AI result: {id}"))?;

    let timestamp = storage::now_iso();
    let tasks: Vec<Task> = ai_result
        .suggested_tasks
        .iter()
        .map(|task| Task {
            id: storage::create_id("task"),
            capture_id: Some(capture.id.clone()),
            title: task.title.clone(),
            notes: task.reason.clone(),
            status: "open".to_string(),
            priority: task.priority.clone(),
            due_at: None,
            due_suggestion: task.due_suggestion.clone(),
            reminder_at: None,
            reminded_at: None,
            source: "ai".to_string(),
            completed_at: None,
            created_at: timestamp.clone(),
            updated_at: timestamp.clone(),
        })
        .collect();

    let cards: Vec<KnowledgeCard> = ai_result
        .knowledge_points
        .iter()
        .map(|point| KnowledgeCard {
            id: storage::create_id("kc"),
            capture_id: capture.id.clone(),
            title: if point.title.trim().is_empty() {
                ai_result.title.clone()
            } else {
                point.title.clone()
            },
            content: point.content.clone(),
            tags: ai_result.tags.clone(),
            source: "ai".to_string(),
            created_at: timestamp.clone(),
            updated_at: timestamp.clone(),
        })
        .collect();

    let mut existing_tasks = storage::list_tasks(&app)?;
    existing_tasks.extend(tasks.clone());
    storage::write_tasks(&app, &existing_tasks)?;

    let mut existing_cards = storage::list_knowledge_cards(&app)?;
    existing_cards.extend(cards.clone());
    storage::write_knowledge_cards(&app, &existing_cards)?;

    capture.status = "processed".to_string();
    capture.review_status = Some("accepted".to_string());
    capture.updated_at = storage::now_iso();
    replace_capture(&app, capture)?;

    Ok(AcceptedSuggestions { tasks, cards })
}

#[tauri::command]
pub fn dismiss_review(app: AppHandle, id: String) -> Result<Capture, String> {
    let mut capture = get_capture(&app, &id)?.ok_or_else(|| format!("Capture not found: {id}"))?;
    capture.status = "archived".to_string();
    capture.review_status = Some("dismissed".to_string());
    capture.updated_at = storage::now_iso();
    replace_capture(&app, capture.clone())?;
    Ok(capture)
}

#[tauri::command]
pub fn create_task(
    app: AppHandle,
    title: String,
    notes: Option<String>,
    due_at: Option<String>,
    reminder_at: Option<String>,
) -> Result<Task, String> {
    let clean_title = title.trim();
    if clean_title.is_empty() {
        return Err("Task title is required.".to_string());
    }

    let timestamp = storage::now_iso();
    let task = Task {
        id: storage::create_id("task"),
        capture_id: None,
        title: clean_title.to_string(),
        notes: notes.unwrap_or_default().trim().to_string(),
        status: "open".to_string(),
        priority: "medium".to_string(),
        due_at: clean_optional(due_at),
        due_suggestion: None,
        reminder_at: clean_optional(reminder_at),
        reminded_at: None,
        source: "manual".to_string(),
        completed_at: None,
        created_at: timestamp.clone(),
        updated_at: timestamp,
    };

    let mut tasks = storage::list_tasks(&app)?;
    tasks.push(task.clone());
    storage::write_tasks(&app, &tasks)?;
    Ok(task)
}

#[tauri::command]
pub fn update_task_schedule(
    app: AppHandle,
    id: String,
    due_at: Option<String>,
    reminder_at: Option<String>,
) -> Result<Task, String> {
    let mut tasks = storage::list_tasks(&app)?;
    let position = tasks
        .iter()
        .position(|task| task.id == id)
        .ok_or_else(|| format!("Task not found: {id}"))?;

    tasks[position].due_at = clean_optional(due_at);
    tasks[position].reminder_at = clean_optional(reminder_at);
    tasks[position].reminded_at = None;
    tasks[position].updated_at = storage::now_iso();
    let task = tasks[position].clone();
    storage::write_tasks(&app, &tasks)?;
    Ok(task)
}

#[tauri::command]
pub fn mark_task_reminded(app: AppHandle, id: String) -> Result<Task, String> {
    let mut tasks = storage::list_tasks(&app)?;
    let position = tasks
        .iter()
        .position(|task| task.id == id)
        .ok_or_else(|| format!("Task not found: {id}"))?;

    tasks[position].reminded_at = Some(storage::now_iso());
    tasks[position].updated_at = storage::now_iso();
    let task = tasks[position].clone();
    storage::write_tasks(&app, &tasks)?;
    Ok(task)
}

#[tauri::command]
pub fn show_task_notification(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(clean_notification_text(&title, "Task reminder"))
        .body(clean_notification_text(&body, "A task reminder is due."))
        .show()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn complete_task(app: AppHandle, id: String) -> Result<Task, String> {
    let mut tasks = storage::list_tasks(&app)?;
    let position = tasks
        .iter()
        .position(|task| task.id == id)
        .ok_or_else(|| format!("Task not found: {id}"))?;

    tasks[position].status = "done".to_string();
    tasks[position].completed_at = Some(storage::now_iso());
    tasks[position].updated_at = storage::now_iso();
    let task = tasks[position].clone();
    storage::write_tasks(&app, &tasks)?;
    Ok(task)
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn clean_notification_text(value: &str, fallback: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.chars().take(240).collect()
    }
}

async fn process_capture(app: &AppHandle, capture: Capture) -> Result<AiResult, String> {
    let started_at = storage::now_iso();
    let config = if has_llm_config() {
        Some(resolve_llm_config())
    } else {
        None
    };
    let provider = config
        .as_ref()
        .map(|config| config.provider.clone())
        .unwrap_or_else(|| "local-mock".to_string());
    let model = config.as_ref().map(|config| config.model.clone());

    let request_result = if config.is_some() {
        analyze_capture(&capture).await
    } else {
        Ok(LlmRequestResult {
            result: analyze_with_mock(&capture),
            provider: provider.clone(),
            model: "local-mock".to_string(),
        })
    };

    match request_result {
        Ok(result) => {
            let ai_result = result.result;
            create_ai_run(
                app,
                AiRun {
                    id: storage::create_id("airun"),
                    capture_id: capture.id.clone(),
                    provider: result.provider,
                    model: Some(result.model),
                    input_snapshot: snapshot(&capture),
                    output_json: Some(ai_result.clone()),
                    status: "success".to_string(),
                    error: None,
                    started_at,
                    created_at: storage::now_iso(),
                },
            )?;

            let mut updated = capture;
            updated.status = "needs_review".to_string();
            updated.review_status = Some("pending".to_string());
            updated.ai_result = Some(ai_result.clone());
            updated.processing_error = None;
            updated.updated_at = storage::now_iso();
            replace_capture(app, updated)?;
            Ok(ai_result)
        }
        Err(error) => {
            create_ai_run(
                app,
                AiRun {
                    id: storage::create_id("airun"),
                    capture_id: capture.id.clone(),
                    provider,
                    model,
                    input_snapshot: snapshot(&capture),
                    output_json: None,
                    status: "failed".to_string(),
                    error: Some(error.clone()),
                    started_at,
                    created_at: storage::now_iso(),
                },
            )?;

            let mut updated = capture;
            updated.status = "failed".to_string();
            updated.processing_error = Some(error.clone());
            updated.updated_at = storage::now_iso();
            replace_capture(app, updated)?;
            Err(error)
        }
    }
}

fn create_capture(app: &AppHandle, mut capture: Capture) -> Result<Capture, String> {
    capture.id = storage::create_id("cap");
    let timestamp = storage::now_iso();
    capture.created_at = timestamp.clone();
    capture.updated_at = timestamp;
    let mut captures = storage::list_captures(app)?;
    captures.push(capture.clone());
    storage::write_captures(app, &captures)?;
    Ok(capture)
}

fn new_capture_base() -> Capture {
    Capture {
        id: String::new(),
        source_type: String::new(),
        status: "pending".to_string(),
        review_status: None,
        ai_result: None,
        title: String::new(),
        raw_text: None,
        normalized_text: None,
        source_url: None,
        site: None,
        file_path: None,
        mime_type: None,
        image_data_url: None,
        ocr_text: None,
        ocr_provider: None,
        ocr_error: None,
        extraction_error: None,
        processing_error: None,
        created_at: String::new(),
        updated_at: String::new(),
    }
}

fn get_capture(app: &AppHandle, id: &str) -> Result<Option<Capture>, String> {
    Ok(storage::list_captures(app)?
        .into_iter()
        .find(|capture| capture.id == id))
}

fn replace_capture(app: &AppHandle, capture: Capture) -> Result<(), String> {
    let mut captures = storage::list_captures(app)?;
    let position = captures
        .iter()
        .position(|item| item.id == capture.id)
        .ok_or_else(|| format!("Capture not found: {}", capture.id))?;
    captures[position] = capture;
    storage::write_captures(app, &captures)
}

fn create_ai_run(app: &AppHandle, run: AiRun) -> Result<(), String> {
    let mut runs = storage::list_ai_runs(app)?;
    runs.insert(0, run);
    storage::write_ai_runs(app, &runs)
}

fn snapshot(capture: &Capture) -> InputSnapshot {
    InputSnapshot {
        title: capture.title.clone(),
        source_type: capture.source_type.clone(),
        normalized_text: capture.normalized_text.clone(),
    }
}

fn save_upload(app: &AppHandle, file_name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let dir = storage::data_dir(app)?.join("uploads");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let path = dir.join(format!(
        "{}-{}",
        storage::create_id("upload"),
        sanitize_file_name(file_name)
    ));
    fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(path)
}

fn create_file_capture_from_path(
    app: &AppHandle,
    source_path: &Path,
    original_name: Option<String>,
    provided_mime: Option<String>,
) -> Result<Capture, String> {
    let attachments = storage::data_dir(app)?.join("attachments");
    fs::create_dir_all(&attachments).map_err(|error| error.to_string())?;

    let extension = source_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    let stored_name = if extension.is_empty() {
        storage::create_id("file")
    } else {
        format!("{}.{}", storage::create_id("file"), extension)
    };
    let stored_path = attachments.join(stored_name);
    fs::copy(source_path, &stored_path).map_err(|error| error.to_string())?;

    let display_name = original_name
        .as_deref()
        .map(Path::new)
        .and_then(|path| path.file_name())
        .and_then(|value| value.to_str())
        .unwrap_or_else(|| {
            source_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("uploaded-file")
        })
        .to_string();
    let mime_type = provided_mime
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| guess_mime_type(&stored_path));

    let mut normalized_text = format!("File: {display_name}\nType: {mime_type}");
    let mut image_data_url = None;
    let mut ocr_text = None;
    let mut ocr_provider = None;
    let mut ocr_error = None;

    if is_text_file(&stored_path) {
        let content = fs::read_to_string(&stored_path).map_err(|error| error.to_string())?;
        normalized_text = format!("File: {display_name}\n\n{}", truncate_chars(&content, 20_000));
    }

    if is_image_file(&stored_path) {
        let bytes = fs::read(&stored_path).map_err(|error| error.to_string())?;
        image_data_url = Some(format!("data:{mime_type};base64,{}", STANDARD.encode(bytes)));
        match extract_image_text_with_local_ocr(&stored_path) {
            Ok(text) => {
                if !text.trim().is_empty() {
                    ocr_text = Some(text);
                    ocr_provider = Some("macos-vision".to_string());
                }
            }
            Err(error) => {
                ocr_error = Some(error);
            }
        }

        normalized_text = [
            format!("Image file: {display_name}"),
            format!("Type: {mime_type}"),
            ocr_text
                .as_ref()
                .map(|text| format!("Local OCR (macos-vision) text:\n{text}"))
                .unwrap_or_else(|| {
                    "No local OCR text extracted. Use direct vision analysis if the selected model supports image input.".to_string()
                }),
            ocr_error
                .as_ref()
                .map(|error| format!("Local OCR error: {error}"))
                .unwrap_or_default(),
        ]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    }

    create_capture(
        app,
        Capture {
            source_type: "file".to_string(),
            title: display_name,
            file_path: Some(stored_path.to_string_lossy().to_string()),
            mime_type: Some(mime_type),
            normalized_text: Some(normalized_text),
            image_data_url,
            ocr_text,
            ocr_provider,
            ocr_error,
            ..new_capture_base()
        },
    )
}

fn extract_image_text_with_local_ocr(image_path: &Path) -> Result<String, String> {
    let root = storage::project_root().ok_or_else(|| "Project root not found.".to_string())?;
    let script = root.join("scripts/macos-ocr.swift");
    if !script.exists() {
        return Err("macOS OCR helper not found.".to_string());
    }

    let output = Command::new("swift")
        .arg(script)
        .arg(image_path)
        .output()
        .map_err(|error| format!("Failed to start macOS OCR: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "macOS OCR failed.".to_string()
        } else {
            stderr
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

async fn extract_url(url: Url) -> Result<UrlExtractionResult, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(url.clone())
        .header("user-agent", "AI Capture Inbox/0.1")
        .send()
        .await
        .map_err(|error| error.to_string())?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("Failed to fetch URL: HTTP {status}"));
    }

    let html = response.text().await.map_err(|error| error.to_string())?;
    let title = extract_title(&html, url.as_str());
    let text = truncate_chars(&html_to_text(&html), 20_000);
    Ok(UrlExtractionResult {
        title: title.clone(),
        site: url.host_str().unwrap_or("").to_string(),
        normalized_text: format!("{title}\n\nSource: {}\n\n{text}", url.as_str())
            .trim()
            .to_string(),
    })
}

struct UrlExtractionResult {
    title: String,
    site: String,
    normalized_text: String,
}

fn analyze_with_mock(capture: &Capture) -> AiResult {
    let text = capture
        .normalized_text
        .clone()
        .or_else(|| capture.raw_text.clone())
        .unwrap_or_else(|| capture.title.clone());
    let lower = text.to_lowercase();
    let has_task_intent = [
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
        "跟进",
    ]
    .iter()
    .any(|keyword| lower.contains(&keyword.to_lowercase()));
    let has_knowledge_intent = [
        "how to", "guide", "tutorial", "learn", "concept", "教程", "知识", "方法", "原理",
        "文章", "观点",
    ]
    .iter()
    .any(|keyword| lower.contains(&keyword.to_lowercase()));
    let first_line = text
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(|line| line.trim())
        .unwrap_or(&capture.title);
    let title = truncate_chars(
        if capture.title.is_empty() {
            first_line
        } else {
            &capture.title
        },
        90,
    );

    let suggested_tasks = if has_task_intent {
        vec![json!({
            "title": to_task_title(first_line),
            "reason": "The capture contains action-oriented wording.",
            "priority": if lower.contains("urgent") || lower.contains("重要") { "high" } else { "medium" },
            "due_suggestion": null
        })]
    } else {
        Vec::new()
    };
    let knowledge_points = if has_knowledge_intent || !has_task_intent {
        vec![json!({
            "title": title,
            "content": summarize(&text)
        })]
    } else {
        Vec::new()
    };

    normalize_ai_result(&json!({
        "title": title,
        "summary": summarize(&text),
        "category": if has_task_intent { "task" } else if has_knowledge_intent { "knowledge" } else { "idea" },
        "why_saved": if has_task_intent {
            "This looks like something that may need a follow-up action."
        } else {
            "This looks like information worth keeping for later review."
        },
        "suggested_tasks": suggested_tasks,
        "knowledge_points": knowledge_points,
        "tags": infer_tags(&text, &capture.source_type),
        "confidence": 0.55
    }))
}

fn to_task_title(text: &str) -> String {
    let lower_prefixes = ["todo", "task", "remember to", "need to", "should"];
    let mut clean = text.trim().trim_start_matches("- ").trim_start_matches("* ");
    for prefix in lower_prefixes {
        if clean.to_lowercase().starts_with(prefix) {
            clean = clean[prefix.len()..].trim_start_matches(':').trim();
            break;
        }
    }
    let value = truncate_chars(clean, 100);
    if value.is_empty() {
        "Review captured item".to_string()
    } else {
        value
    }
}

fn summarize(text: &str) -> String {
    truncate_chars(&text.split_whitespace().collect::<Vec<_>>().join(" "), 240)
}

fn infer_tags(text: &str, source_type: &str) -> Vec<String> {
    let mut tags = vec![source_type.to_string()];
    let pairs = [
        ("ai", ["ai", "llm", "agent", "模型", "人工智能"].as_slice()),
        ("product", ["product", "产品", "设计", "竞品"].as_slice()),
        ("reading", ["article", "blog", "阅读", "文章"].as_slice()),
        ("work", ["meeting", "project", "工作", "项目"].as_slice()),
    ];
    let lower = text.to_lowercase();
    for (tag, keywords) in pairs {
        if keywords
            .iter()
            .any(|keyword| lower.contains(&keyword.to_lowercase()))
            && !tags.iter().any(|existing| existing == tag)
        {
            tags.push(tag.to_string());
        }
    }
    tags
}

fn extract_title(html: &str, url: &str) -> String {
    if let Some(start) = html.to_lowercase().find("<title") {
        if let Some(open_end) = html[start..].find('>') {
            let content_start = start + open_end + 1;
            if let Some(close) = html[content_start..].to_lowercase().find("</title>") {
                return truncate_chars(
                    &decode_html(&html[content_start..content_start + close])
                        .split_whitespace()
                        .collect::<Vec<_>>()
                        .join(" "),
                    120,
                );
            }
        }
    }
    Url::parse(url)
        .ok()
        .and_then(|url| url.host_str().map(|value| value.to_string()))
        .unwrap_or_else(|| url.to_string())
}

fn html_to_text(html: &str) -> String {
    let mut text = String::new();
    let mut in_tag = false;
    let mut tag = String::new();
    let mut skip_until: Option<String> = None;

    for ch in html.chars() {
        if in_tag {
            if ch == '>' {
                let tag_lower = tag.trim().to_lowercase();
                if tag_lower.starts_with("script") {
                    skip_until = Some("script".to_string());
                } else if tag_lower.starts_with("style") {
                    skip_until = Some("style".to_string());
                } else if tag_lower.starts_with("/script") || tag_lower.starts_with("/style") {
                    skip_until = None;
                } else if skip_until.is_none()
                    && (tag_lower.starts_with("/p")
                        || tag_lower.starts_with("/div")
                        || tag_lower.starts_with("/li")
                        || tag_lower.starts_with("br")
                        || tag_lower.starts_with("/h")
                        || tag_lower.starts_with("/article")
                        || tag_lower.starts_with("/section"))
                {
                    text.push('\n');
                }
                tag.clear();
                in_tag = false;
            } else {
                tag.push(ch);
            }
            continue;
        }

        if ch == '<' {
            in_tag = true;
            continue;
        }
        if skip_until.is_none() {
            text.push(ch);
        }
    }

    decode_html(&text)
        .lines()
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn decode_html(value: &str) -> String {
    value
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn sanitize_file_name(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .chars()
        .take(120)
        .collect::<String>()
}

fn guess_mime_type(path: &Path) -> String {
    match extension(path).as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("tif" | "tiff") => "image/tiff",
        Some("heic") => "image/heic",
        Some("md") => "text/markdown",
        Some("html" | "htm") => "text/html",
        Some("json") => "application/json",
        Some("csv") => "text/csv",
        Some("txt") => "text/plain",
        _ => "application/octet-stream",
    }
    .to_string()
}

fn is_text_file(path: &Path) -> bool {
    extension(path)
        .map(|extension| TEXT_EXTENSIONS.contains(&extension.as_str()))
        .unwrap_or(false)
}

fn is_image_file(path: &Path) -> bool {
    extension(path)
        .map(|extension| IMAGE_EXTENSIONS.contains(&extension.as_str()))
        .unwrap_or(false)
}

fn extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_lowercase())
}

fn truncate_chars(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}
