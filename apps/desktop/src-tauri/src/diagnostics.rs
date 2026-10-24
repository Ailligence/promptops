//! Bounded, metadata-only error spool. Never persist error messages or panic payloads.
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    fs,
    path::PathBuf,
    sync::OnceLock,
    time::{Duration, Instant},
};
use tauri::Manager;

const LIMIT: usize = 50;
static RECORDER: OnceLock<Recorder> = OnceLock::new();

struct Recorder {
    directory: PathBuf,
    recent: Mutex<VecDeque<(String, Instant)>>,
}

#[derive(Serialize, Deserialize)]
struct Report {
    id: String,
    version: String,
    os: String,
    arch: String,
    kind: String,
    location: String,
    occurred_at: String,
}

// Only build artifact/source locations, never arbitrary error text or URLs.
fn safe_location(raw: &str) -> String {
    let Some(raw) = raw.split(['?', '#']).next() else {
        return "unknown".into();
    };
    let leaf = raw.rsplit(['/', '\\']).next().unwrap_or("");
    let mut parts = leaf.split(':');
    let file = parts.next().unwrap_or("");
    let numbers: Vec<_> = parts.collect();
    let valid = leaf.len() <= 160
        && file
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
        && (file.ends_with(".rs") || file.ends_with(".js") || file.ends_with(".ts"))
        && (1..=2).contains(&numbers.len())
        && numbers
            .iter()
            .all(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()));
    if valid {
        leaf.into()
    } else {
        "unknown".into()
    }
}

impl Recorder {
    fn record(&self, kind: &str, raw_location: &str) {
        let location = safe_location(raw_location);
        let key = format!("{kind}:{location}");
        // A panic must never wait for a lock held by the panicking thread.
        let Some(mut recent) = self.recent.try_lock() else {
            return;
        };
        recent.retain(|(_, at)| at.elapsed() < Duration::from_secs(3600));
        if recent.len() >= LIMIT || recent.iter().any(|(k, _)| k == &key) {
            return;
        }
        let Ok(entries) = fs::read_dir(&self.directory) else {
            return;
        };
        if entries
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|s| s == "json"))
            .count()
            >= LIMIT
        {
            return;
        }
        let report = Report {
            id: uuid::Uuid::new_v4().to_string(),
            version: env!("CARGO_PKG_VERSION").into(),
            os: std::env::consts::OS.into(),
            arch: std::env::consts::ARCH.into(),
            kind: kind.into(),
            location,
            occurred_at: chrono::Utc::now().to_rfc3339(),
        };
        if let Ok(data) = serde_json::to_vec(&report) {
            let temporary = self.directory.join(format!("{}.tmp", report.id));
            if fs::write(&temporary, data).is_ok()
                && fs::rename(
                    &temporary,
                    self.directory.join(format!("{}.json", report.id)),
                )
                .is_ok()
            {
                recent.push_back((key, Instant::now()));
            }
        }
    }
}

pub fn record(kind: &str, location: &str) {
    if let Some(recorder) = RECORDER.get() {
        recorder.record(kind, location);
    }
}

pub fn observe_log(message: &str, location: &str) {
    // Existing Rust diagnostics use eprintln!. Inspect only for severity;
    // persist the compile-time call site, never the formatted message.
    if RECORDER.get().is_none() {
        return;
    }
    let lower = message.to_ascii_lowercase();
    if lower.contains("error") || lower.contains("failed") || lower.contains("panic") {
        record("rust_error", location);
    }
}

#[tauri::command]
pub fn diagnostics_report(kind: String, location: String) {
    if matches!(
        kind.as_str(),
        "frontend_error" | "unhandled_rejection" | "angular_error"
    ) && location.len() <= 512
    {
        record(&kind, &location);
    }
}

pub fn init(app: &tauri::AppHandle) {
    let Ok(directory) = app.path().app_log_dir().map(|p| p.join("reports")) else {
        return;
    };
    if fs::create_dir_all(&directory).is_err() {
        return;
    }
    if RECORDER
        .set(Recorder {
            directory: directory.clone(),
            recent: Mutex::new(VecDeque::new()),
        })
        .is_err()
    {
        return;
    }
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if let Some(location) = info.location() {
            record(
                "rust_panic",
                &format!(
                    "{}:{}:{}",
                    location.file(),
                    location.line(),
                    location.column()
                ),
            );
        } else {
            record("rust_panic", "unknown");
        }
        previous(info);
    }));
    // Reports stay on this device: a background thread only deletes the ones
    // older than 7 days (or oversized). Nothing is uploaded.
    let _ = std::thread::Builder::new()
        .name("diagnostics".into())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_secs(60));
            let Ok(entries) = fs::read_dir(&directory) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.extension().is_some_and(|s| s == "json" || s == "tmp") {
                    continue;
                }
                let Ok(metadata) = entry.metadata() else {
                    continue;
                };
                let expired = metadata
                    .modified()
                    .ok()
                    .and_then(|m| m.elapsed().ok())
                    .is_some_and(|age| age > Duration::from_secs(7 * 86400));
                if expired || metadata.len() > 4096 {
                    let _ = fs::remove_file(&path);
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strips_private_paths_and_rejects_messages() {
        assert_eq!(
            safe_location("/Users/alice/project/main.rs:12:3"),
            "main.rs:12:3"
        );
        assert_eq!(
            safe_location("https://localhost/main-ABC.js:2:3?token=secret"),
            "main-ABC.js:2:3"
        );
        assert_eq!(safe_location("Bearer secret prompt content"), "unknown");
        assert_eq!(safe_location("main.js:secret"), "unknown");
    }
    #[test]
    fn spool_deduplicates_and_caps_reports() {
        let directory = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&directory).unwrap();
        let recorder = Recorder {
            directory: directory.clone(),
            recent: Mutex::new(VecDeque::new()),
        };
        for _ in 0..100 {
            recorder.record("rust_panic", "main.rs:1:1");
        }
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        for i in 2..100 {
            recorder.record("rust_panic", &format!("main.rs:{i}:1"));
        }
        assert_eq!(fs::read_dir(&directory).unwrap().count(), LIMIT);
        fs::remove_dir_all(directory).unwrap();
    }
}
