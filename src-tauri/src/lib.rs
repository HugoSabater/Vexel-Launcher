#![deny(clippy::unwrap_used, clippy::expect_used)]

pub mod commands;
pub mod core;
pub mod error;

use std::collections::HashMap;
use std::sync::Arc;

use tauri::Manager;
use tokio::sync::Mutex;

use crate::commands::AppState;
use crate::core::hardware::detect_hardware;
use crate::core::instance::load_or_init_config;
use crate::core::paths::LauncherPaths;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .setup(|app| {
            let paths = LauncherPaths::resolve()?;
            let hardware = detect_hardware();
            let client = reqwest::Client::builder()
                .user_agent("mc-launcher-rust/0.1.0 (https://github.com/HugoSabater/mc-launcher-rust)")
                .build()?;

            let config = tauri::async_runtime::block_on(load_or_init_config(&paths, &hardware))?;

            app.manage(AppState {
                client,
                paths,
                hardware,
                config: Mutex::new(config),
                running_processes: Arc::new(Mutex::new(HashMap::new())),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_bootstrap_state,
            commands::get_live_memory_telemetry,
            commands::save_global_settings,
            commands::create_or_update_profile,
            commands::set_default_profile,
            commands::remove_profile,
            commands::get_jvm_flags_preview,
            commands::list_profile_content,
            commands::toggle_profile_content,
            commands::delete_profile_content,
            commands::import_profile_content,
            commands::import_profile_content_bytes,
            commands::inject_performance_preset,
            commands::get_curated_recommendations,
            commands::get_dynamic_recommendations,
            commands::search_modrinth,
            commands::install_modrinth_item,
            commands::upload_custom_skin,
            commands::upload_custom_skin_bytes,
            commands::get_player_skin_data,
            commands::set_skin_model,
            commands::get_instance_summary,
            commands::get_launch_command_preview,
            commands::list_installed_javas,
            commands::get_storage_breakdown,
            commands::revalidate_cache_index,
            commands::clean_old_logs,
            commands::open_instance_saves_folder,
            commands::open_data_root_folder,
            commands::check_profile_java,
            commands::install_adoptium_java,
            commands::stop_instance,
            commands::open_instance_folder,
            commands::launch_profile,
        ]);

    if let Err(err) = builder.run(tauri::generate_context!()) {
        eprintln!("Failed to run Tauri application: {err}");
    }
}
