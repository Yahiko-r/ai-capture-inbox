use crate::models::{AiRun, AppState, BigNote, Capture, KnowledgeCard, Note, Stats, Task};
use chrono::SecondsFormat;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

static ID_COUNTER: AtomicU64 = AtomicU64::new(1);

const CAPTURES: &str = "captures.json";
const NOTES: &str = "notes.json";
const BIG_NOTES: &str = "big-notes.json";
const TASKS: &str = "tasks.json";
const KNOWLEDGE_CARDS: &str = "knowledge-cards.json";
const AI_RUNS: &str = "ai-runs.json";
const SETTINGS: &str = "settings.json";

pub fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(root) = find_project_root() {
        return Ok(root.join("data"));
    }

    app.path().app_data_dir().map_err(|error| error.to_string())
}

pub fn project_root() -> Option<PathBuf> {
    find_project_root()
}

fn find_project_root() -> Option<PathBuf> {
    let current = std::env::current_dir().ok()?;
    for candidate in current.ancestors() {
        if candidate.join("package.json").exists() && candidate.join("src-tauri").exists() {
            return Some(candidate.to_path_buf());
        }
    }
    None
}

pub fn ensure_ready(app: &AppHandle) -> Result<(), String> {
    let dir = data_dir(app)?;
    fs::create_dir_all(dir.join("attachments")).map_err(|error| error.to_string())?;
    fs::create_dir_all(dir.join("uploads")).map_err(|error| error.to_string())?;
    ensure_file(&dir.join(CAPTURES), "[]")?;
    ensure_file(&dir.join(NOTES), "[]")?;
    ensure_file(&dir.join(BIG_NOTES), "[]")?;
    ensure_file(&dir.join(TASKS), "[]")?;
    ensure_file(&dir.join(KNOWLEDGE_CARDS), "[]")?;
    ensure_file(&dir.join(AI_RUNS), "[]")?;
    ensure_file(&dir.join(SETTINGS), "{}")?;
    Ok(())
}

fn ensure_file(path: &Path, default_value: &str) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    fs::write(path, format!("{default_value}\n")).map_err(|error| error.to_string())
}

