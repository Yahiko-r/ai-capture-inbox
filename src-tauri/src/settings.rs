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
pub struct LlmProfile {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub api_key: String,
    pub base_url: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfilesConfig {
    pub current_profile_id: Option<String>,
    pub profiles: Vec<LlmProfile>,
}

impl Default for ProfilesConfig {
    fn default() -> Self {
        Self {
            current_profile_id: None,
            profiles: Vec::new(),
        }
    }
}

#[tauri::command]
pub fn get_llm_profiles(app: AppHandle) -> Result<ProfilesConfig, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {}", e))?;

    let profiles_value = store.get("llm_profiles");

    if let Some(value) = profiles_value {
        let config: ProfilesConfig = serde_json::from_value(value.clone())
            .map_err(|e| format!("Failed to parse profiles: {}", e))?;
        Ok(config)
    } else {
        Ok(ProfilesConfig::default())
    }
}

#[tauri::command]
pub fn save_llm_profile(
    app: AppHandle,
    profile_id: Option<String>,
    profile_name: String,
    provider: String,
    api_key: String,
    base_url: Option<String>,
    model: Option<String>,
) -> Result<ProfilesConfig, String> {
    let mut config = get_llm_profiles(app.clone())?;

    let id = profile_id.unwrap_or_else(|| {
        format!("profile_{}", chrono::Utc::now().timestamp_millis())
    });

    let new_profile = LlmProfile {
        id: id.clone(),
        name: profile_name,
        provider,
        api_key,
        base_url,
        model,
    };

    // 查找是否存在相同ID的profile
    if let Some(pos) = config.profiles.iter().position(|p| p.id == id) {
        config.profiles[pos] = new_profile;
    } else {
        config.profiles.push(new_profile);
    }

    // 如果是第一个profile，设置为当前
    if config.current_profile_id.is_none() {
        config.current_profile_id = Some(id);
    }

    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {}", e))?;

    store.set("llm_profiles", serde_json::to_value(&config).unwrap());

    store
        .save()
        .map_err(|e| format!("Failed to persist profiles: {}", e))?;

    Ok(config)
}

#[tauri::command]
pub fn set_current_profile(app: AppHandle, profile_id: String) -> Result<ProfilesConfig, String> {
    let mut config = get_llm_profiles(app.clone())?;

    if !config.profiles.iter().any(|p| p.id == profile_id) {
        return Err("Profile not found".to_string());
    }

    config.current_profile_id = Some(profile_id);

    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {}", e))?;

    store.set("llm_profiles", serde_json::to_value(&config).unwrap());

    store
        .save()
        .map_err(|e| format!("Failed to persist profiles: {}", e))?;

    Ok(config)
}

#[tauri::command]
pub fn delete_llm_profile(app: AppHandle, profile_id: String) -> Result<ProfilesConfig, String> {
    let mut config = get_llm_profiles(app.clone())?;

    config.profiles.retain(|p| p.id != profile_id);

    // 如果删除的是当前profile，切换到第一个
    if config.current_profile_id.as_ref() == Some(&profile_id) {
        config.current_profile_id = config.profiles.first().map(|p| p.id.clone());
    }

    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {}", e))?;

    store.set("llm_profiles", serde_json::to_value(&config).unwrap());

    store
        .save()
        .map_err(|e| format!("Failed to persist profiles: {}", e))?;

    Ok(config)
}

#[tauri::command]
pub fn rename_llm_profile(
    app: AppHandle,
    profile_id: String,
    new_name: String,
) -> Result<ProfilesConfig, String> {
    let mut config = get_llm_profiles(app.clone())?;

    if let Some(profile) = config.profiles.iter_mut().find(|p| p.id == profile_id) {
        profile.name = new_name;
    } else {
        return Err("Profile not found".to_string());
    }

    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {}", e))?;

    store.set("llm_profiles", serde_json::to_value(&config).unwrap());

    store
        .save()
        .map_err(|e| format!("Failed to persist profiles: {}", e))?;

    Ok(config)
}

// 保留旧的命令以兼容
#[tauri::command]
pub fn get_llm_settings(app: AppHandle) -> Result<Option<LlmSettings>, String> {
    let config = get_llm_profiles(app)?;

    if let Some(profile_id) = config.current_profile_id {
        if let Some(profile) = config.profiles.iter().find(|p| p.id == profile_id) {
            return Ok(Some(LlmSettings {
                provider: profile.provider.clone(),
                api_key: profile.api_key.clone(),
                base_url: profile.base_url.clone(),
                model: profile.model.clone(),
            }));
        }
    }

    Ok(None)
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
    let text = response
        .text()
        .await
        .unwrap_or_else(|_| "Empty response".to_string());

    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status, text));
    }

    // 验证返回的是有效JSON
    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(_) => Ok(format!("Connection successful! Model: {}", test_model)),
        Err(e) => Err(format!("Invalid JSON response: {}. Response body: {}", e, &text[..text.len().min(200)])),
    }
}
