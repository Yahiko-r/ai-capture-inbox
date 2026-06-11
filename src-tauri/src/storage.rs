use crate::models::{AiRun, AppState, Capture, KnowledgeCard, Stats, Task};
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
const TASKS: &str = "tasks.json";
const KNOWLEDGE_CARDS: &str = "knowledge-cards.json";
const AI_RUNS: &str = "ai-runs.json";
const SETTINGS: &str = "settings.json";

pub fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(root) = find_project_root() {
        return Ok(root.join("data"));
    }

    app.path()
        .app_data_dir()
        .map_err(|error| error.to_string())
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
    let tasks = list_tasks(app)?;
    let knowledge_cards = list_knowledge_cards(app)?;
    let ai_runs = list_ai_runs(app)?;
    let stats = Stats {
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
        captures,
        tasks,
        knowledge_cards,
        ai_runs,
        stats,
    })
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
