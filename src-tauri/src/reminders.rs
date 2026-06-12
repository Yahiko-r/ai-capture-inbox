use crate::models::Task;
use crate::storage;
use chrono::{DateTime, Utc};
use std::thread;
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

const REMINDER_CHECK_SECONDS: u64 = 30;

pub fn start(app: AppHandle) {
    thread::spawn(move || loop {
        if let Err(error) = check_due_reminders(&app) {
            eprintln!("Reminder check failed: {error}");
        }
        thread::sleep(Duration::from_secs(REMINDER_CHECK_SECONDS));
    });
}

fn check_due_reminders(app: &AppHandle) -> Result<(), String> {
    let mut tasks = storage::list_tasks(app)?;
    let now = Utc::now();
    let mut changed = false;

    for task in tasks.iter_mut() {
        if should_remind(task, now) {
            show_notification(app, task)?;
            let timestamp = storage::now_iso();
            task.reminded_at = Some(timestamp.clone());
            task.updated_at = timestamp;
            changed = true;
        }
    }

    if changed {
        storage::write_tasks(app, &tasks)?;
    }

    Ok(())
}

fn should_remind(task: &Task, now: DateTime<Utc>) -> bool {
    if task.status != "open" || task.reminded_at.is_some() {
        return false;
    }

    task.reminder_at
        .as_deref()
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc) <= now)
        .unwrap_or(false)
}

fn show_notification(app: &AppHandle, task: &Task) -> Result<(), String> {
    app.notification()
        .builder()
        .title("Task reminder")
        .body(notification_body(task))
        .show()
        .map_err(|error| error.to_string())
}

fn notification_body(task: &Task) -> String {
    if task.title.trim().is_empty() {
        "A task reminder is due.".to_string()
    } else {
        task.title.trim().chars().take(240).collect()
    }
}
