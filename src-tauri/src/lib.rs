#![deny(clippy::unwrap_used, clippy::expect_used)]

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(err) = tauri::Builder::default().run(tauri::generate_context!()) {
        eprintln!("Failed to run Tauri application: {err}");
    }
}