pub fn read_json<T: DeserializeOwned>(app: &AppHandle, file_name: &str) -> Result<T, String> {
    ensure_ready(app)?;
    let path = data_dir(app)?.join(file_name);
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

pub fn write_json<T: Serialize>(app: &AppHandle, file_name: &str, value: &T) -> Result<(), String> {
    ensure_ready(app)?;
    let path = data_dir(app)?.join(file_name);
    let tmp = path.with_extension("json.tmp");
    let content = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    fs::write(&tmp, format!("{content}\n")).map_err(|error| error.to_string())?;
    fs::rename(tmp, path).map_err(|error| error.to_string())
}

pub fn list_captures(app: &AppHandle) -> Result<Vec<Capture>, String> {
    read_json(app, CAPTURES)
}

pub fn write_captures(app: &AppHandle, captures: &[Capture]) -> Result<(), String> {
    write_json(app, CAPTURES, &captures)
}

pub fn list_notes(app: &AppHandle) -> Result<Vec<Note>, String> {
    read_json(app, NOTES)
}

pub fn write_notes(app: &AppHandle, notes: &[Note]) -> Result<(), String> {
    write_json(app, NOTES, &notes)
}

pub fn list_big_notes(app: &AppHandle) -> Result<Vec<BigNote>, String> {
    read_json(app, BIG_NOTES)
}

pub fn write_big_notes(app: &AppHandle, notes: &[BigNote]) -> Result<(), String> {
    write_json(app, BIG_NOTES, &notes)
}

pub fn list_tasks(app: &AppHandle) -> Result<Vec<Task>, String> {
    read_json(app, TASKS)
}

pub fn write_tasks(app: &AppHandle, tasks: &[Task]) -> Result<(), String> {
    write_json(app, TASKS, &tasks)
}

pub fn list_knowledge_cards(app: &AppHandle) -> Result<Vec<KnowledgeCard>, String> {
    read_json(app, KNOWLEDGE_CARDS)
}

pub fn write_knowledge_cards(app: &AppHandle, cards: &[KnowledgeCard]) -> Result<(), String> {
    write_json(app, KNOWLEDGE_CARDS, &cards)
}

pub fn list_ai_runs(app: &AppHandle) -> Result<Vec<AiRun>, String> {
    read_json(app, AI_RUNS)
}

pub fn write_ai_runs(app: &AppHandle, runs: &[AiRun]) -> Result<(), String> {
    write_json(app, AI_RUNS, &runs)
}

pub fn get_state(app: &AppHandle) -> Result<AppState, String> {
    let captures = list_captures(app)?;
    let mut notes = list_notes(app)?;
    if notes.is_empty() && !captures.is_empty() {
        notes = captures.iter().map(note_from_capture).collect();
    }
    let big_notes = list_big_notes(app)?;
    let tasks = list_tasks(app)?;
    let knowledge_cards = list_knowledge_cards(app)?;
    let ai_runs = list_ai_runs(app)?;
    let stats = Stats {
        notes: notes.len(),
        big_notes: big_notes.len(),
        inbox: captures
            .iter()
            .filter(|capture| capture.status == "pending" || capture.status == "failed")
            .count(),
        review: captures
            .iter()
            .filter(|capture| capture.review_status.as_deref() == Some("pending"))
            .count(),
        tasks_open: tasks.iter().filter(|task| task.status == "open").count(),
        knowledge: knowledge_cards.len(),
    };

    Ok(AppState {
        notes,
        big_notes,
        captures,
        tasks,
        knowledge_cards,
        ai_runs,
        stats,
    })
}

fn note_from_capture(capture: &Capture) -> Note {
    let ai_summary = capture.ai_result.as_ref().map(|result| {
        [
            result.summary.clone(),
            if result.why_saved.trim().is_empty() {
                String::new()
            } else {
                format!("Why saved: {}", result.why_saved)
            },
            result
                .knowledge_points
                .iter()
                .map(|point| {
                    if point.content.trim().is_empty() {
                        point.title.clone()
                    } else {
                        format!("{}: {}", point.title, point.content)
                    }
                })
                .collect::<Vec<_>>()
                .join("\n"),
        ]
        .into_iter()
        .filter(|value| !value.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
    });

    Note {
        id: capture.id.clone(),
        title: capture
            .ai_result
            .as_ref()
            .map(|result| result.title.clone())
            .filter(|title| !title.trim().is_empty())
            .unwrap_or_else(|| capture.title.clone()),
        source_type: if capture.image_data_url.is_some() {
            "image".to_string()
        } else {
            capture.source_type.clone()
        },
        raw_text: capture.raw_text.clone(),
        source_url: capture.source_url.clone(),
        site: capture.site.clone(),
        file_path: capture.file_path.clone(),
        mime_type: capture.mime_type.clone(),
        image_data_url: capture.image_data_url.clone(),
        extracted_text: capture
            .normalized_text
            .clone()
            .or_else(|| capture.ocr_text.clone()),
        ai_summary,
        ai_title: capture
            .ai_result
            .as_ref()
            .map(|result| result.title.clone()),
        ai_category: capture
            .ai_result
            .as_ref()
            .map(|result| result.category.clone()),
        ai_tags: capture
            .ai_result
            .as_ref()
            .map(|result| result.tags.clone())
            .unwrap_or_default(),
        status: capture.status.clone(),
        processing_error: capture
            .processing_error
            .clone()
            .or_else(|| capture.extraction_error.clone()),
        created_at: capture.created_at.clone(),
        updated_at: capture.updated_at.clone(),
    }
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn create_id(prefix: &str) -> String {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let count = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}_{:x}{:x}", duration.as_nanos(), count)
}
