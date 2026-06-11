use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SuggestedTask {
    pub title: String,
    pub reason: String,
    pub priority: String,
    pub due_suggestion: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct KnowledgePoint {
    pub title: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AiResult {
    pub title: String,
    pub summary: String,
    pub category: String,
    pub why_saved: String,
    pub suggested_tasks: Vec<SuggestedTask>,
    pub knowledge_points: Vec<KnowledgePoint>,
    pub tags: Vec<String>,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Capture {
    pub id: String,
    pub source_type: String,
    pub status: String,
    pub review_status: Option<String>,
    pub ai_result: Option<AiResult>,
    pub title: String,
    pub raw_text: Option<String>,
    pub normalized_text: Option<String>,
    pub source_url: Option<String>,
    pub site: Option<String>,
    pub file_path: Option<String>,
    pub mime_type: Option<String>,
    pub image_data_url: Option<String>,
    pub ocr_text: Option<String>,
    pub ocr_provider: Option<String>,
    pub ocr_error: Option<String>,
    pub extraction_error: Option<String>,
    pub processing_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub capture_id: Option<String>,
    pub title: String,
    pub notes: String,
    pub status: String,
    pub priority: String,
    pub due_at: Option<String>,
    pub due_suggestion: Option<String>,
    pub reminder_at: Option<String>,
    pub reminded_at: Option<String>,
    pub source: String,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeCard {
    pub id: String,
    pub capture_id: String,
    pub title: String,
    pub content: String,
    pub tags: Vec<String>,
    pub source: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InputSnapshot {
    pub title: String,
    pub source_type: String,
    pub normalized_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiRun {
    pub id: String,
    pub capture_id: String,
    pub provider: String,
    pub model: Option<String>,
    pub input_snapshot: InputSnapshot,
    pub output_json: Option<AiResult>,
    pub status: String,
    pub error: Option<String>,
    pub started_at: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub inbox: usize,
    pub review: usize,
    pub tasks_open: usize,
    pub knowledge: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    pub captures: Vec<Capture>,
    pub tasks: Vec<Task>,
    pub knowledge_cards: Vec<KnowledgeCard>,
    pub ai_runs: Vec<AiRun>,
    pub stats: Stats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmConfig {
    pub provider: String,
    pub api_key: Option<String>,
    pub base_url: String,
    pub model: String,
    pub supports_image_input: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmRequestResult {
    pub result: AiResult,
    pub provider: String,
    pub model: String,
}
