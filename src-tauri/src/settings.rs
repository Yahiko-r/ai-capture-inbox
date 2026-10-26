use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "settings.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmSettings {
    pub provider: String,
    pub api_key: String,
    pub base_url: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub llm: Option<LlmSettings>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self { llm: None }
    }
}

#[tauri::command]
pub fn get_llm_settings(app: AppHandle) -> Result<Option<LlmSettings>, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {}", e))?;

    let llm_value = store.get("llm");

    if let Some(value) = llm_value {
        let settings: LlmSettings = serde_json::from_value(value.clone())
            .map_err(|e| format!("Failed to parse LLM settings: {}", e))?;
        Ok(Some(settings))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn save_llm_settings(
    app: AppHandle,
    provider: String,
    api_key: String,
    base_url: Option<String>,
    model: Option<String>,
) -> Result<(), String> {
    let settings = LlmSettings {
        provider,
        api_key,
        base_url,
        model,
    };

    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {}", e))?;

    store.set("llm", serde_json::to_value(&settings).unwrap());

    store
        .save()
        .map_err(|e| format!("Failed to persist settings: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn test_llm_connection(
    provider: String,
    api_key: String,
    base_url: Option<String>,
    model: Option<String>,
) -> Result<String, String> {
    use reqwest::Client;
    use serde_json::json;

    let (endpoint, test_model) = match provider.as_str() {
        "deepseek" => (
            base_url.unwrap_or_else(|| "https://api.deepseek.com".to_string()),
            model.unwrap_or_else(|| "deepseek-flash".to_string()),
        ),
        "openai" => (
            base_url.unwrap_or_else(|| "https://api.openai.com/v1".to_string()),
            model.unwrap_or_else(|| "gpt-4o-mini".to_string()),
        ),
        _ => return Err("Unsupported provider".to_string()),
    };

    let url = format!("{}/chat/completions", endpoint.trim_end_matches('/'));
    let client = Client::new();

    let body = json!({
        "model": test_model,
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 5
    });

    let response = client
        .post(&url)
        .bearer_auth(&api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let status = response.status();
    if status.is_success() {
        Ok(format!("Connection successful! Model: {}", test_model))
    } else {
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        Err(format!("HTTP {}: {}", status, text))
    }
}
