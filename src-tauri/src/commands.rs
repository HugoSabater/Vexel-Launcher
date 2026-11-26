use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{State, Window};
use tokio::sync::Mutex;

use crate::core::content::{
    delete_content_item, get_dynamic_recommendations as fetch_dynamic_recommendations,
    get_optimization_stack_info, import_content_bytes_with_options,
    import_content_file_with_options, inject_modrinth_preset, install_single_modrinth_item,
    list_instance_content, search_modrinth_catalog, toggle_content_item, ContentItem, ContentKind,
    ModrinthSearchResult, OptimizationStackInfo, PerformancePreset,
};
use crate::core::downloader::{verify_and_download_all, DownloadProgress};
use crate::core::global_options::{
    apply_global_options_to_instance_dir, import_global_options_from_instance_dir,
    load_global_options, update_global_options_from_ui, ApplyGlobalOptionsResult,
    GlobalGameOptionsResponse, SaveGlobalGameOptionsPayload,
};
use crate::core::hardware::{
    sample_live_memory_telemetry, HardwareInfo, LiveMemoryTelemetry,
};
use crate::core::instance::{
    delete_profile, save_config_atomic, upsert_profile, validate_profile_id, LauncherConfig,
    ModLoaderKind, Profile,
};
use crate::core::java::{
    check_java_runtime, detect_java_major, install_java_runtime,
    list_installed_javas as scan_installed_javas, InstalledJavaRuntime, JavaRuntimeStatus,
};
use crate::core::jvm_optimizer::{generate_jvm_flags, GcPreset, JvmTuningInput, JvmTuningOutput};
use crate::core::loaders::{
    merge_overlay_into_plan_dedup, resolve_fabric_overlay, resolve_forge_overlay,
    resolve_neoforge_overlay,
};
use crate::core::manifest::{
    build_download_plan, extract_game_arguments, fetch_or_load_asset_index,
    fetch_or_load_version_list, fetch_or_load_version_manifest, validate_version_id,
    MinecraftVersionEntry,
};
use crate::core::mrpack::{
    detect_loader_from_dependencies, export_instance_to_mrpack, populate_instance_from_mrpack,
    read_mrpack_index_blocking, slugify_profile_name, MrpackExportResult, MrpackImportResult,
};
use crate::core::paths::LauncherPaths;
use crate::core::runner::{
    build_full_command_preview, ensure_optimized_options_txt, reoptimize_options_txt,
    spawn_minecraft, terminate_process, LaunchRequest, ProcessPriority,
};
use crate::core::skin_pack::sync_instance_skin_pack;
use crate::core::worldgen_configs::{
    ensure_worldgen_mod_configs, reoptimize_worldgen_mod_configs,
};
use crate::core::worlds::{scan_recent_worlds_blocking, WorldSummary};
use crate::error::{AppError, AppResult};

pub struct AppState {
    pub client: reqwest::Client,
    pub paths: LauncherPaths,
    pub hardware: HardwareInfo,
    pub config: Mutex<LauncherConfig>,
    pub running_processes: Arc<Mutex<HashMap<String, u32>>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct InstanceExitEvent {
    pub profile_id: String,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct InstanceSummary {
    pub recent_worlds: Vec<WorldSummary>,
    pub latest_screenshot_data_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct StorageBreakdown {
    pub assets_bytes: u64,
    pub libraries_bytes: u64,
    pub runtimes_bytes: u64,
    pub instances_bytes: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogCleanupResult {
    pub files_removed: usize,
    pub bytes_freed: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReoptimizeResult {
    pub updated_files: Vec<String>,
    pub backups_created: Vec<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct GlobalSettingsPayload {
    pub offline_username: String,
    pub process_priority: ProcessPriority,
    pub close_on_launch: bool,
    pub apply_skin_ingame: bool,
    pub accent_color: String,
    pub launch_behavior: String,
    pub auto_open_console_on_crash: bool,
    #[serde(default = "default_true")]
    pub auto_tune_mod_configs: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct LaunchProgressEvent {
    pub phase: String,
    pub completed: usize,
    pub total: usize,
    pub bytes_downloaded: u64,
    pub detail: String,
    pub fast_path_hits: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogLineEvent {
    pub line: String,
    pub is_stderr: bool,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct BootstrapState {
    pub hardware: HardwareInfo,
    pub config: LauncherConfig,
    pub data_root: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LaunchResult {
    pub pid: u32,
    pub fast_path_hits: usize,
    pub downloaded_files: usize,
    pub java_major: u32,
}

fn current_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

impl From<DownloadProgress> for LaunchProgressEvent {
    fn from(value: DownloadProgress) -> Self {
        Self {
            phase: value.phase,
            completed: value.completed_files,
            total: value.total_files,
            bytes_downloaded: value.bytes_downloaded,
            detail: value.current_file,
            fast_path_hits: value.fast_path_hits,
        }
    }
}

#[tauri::command]
pub async fn get_bootstrap_state(state: State<'_, AppState>) -> AppResult<BootstrapState> {
    let config = state.config.lock().await.clone();
    Ok(BootstrapState {
        hardware: state.hardware.clone(),
        config,
        data_root: state.paths.root().to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn list_minecraft_versions(
    state: State<'_, AppState>,
) -> AppResult<Vec<MinecraftVersionEntry>> {
    fetch_or_load_version_list(&state.client, &state.paths).await
}

fn validate_offline_username(raw: &str) -> AppResult<String> {
    let trimmed = raw.trim();
    if trimmed.len() < 3 || trimmed.len() > 16 {
        return Err(AppError::ConfigError(
            "El nick debe tener entre 3 y 16 caracteres".to_string(),
        ));
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        return Err(AppError::ConfigError(
            "El nick solo puede contener letras, números y guion bajo (_)".to_string(),
        ));
    }
    Ok(trimmed.to_string())
}

#[tauri::command]
pub async fn get_live_memory_telemetry(
    state: State<'_, AppState>,
) -> AppResult<LiveMemoryTelemetry> {
    let active_pids: Vec<u32> = {
        let guard = state.running_processes.lock().await;
        guard.values().copied().collect()
    };
    tokio::task::spawn_blocking(move || sample_live_memory_telemetry(&active_pids))
        .await
        .map_err(|err| AppError::ConfigError(format!("Telemetry task failed: {err}")))
}

#[tauri::command]
pub async fn save_global_settings(
    state: State<'_, AppState>,
    settings: GlobalSettingsPayload,
) -> AppResult<LauncherConfig> {
    let valid_username = validate_offline_username(&settings.offline_username)?;

    let mut guard = state.config.lock().await;
    guard.offline_username = valid_username;
    guard.process_priority = settings.process_priority;
    guard.launch_behavior = match settings.launch_behavior.as_str() {
        "hide_and_restore" | "close" => settings.launch_behavior,
        _ => "keep_open".to_string(),
    };
    guard.close_on_launch = guard.launch_behavior != "keep_open";
    guard.apply_skin_ingame = settings.apply_skin_ingame;
    guard.accent_color = settings.accent_color;
    guard.auto_open_console_on_crash = settings.auto_open_console_on_crash;
    guard.auto_tune_mod_configs = settings.auto_tune_mod_configs;
    save_config_atomic(&state.paths, &guard).await?;
    Ok(guard.clone())
}

#[tauri::command]
pub async fn create_or_update_profile(
    state: State<'_, AppState>,
    profile: Profile,
) -> AppResult<LauncherConfig> {
    validate_version_id(&profile.mc_version)?;

    let is_running = {
        let running = state.running_processes.lock().await;
        running.contains_key(&profile.id)
    };

    let mut guard = state.config.lock().await;
    if is_running {
        if let Some(existing) = guard.profiles.iter().find(|p| p.id == profile.id) {
            if existing.mc_version != profile.mc_version || existing.loader != profile.loader {
                return Err(AppError::ConfigError(
                    "No puedes cambiar la versión o loader de un perfil mientras Minecraft está en ejecución.".to_string(),
                ));
            }
        }
    }

    let is_new_profile = !guard.profiles.iter().any(|p| p.id == profile.id);
    let new_profile_id = profile.id.clone();

    upsert_profile(&state.paths, &mut guard, profile).await?;
    let next_config = guard.clone();
    drop(guard);

    if is_new_profile {
        let global_opts = load_global_options(&state.paths).await;
        if global_opts.auto_apply_on_new_instance && !global_opts.entries.is_empty() {
            let inst_dir = state.paths.instance_dir(&new_profile_id);
            let _ = ensure_optimized_options_txt(&inst_dir).await;
            let ts = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |d| d.as_secs());
            let _ = apply_global_options_to_instance_dir(&inst_dir, &global_opts, ts).await;
        }
    }

    Ok(next_config)
}

#[tauri::command]
pub async fn set_default_profile(
    state: State<'_, AppState>,
    profile_id: String,
) -> AppResult<LauncherConfig> {
    let mut guard = state.config.lock().await;
    let exists = guard.profiles.iter().any(|p| p.id == profile_id);
    if !exists {
        return Err(AppError::ConfigError(format!(
            "Profile '{profile_id}' not found"
        )));
    }
    for profile in &mut guard.profiles {
        profile.is_default = profile.id == profile_id;
    }
    save_config_atomic(&state.paths, &guard).await?;
    Ok(guard.clone())
}

#[tauri::command]
pub async fn remove_profile(
    state: State<'_, AppState>,
    profile_id: String,
    delete_files: Option<bool>,
) -> AppResult<LauncherConfig> {
    validate_profile_id(&profile_id)?;
    {
        let running = state.running_processes.lock().await;
        if running.contains_key(&profile_id) {
            return Err(AppError::ConfigError(
                "Detén la instancia antes de eliminar este perfil.".to_string(),
            ));
        }
    }

    let next_config = {
        let mut guard = state.config.lock().await;
        delete_profile(&mut guard, &profile_id)?;
        save_config_atomic(&state.paths, &guard).await?;
        guard.clone()
    };

    if delete_files.unwrap_or(false) {
        let instance_dir = state.paths.instance_dir(&profile_id);
        if tokio::fs::try_exists(&instance_dir).await.unwrap_or(false) {
            tokio::fs::remove_dir_all(&instance_dir).await?;
        }
    }

    Ok(next_config)
}

#[tauri::command]
pub async fn get_jvm_flags_preview(
    state: State<'_, AppState>,
    java_major: u32,
    ram_mb: u64,
    gc_preset: GcPreset,
) -> AppResult<JvmTuningOutput> {
    Ok(generate_jvm_flags(&JvmTuningInput {
        java_major,
        ram_mb,
        logical_cores: state.hardware.logical_cores,
        gc_preset,
    }))
}

#[tauri::command]
pub async fn list_profile_content(
    state: State<'_, AppState>,
    profile_id: String,
    kind: ContentKind,
) -> AppResult<Vec<ContentItem>> {
    list_instance_content(&state.paths, &profile_id, kind).await
}

#[tauri::command]
pub async fn toggle_profile_content(
    state: State<'_, AppState>,
    profile_id: String,
    kind: ContentKind,
    file_name: String,
    enable: bool,
) -> AppResult<ContentItem> {
    toggle_content_item(&state.paths, &profile_id, kind, &file_name, enable).await
}

#[tauri::command]
pub async fn delete_profile_content(
    state: State<'_, AppState>,
    profile_id: String,
    kind: ContentKind,
    file_name: String,
) -> AppResult<()> {
    delete_content_item(&state.paths, &profile_id, kind, &file_name).await
}

#[tauri::command]
pub async fn import_profile_content(
    state: State<'_, AppState>,
    profile_id: String,
    kind: ContentKind,
    source_path: String,
    auto_classify: Option<bool>,
) -> AppResult<ContentItem> {
    import_content_file_with_options(
        &state.paths,
        &profile_id,
        kind,
        &PathBuf::from(source_path),
        auto_classify.unwrap_or(false),
    )
    .await
}

#[tauri::command]
pub async fn import_profile_content_bytes(
    state: State<'_, AppState>,
    profile_id: String,
    kind: ContentKind,
    file_name: String,
    bytes: Vec<u8>,
    auto_classify: Option<bool>,
) -> AppResult<ContentItem> {
    import_content_bytes_with_options(
        &state.paths,
        &profile_id,
        kind,
        &file_name,
        bytes,
        auto_classify.unwrap_or(false),
    )
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn search_modrinth(
    state: State<'_, AppState>,
    profile_id: String,
    query: String,
    mc_version: String,
    loader: String,
    kind: ContentKind,
    offset: Option<u32>,
    sort: Option<String>,
) -> AppResult<Vec<ModrinthSearchResult>> {
    search_modrinth_catalog(
        &state.client,
        &state.paths,
        &profile_id,
        &query,
        &mc_version,
        &loader,
        kind,
        offset.unwrap_or(0),
        sort.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn get_dynamic_recommendations(
    state: State<'_, AppState>,
    profile_id: String,
    category: String,
    kind: ContentKind,
    offset: Option<u32>,
    sort: Option<String>,
) -> AppResult<Vec<ModrinthSearchResult>> {
    let profile = {
        let guard = state.config.lock().await;
        guard
            .profiles
            .iter()
            .find(|p| p.id == profile_id)
            .cloned()
            .ok_or_else(|| AppError::ConfigError(format!("Profile '{profile_id}' not found")))?
    };

    let loader_str = match profile.loader {
        ModLoaderKind::Vanilla => "vanilla",
        ModLoaderKind::Fabric => "fabric",
        ModLoaderKind::Forge => "forge",
        ModLoaderKind::NeoForge => "neoforge",
    };

    fetch_dynamic_recommendations(
        &state.client,
        &state.paths,
        &profile.id,
        &profile.mc_version,
        loader_str,
        &category,
        kind,
        offset.unwrap_or(0),
        sort.as_deref(),
    )
    .await
}

fn dir_size_recursive_blocking(path: &std::path::Path) -> u64 {
    let mut total = 0_u64;
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.is_file() {
            total = total.saturating_add(meta.len());
        } else if meta.is_dir() {
            total = total.saturating_add(dir_size_recursive_blocking(&entry.path()));
        }
    }
    total
}

#[tauri::command]
pub async fn list_installed_javas(
    state: State<'_, AppState>,
) -> AppResult<Vec<InstalledJavaRuntime>> {
    scan_installed_javas(&state.paths).await
}

#[tauri::command]
pub async fn get_storage_breakdown(state: State<'_, AppState>) -> AppResult<StorageBreakdown> {
    let assets_dir = state.paths.shared_assets_dir();
    let libraries_dir = state.paths.shared_libraries_dir();
    let runtimes_dir = state.paths.shared_runtimes_dir();
    let instances_dir = state.paths.instances_dir();

    let breakdown = tokio::task::spawn_blocking(move || {
        let assets_bytes = dir_size_recursive_blocking(&assets_dir);
        let libraries_bytes = dir_size_recursive_blocking(&libraries_dir);
        let runtimes_bytes = dir_size_recursive_blocking(&runtimes_dir);
        let instances_bytes = dir_size_recursive_blocking(&instances_dir);
        let total_bytes = assets_bytes
            .saturating_add(libraries_bytes)
            .saturating_add(runtimes_bytes)
            .saturating_add(instances_bytes);
        StorageBreakdown {
            assets_bytes,
            libraries_bytes,
            runtimes_bytes,
            instances_bytes,
            total_bytes,
        }
    })
    .await
    .map_err(|err| AppError::ConfigError(format!("Storage scan task failed: {err}")))?;

    Ok(breakdown)
}

#[tauri::command]
pub async fn revalidate_cache_index(state: State<'_, AppState>) -> AppResult<()> {
    let idx_path = state.paths.integrity_index_path();
    if tokio::fs::try_exists(&idx_path).await? {
        tokio::fs::remove_file(&idx_path).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn clean_old_logs(state: State<'_, AppState>) -> AppResult<LogCleanupResult> {
    let instances_dir = state.paths.instances_dir();
    if !tokio::fs::try_exists(&instances_dir).await? {
        return Ok(LogCleanupResult {
            files_removed: 0,
            bytes_freed: 0,
        });
    }

    let mut files_removed = 0_usize;
    let mut bytes_freed = 0_u64;
    let mut inst_entries = tokio::fs::read_dir(&instances_dir).await?;
    while let Some(inst) = inst_entries.next_entry().await? {
        let logs_dir = inst.path().join("logs");
        if !tokio::fs::try_exists(&logs_dir).await? {
            continue;
        }
        let mut log_entries = tokio::fs::read_dir(&logs_dir).await?;
        while let Some(log_file) = log_entries.next_entry().await? {
            let name = log_file.file_name().to_string_lossy().into_owned();
            if name.ends_with(".log.gz") {
                let size = log_file.metadata().await.map_or(0, |m| m.len());
                if tokio::fs::remove_file(log_file.path()).await.is_ok() {
                    files_removed += 1;
                    bytes_freed = bytes_freed.saturating_add(size);
                }
            }
        }
    }

    Ok(LogCleanupResult {
        files_removed,
        bytes_freed,
    })
}

#[tauri::command]
pub async fn reoptimize_instance_configs(
    state: State<'_, AppState>,
    profile_id: String,
) -> AppResult<ReoptimizeResult> {
    validate_profile_id(&profile_id)?;
    {
        let running = state.running_processes.lock().await;
        if running.contains_key(&profile_id) {
            return Err(AppError::ConfigError(
                "Detén Minecraft antes de aplicar ajustes óptimos a esta instancia.".to_string(),
            ));
        }
    }

    let profile = {
        let guard = state.config.lock().await;
        guard
            .profiles
            .iter()
            .find(|p| p.id == profile_id)
            .cloned()
            .ok_or_else(|| AppError::ConfigError(format!("Profile '{profile_id}' not found")))?
    };

    state.paths.ensure_instance_dirs(&profile.id).await?;
    let timestamp_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());

    let mut updated_files = Vec::new();
    let mut backups_created = Vec::new();

    let instance_dir = state.paths.instance_dir(&profile.id);
    if let Some(opt_bak) = reoptimize_options_txt(&instance_dir, timestamp_secs).await? {
        backups_created.push(opt_bak);
    }
    updated_files.push("options.txt".to_string());

    let (mod_updated, mod_backups) = reoptimize_worldgen_mod_configs(
        &state.paths,
        &profile.id,
        &state.hardware,
        profile.loader,
        timestamp_secs,
    )
    .await?;
    updated_files.extend(mod_updated);
    backups_created.extend(mod_backups);

    Ok(ReoptimizeResult {
        updated_files,
        backups_created,
    })
}

#[tauri::command]
pub async fn get_launch_command_preview(
    state: State<'_, AppState>,
    profile_id: String,
) -> AppResult<String> {
    let (profile, config_snapshot) = {
        let guard = state.config.lock().await;
        let profile = guard
            .profiles
            .iter()
            .find(|p| p.id == profile_id)
            .cloned()
            .ok_or_else(|| AppError::ConfigError(format!("Profile '{profile_id}' not found")))?;
        (profile, guard.clone())
    };

    let required_major = infer_java_major_for_mc_version(&profile.mc_version);
    let custom_java = profile
        .custom_java_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);
    let (javaw_path, effective_java_major) = if let Some(custom_path) = custom_java {
        let detected = detect_java_major(&custom_path)
            .await
            .unwrap_or(required_major);
        (custom_path, detected)
    } else {
        (
            state
                .paths
                .runtime_dir(required_major)
                .join("bin")
                .join("javaw.exe"),
            required_major,
        )
    };

    let custom_jvm_args: Vec<String> = profile
        .custom_jvm_args
        .as_deref()
        .map(|s| s.split_whitespace().map(str::to_string).collect())
        .unwrap_or_default();

    let main_class = match profile.loader {
        ModLoaderKind::Fabric => "net.fabricmc.loader.impl.launch.knot.KnotClient".to_string(),
        ModLoaderKind::Forge => {
            if effective_java_major <= 8 {
                "cpw.mods.modlauncher.Launcher".to_string()
            } else {
                "cpw.mods.bootstraplauncher.BootstrapLauncher".to_string()
            }
        }
        ModLoaderKind::NeoForge => "cpw.mods.bootstraplauncher.BootstrapLauncher".to_string(),
        ModLoaderKind::Vanilla => "net.minecraft.client.main.Main".to_string(),
    };

    let req = LaunchRequest {
        profile_id: profile.id,
        mc_version: profile.mc_version,
        version_type: "release".to_string(),
        username: config_snapshot.offline_username,
        ram_mb: profile.ram_mb,
        gc_preset: profile.gc_preset,
        process_priority: config_snapshot.process_priority,
        server_address: profile.server_address,
        world_folder: None,
        javaw_path,
        main_class,
        java_major: effective_java_major,
        classpath_entries: vec![PathBuf::from("<shared/libraries/*>;<client.jar>")],
        native_archives: Vec::new(),
        asset_index_id: "<asset_index>".to_string(),
        extra_jvm_args: custom_jvm_args,
        extra_game_args: Vec::new(),
        window_width: profile.window_width,
        window_height: profile.window_height,
        fullscreen: profile.fullscreen,
        detached: false,
    };

    Ok(build_full_command_preview(
        &req,
        &state.paths,
        state.hardware.logical_cores,
    ))
}

fn encode_png_data_url(bytes: &[u8]) -> String {
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    format!("data:image/png;base64,{encoded}")
}

fn validate_png_signature(bytes: &[u8]) -> AppResult<()> {
    const PNG_MAGIC: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
    if bytes.len() < 8 || &bytes[..8] != PNG_MAGIC {
        return Err(AppError::ContentError(
            "El archivo seleccionado no es un PNG válido".to_string(),
        ));
    }
    Ok(())
}

fn validate_skin_png(bytes: &[u8]) -> AppResult<(u32, u32)> {
    validate_png_signature(bytes)?;
    if bytes.len() < 24 || &bytes[12..16] != b"IHDR" {
        return Err(AppError::ContentError(
            "El archivo PNG no contiene una cabecera IHDR válida".to_string(),
        ));
    }

    let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);

    let valid_dimensions = (64..=1024).contains(&width)
        && width.is_multiple_of(64)
        && (height == width || height == width / 2);
    if !valid_dimensions {
        return Err(AppError::ContentError(format!(
            "Dimensiones de skin inválidas ({width}×{height}). Usa 64×64, 64×32 o múltiplos HD válidos (hasta 1024×1024)."
        )));
    }
    Ok((width, height))
}

#[tauri::command]
pub async fn upload_custom_skin_bytes(
    state: State<'_, AppState>,
    bytes: Vec<u8>,
) -> AppResult<String> {
    validate_skin_png(&bytes)?;

    state.paths.ensure_base_dirs().await?;
    let dest = state.paths.custom_skin_path();
    tokio::fs::write(&dest, &bytes).await?;

    {
        let mut guard = state.config.lock().await;
        guard.skin_path = Some(dest.to_string_lossy().into_owned());
        save_config_atomic(&state.paths, &guard).await?;
    }

    Ok(encode_png_data_url(&bytes))
}

#[tauri::command]
pub async fn get_player_skin_data(state: State<'_, AppState>) -> AppResult<Option<String>> {
    let skin_path_opt = {
        let guard = state.config.lock().await;
        guard.skin_path.clone()
    };

    let candidate = skin_path_opt
        .map(PathBuf::from)
        .unwrap_or_else(|| state.paths.custom_skin_path());

    if !tokio::fs::try_exists(&candidate).await? {
        return Ok(None);
    }

    let bytes = tokio::fs::read(&candidate).await?;
    if validate_png_signature(&bytes).is_err() {
        return Ok(None);
    }
    Ok(Some(encode_png_data_url(&bytes)))
}

#[tauri::command]
pub async fn set_skin_model(
    state: State<'_, AppState>,
    model: String,
) -> AppResult<LauncherConfig> {
    let normalized = match model.as_str() {
        "slim" => "slim".to_string(),
        _ => "classic".to_string(),
    };
    let mut guard = state.config.lock().await;
    guard.skin_model = normalized;
    save_config_atomic(&state.paths, &guard).await?;
    Ok(guard.clone())
}

#[tauri::command]
pub async fn get_instance_summary(
    state: State<'_, AppState>,
    profile_id: String,
) -> AppResult<InstanceSummary> {
    validate_profile_id(&profile_id)?;
    state.paths.ensure_instance_dirs(&profile_id).await?;

    let saves_dir = state.paths.instance_saves_dir(&profile_id);
    let worlds = tokio::task::spawn_blocking(move || scan_recent_worlds_blocking(&saves_dir))
        .await
        .map_err(|err| AppError::ConfigError(format!("World scan task failed: {err}")))?;

    let screenshots_dir = state.paths.instance_screenshots_dir(&profile_id);
    let mut latest_shot: Option<(u64, PathBuf)> = None;
    if tokio::fs::try_exists(&screenshots_dir).await? {
        let mut entries = tokio::fs::read_dir(&screenshots_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            let is_png = path
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e.eq_ignore_ascii_case("png"));
            if !is_png {
                continue;
            }
            let meta = entry.metadata().await?;
            if !meta.is_file() || meta.len() > 8 * 1024 * 1024 {
                continue;
            }
            let modified_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_millis() as u64);
            if latest_shot
                .as_ref()
                .is_none_or(|(prev_ms, _)| modified_ms > *prev_ms)
            {
                latest_shot = Some((modified_ms, path));
            }
        }
    }

    let latest_screenshot_data_url = if let Some((_, shot_path)) = latest_shot {
        tokio::fs::read(&shot_path)
            .await
            .ok()
            .filter(|b| validate_png_signature(b).is_ok())
            .map(|b| encode_png_data_url(&b))
    } else {
        None
    };

    Ok(InstanceSummary {
        recent_worlds: worlds,
        latest_screenshot_data_url,
    })
}

#[tauri::command]
pub async fn open_instance_saves_folder(
    state: State<'_, AppState>,
    profile_id: String,
) -> AppResult<()> {
    validate_profile_id(&profile_id)?;
    state.paths.ensure_instance_dirs(&profile_id).await?;
    let dir = state.paths.instance_saves_dir(&profile_id);
    #[cfg(windows)]
    {
        tokio::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|err| AppError::ProcessLaunch(format!("Failed to open Explorer: {err}")))?;
    }
    #[cfg(not(windows))]
    {
        let _ = dir;
    }
    Ok(())
}

#[tauri::command]
pub async fn open_data_root_folder(state: State<'_, AppState>) -> AppResult<()> {
    state.paths.ensure_base_dirs().await?;
    let dir = state.paths.root().to_path_buf();
    #[cfg(windows)]
    {
        tokio::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|err| AppError::ProcessLaunch(format!("Failed to open Explorer: {err}")))?;
    }
    #[cfg(not(windows))]
    {
        let _ = dir;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_profile_optimization_stack(
    state: State<'_, AppState>,
    profile_id: String,
) -> AppResult<OptimizationStackInfo> {
    let profile = {
        let guard = state.config.lock().await;
        guard
            .profiles
            .iter()
            .find(|p| p.id == profile_id)
            .cloned()
            .ok_or_else(|| AppError::ConfigError(format!("Profile '{profile_id}' not found")))?
    };

    let loader_str = match profile.loader {
        ModLoaderKind::Vanilla => "vanilla",
        ModLoaderKind::Fabric => "fabric",
        ModLoaderKind::Forge => "forge",
        ModLoaderKind::NeoForge => "neoforge",
    };

    get_optimization_stack_info(&state.paths, &profile.id, loader_str, &profile.mc_version).await
}

#[tauri::command]
pub async fn inject_performance_preset(
    state: State<'_, AppState>,
    profile_id: String,
    preset: PerformancePreset,
    on_progress: Channel<LaunchProgressEvent>,
) -> AppResult<Vec<String>> {
    let (profile, auto_tune) = {
        let guard = state.config.lock().await;
        let profile = guard
            .profiles
            .iter()
            .find(|p| p.id == profile_id)
            .cloned()
            .ok_or_else(|| AppError::ConfigError(format!("Profile '{profile_id}' not found")))?;
        (profile, guard.auto_tune_mod_configs)
    };

    let loader_str = match profile.loader {
        ModLoaderKind::Vanilla => "vanilla",
        ModLoaderKind::Fabric => "fabric",
        ModLoaderKind::Forge => "forge",
        ModLoaderKind::NeoForge => "neoforge",
    };

    let installed = inject_modrinth_preset(
        &state.client,
        &state.paths,
        &profile.id,
        &profile.mc_version,
        loader_str,
        preset,
        move |progress| {
            let _ = on_progress.send(progress.into());
        },
    )
    .await?;

    if auto_tune
        && matches!(
            profile.loader,
            ModLoaderKind::Fabric | ModLoaderKind::Forge | ModLoaderKind::NeoForge
        )
    {
        let _ = ensure_worldgen_mod_configs(
            &state.paths,
            &profile.id,
            &state.hardware,
            profile.loader,
        )
        .await;
    }

    Ok(installed)
}

#[tauri::command]
pub async fn install_modrinth_item(
    state: State<'_, AppState>,
    profile_id: String,
    slug: String,
    kind: ContentKind,
    on_progress: Channel<LaunchProgressEvent>,
) -> AppResult<Vec<String>> {
    let (profile, auto_tune) = {
        let guard = state.config.lock().await;
        let profile = guard
            .profiles
            .iter()
            .find(|p| p.id == profile_id)
            .cloned()
            .ok_or_else(|| AppError::ConfigError(format!("Profile '{profile_id}' not found")))?;
        (profile, guard.auto_tune_mod_configs)
    };

    let loader_str = match profile.loader {
        ModLoaderKind::Vanilla => "vanilla",
        ModLoaderKind::Fabric => "fabric",
        ModLoaderKind::Forge => "forge",
        ModLoaderKind::NeoForge => "neoforge",
    };

    let installed = install_single_modrinth_item(
        &state.client,
        &state.paths,
        &profile.id,
        &profile.mc_version,
        loader_str,
        &slug,
        kind,
        move |progress| {
            let _ = on_progress.send(progress.into());
        },
    )
    .await?;

    if auto_tune
        && kind == ContentKind::Mod
        && matches!(
            profile.loader,
            ModLoaderKind::Fabric | ModLoaderKind::Forge | ModLoaderKind::NeoForge
        )
    {
        let _ = ensure_worldgen_mod_configs(
            &state.paths,
            &profile.id,
            &state.hardware,
            profile.loader,
        )
        .await;
    }

    Ok(installed)
}

#[must_use]
fn infer_java_major_for_mc_version(mc_version: &str) -> u32 {
    let clean = mc_version.split('-').next().unwrap_or(mc_version);
    let mut parts = clean.split('.');
    let major = parts.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(1);
    let minor = parts.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(21);
    let patch = parts.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);

    if major > 1 || (major == 1 && (minor > 20 || (minor == 20 && patch >= 5))) {
        21
    } else if major == 1 && minor >= 17 {
        17
    } else {
        8
    }
}

#[tauri::command]
pub async fn check_profile_java(
    state: State<'_, AppState>,
    mc_version: String,
    custom_java_path: Option<String>,
) -> AppResult<JavaRuntimeStatus> {
    if let Some(custom) = custom_java_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let custom_path = PathBuf::from(custom);
        if let Ok(detected_major) = detect_java_major(&custom_path).await {
            return Ok(JavaRuntimeStatus::Installed {
                major: detected_major,
                javaw_path: custom.to_string(),
            });
        }
    }

    let required_major = if validate_version_id(&mc_version).is_ok() {
        let cached_manifest = state.paths.version_json_path(&mc_version);
        if tokio::fs::try_exists(&cached_manifest).await? {
            tokio::fs::read_to_string(&cached_manifest)
                .await
                .ok()
                .and_then(|raw| {
                    serde_json::from_str::<crate::core::manifest::VersionManifest>(&raw).ok()
                })
                .and_then(|m| m.java_version.map(|j| j.major_version))
                .unwrap_or_else(|| infer_java_major_for_mc_version(&mc_version))
        } else {
            infer_java_major_for_mc_version(&mc_version)
        }
    } else {
        infer_java_major_for_mc_version(&mc_version)
    };
    check_java_runtime(required_major, &state.paths).await
}

#[tauri::command]
pub async fn install_adoptium_java(
    state: State<'_, AppState>,
    major: u32,
    on_progress: Channel<LaunchProgressEvent>,
) -> AppResult<JavaRuntimeStatus> {
    let javaw_path = install_java_runtime(
        &state.client,
        major,
        &state.paths,
        move |done, total, phase, detail| {
            let (completed, total_units) = match phase {
                "Extrayendo runtime..." | "Preparando Java..." => (95, 100),
                "Runtime listo" | "Java listo" => (100, 100),
                _ => match total {
                    Some(t) if t > 0 => {
                        let pct = ((done.saturating_mul(90)) / t).min(90) as usize;
                        (pct, 100)
                    }
                    _ => (0, 0),
                },
            };

            let _ = on_progress.send(LaunchProgressEvent {
                phase: phase.to_string(),
                completed,
                total: total_units,
                bytes_downloaded: done,
                detail: detail.to_string(),
                fast_path_hits: total.map_or(0, |t| (t / 1024) as usize),
            });
        },
    )
    .await?;

    Ok(JavaRuntimeStatus::Installed {
        major,
        javaw_path: javaw_path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn stop_instance(state: State<'_, AppState>, profile_id: String) -> AppResult<()> {
    let pid_opt = {
        let mut guard = state.running_processes.lock().await;
        guard.remove(&profile_id)
    };
    if let Some(pid) = pid_opt {
        terminate_process(pid).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn open_instance_folder(
    state: State<'_, AppState>,
    profile_id: String,
) -> AppResult<()> {
    validate_profile_id(&profile_id)?;
    state.paths.ensure_instance_dirs(&profile_id).await?;
    let dir = state.paths.instance_dir(&profile_id);

    #[cfg(windows)]
    {
        tokio::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|err| AppError::ProcessLaunch(format!("Failed to open Explorer: {err}")))?;
    }

    #[cfg(not(windows))]
    {
        let _ = dir;
    }

    Ok(())
}

#[tauri::command]
pub async fn launch_profile(
    window: Window,
    state: State<'_, AppState>,
    profile_id: String,
    world_folder: Option<String>,
    on_progress: Channel<LaunchProgressEvent>,
    on_log: Channel<LogLineEvent>,
    on_exit: Channel<InstanceExitEvent>,
) -> AppResult<LaunchResult> {
    let sanitized_world_folder = match world_folder
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(folder) => {
            if folder.contains("..") || folder.contains('/') || folder.contains('\\') {
                return Err(AppError::ConfigError(format!(
                    "Invalid world folder name: '{folder}'"
                )));
            }
            Some(folder.to_string())
        }
        None => None,
    };
    {
        let running = state.running_processes.lock().await;
        if running.contains_key(&profile_id) {
            return Err(AppError::ProcessLaunch(format!(
                "Profile '{profile_id}' is already running"
            )));
        }
    }

    let (profile, config_snapshot) = {
        let guard = state.config.lock().await;
        let profile = guard
            .profiles
            .iter()
            .find(|p| p.id == profile_id)
            .cloned()
            .ok_or_else(|| AppError::ConfigError(format!("Profile '{profile_id}' not found")))?;
        (profile, guard.clone())
    };

    let _ = on_progress.send(LaunchProgressEvent {
        phase: "Preparando Minecraft...".to_string(),
        completed: 0,
        total: 4,
        bytes_downloaded: 0,
        detail: format!("Preparando Minecraft {}...", profile.mc_version),
        fast_path_hits: 0,
    });

    let manifest =
        fetch_or_load_version_manifest(&state.client, &profile.mc_version, &state.paths).await?;
    let required_major = manifest
        .java_version
        .as_ref()
        .map_or(21, |j| j.major_version);
    let version_type = manifest
        .version_type
        .clone()
        .unwrap_or_else(|| "release".to_string());

    let (javaw_path, effective_java_major) = if let Some(custom) = profile
        .custom_java_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let custom_path = PathBuf::from(custom);
        let detected = match detect_java_major(&custom_path).await {
            Ok(major) => major,
            Err(err) => {
                let _ = on_log.send(LogLineEvent {
                    line: format!(
                        "[Java Probe] Warning: {err}; falling back to manifest Java {required_major}"
                    ),
                    is_stderr: true,
                    timestamp_ms: current_epoch_ms(),
                });
                required_major
            }
        };
        (custom_path, detected)
    } else {
        match check_java_runtime(required_major, &state.paths).await? {
            JavaRuntimeStatus::Installed { javaw_path, .. } => {
                (PathBuf::from(javaw_path), required_major)
            }
            JavaRuntimeStatus::Missing { major, .. } => {
                return Err(AppError::JavaNotFound {
                    required_major: major,
                });
            }
        }
    };

    // Seed optimized options.txt ONLY if missing, BEFORE skin pack modifies resourcePacks
    let _ = ensure_optimized_options_txt(&state.paths.instance_dir(&profile.id)).await;

    // Seed hardware-tuned worldgen mod configs (Fabric: Sodium/C2ME/DH; NeoForge: Sodium/DH; Forge: DH only)
    if config_snapshot.auto_tune_mod_configs
        && matches!(
            profile.loader,
            ModLoaderKind::Fabric | ModLoaderKind::Forge | ModLoaderKind::NeoForge
        )
    {
        match ensure_worldgen_mod_configs(
            &state.paths,
            &profile.id,
            &state.hardware,
            profile.loader,
        )
        .await
        {
            Ok(created) => {
                for item in created {
                    let _ = on_log.send(LogLineEvent {
                        line: format!("[WorldGen Tuning] Generado {item}"),
                        is_stderr: false,
                        timestamp_ms: current_epoch_ms(),
                    });
                }
            }
            Err(err) => {
                let _ = on_log.send(LogLineEvent {
                    line: format!("[WorldGen Tuning] Warning: {err}"),
                    is_stderr: true,
                    timestamp_ms: current_epoch_ms(),
                });
            }
        }
    }

    // Sync offline custom skin micro-resource pack before launching
    if let Err(err) = sync_instance_skin_pack(
        &state.paths,
        &profile.id,
        config_snapshot.apply_skin_ingame,
        config_snapshot.skin_path.as_deref(),
    )
    .await
    {
        let _ = on_log.send(LogLineEvent {
            line: format!("[Skin Sync] Warning: no se pudo sincronizar la skin in-game: {err}"),
            is_stderr: true,
            timestamp_ms: current_epoch_ms(),
        });
    }

    let asset_index = fetch_or_load_asset_index(&state.client, &manifest, &state.paths).await?;
    let asset_index_id = manifest
        .asset_index
        .as_ref()
        .map(|a| a.id.clone())
        .or_else(|| manifest.assets.clone())
        .unwrap_or_else(|| "legacy".to_string());

    let mut plan = build_download_plan(&manifest, &asset_index, &state.paths)?;
    let mut main_class = manifest.main_class.clone();
    let mut extra_jvm_args = Vec::new();
    if let Some(logging_arg) = plan.logging_jvm_arg.take() {
        extra_jvm_args.push(logging_arg);
    }
    let mut extra_game_args = extract_game_arguments(&manifest);

    let libraries_dir = state.paths.shared_libraries_dir();

    match profile.loader {
        ModLoaderKind::Vanilla => {}
        ModLoaderKind::Fabric => {
            let _ = on_progress.send(LaunchProgressEvent {
                phase: "Preparando Fabric...".to_string(),
                completed: 1,
                total: 4,
                bytes_downloaded: 0,
                detail: format!("Configurando Fabric para Minecraft {}...", profile.mc_version),
                fast_path_hits: 0,
            });
            let overlay = resolve_fabric_overlay(
                &state.client,
                &profile.mc_version,
                profile.loader_version.as_deref(),
                &state.paths,
            )
            .await?;
            let (loader_main, loader_jvm, mut loader_game) =
                merge_overlay_into_plan_dedup(&mut plan, overlay, &libraries_dir);
            main_class = loader_main;
            extra_jvm_args.extend(loader_jvm);
            extra_game_args.append(&mut loader_game);
        }
        ModLoaderKind::Forge => {
            // Ensure vanilla client.jar is present on disk BEFORE running Forge installer processors ({MINECRAFT_JAR})
            let client_jar_path = state.paths.version_jar_path(&profile.mc_version);
            if !tokio::fs::try_exists(&client_jar_path).await.unwrap_or(false) {
                if let Some(client_artifact) = plan
                    .artifacts
                    .iter()
                    .find(|a| a.destination == client_jar_path)
                    .cloned()
                {
                    let pre_progress = on_progress.clone();
                    verify_and_download_all(
                        &state.client,
                        vec![client_artifact],
                        &state.paths.integrity_index_path(),
                        move |ev| {
                            let _ = pre_progress.send(ev.into());
                        },
                    )
                    .await?;
                }
            }

            let forge_progress = on_progress.clone();
            let overlay = resolve_forge_overlay(
                &state.client,
                &profile.mc_version,
                profile.loader_version.as_deref(),
                &javaw_path,
                &state.paths,
                move |phase, completed, total, detail| {
                    let _ = forge_progress.send(LaunchProgressEvent {
                        phase: phase.to_string(),
                        completed,
                        total,
                        bytes_downloaded: 0,
                        detail: detail.to_string(),
                        fast_path_hits: 0,
                    });
                },
            )
            .await?;
            let (loader_main, loader_jvm, mut loader_game) =
                merge_overlay_into_plan_dedup(&mut plan, overlay, &libraries_dir);
            main_class = loader_main;
            extra_jvm_args.extend(loader_jvm);
            extra_game_args.append(&mut loader_game);
        }
        ModLoaderKind::NeoForge => {
            // Ensure vanilla client.jar is present on disk BEFORE running NeoForge installer processors ({MINECRAFT_JAR})
            let client_jar_path = state.paths.version_jar_path(&profile.mc_version);
            if !tokio::fs::try_exists(&client_jar_path).await.unwrap_or(false) {
                if let Some(client_artifact) = plan
                    .artifacts
                    .iter()
                    .find(|a| a.destination == client_jar_path)
                    .cloned()
                {
                    let pre_progress = on_progress.clone();
                    verify_and_download_all(
                        &state.client,
                        vec![client_artifact],
                        &state.paths.integrity_index_path(),
                        move |ev| {
                            let _ = pre_progress.send(ev.into());
                        },
                    )
                    .await?;
                }
            }

            let nf_progress = on_progress.clone();
            let overlay = resolve_neoforge_overlay(
                &state.client,
                &profile.mc_version,
                profile.loader_version.as_deref(),
                &javaw_path,
                &state.paths,
                move |phase, completed, total, detail| {
                    let _ = nf_progress.send(LaunchProgressEvent {
                        phase: phase.to_string(),
                        completed,
                        total,
                        bytes_downloaded: 0,
                        detail: detail.to_string(),
                        fast_path_hits: 0,
                    });
                },
            )
            .await?;
            let (loader_main, loader_jvm, mut loader_game) =
                merge_overlay_into_plan_dedup(&mut plan, overlay, &libraries_dir);
            main_class = loader_main;
            extra_jvm_args.extend(loader_jvm);
            extra_game_args.append(&mut loader_game);
        }
    }

    let progress_channel = on_progress.clone();
    let summary = verify_and_download_all(
        &state.client,
        plan.artifacts,
        &state.paths.integrity_index_path(),
        move |ev| {
            let _ = progress_channel.send(ev.into());
        },
    )
    .await?;

    let _ = on_progress.send(LaunchProgressEvent {
        phase: "Abriendo el juego...".to_string(),
        completed: summary.total_artifacts,
        total: summary.total_artifacts.max(1),
        bytes_downloaded: 0,
        detail: format!("Iniciando {}...", profile.name),
        fast_path_hits: summary.fast_path_hits,
    });

    if let Some(custom_args) = profile.custom_jvm_args.as_deref() {
        extra_jvm_args.extend(custom_args.split_whitespace().map(str::to_string));
    }

    let log_channel = on_log.clone();
    let running_map = Arc::clone(&state.running_processes);
    let profile_id_for_exit = profile.id.clone();
    let window_for_exit = window.clone();
    let effective_behavior = if config_snapshot.launch_behavior == "keep_open"
        && config_snapshot.close_on_launch
    {
        "hide_and_restore".to_string()
    } else {
        config_snapshot.launch_behavior.clone()
    };
    let should_restore_window = effective_behavior == "hide_and_restore";
    let launch_detached = effective_behavior == "close";
    let exit_channel = on_exit.clone();

    let pid = spawn_minecraft(
        LaunchRequest {
            profile_id: profile.id.clone(),
            mc_version: profile.mc_version,
            version_type,
            username: config_snapshot.offline_username,
            ram_mb: profile.ram_mb,
            gc_preset: profile.gc_preset,
            process_priority: config_snapshot.process_priority,
            server_address: profile.server_address,
            world_folder: sanitized_world_folder,
            javaw_path,
            main_class,
            java_major: effective_java_major,
            classpath_entries: plan.classpath_entries,
            native_archives: plan.native_archives,
            asset_index_id,
            extra_jvm_args,
            extra_game_args,
            window_width: profile.window_width,
            window_height: profile.window_height,
            fullscreen: profile.fullscreen,
            detached: launch_detached,
        },
        &state.paths,
        state.hardware.logical_cores,
        move |line, is_stderr| {
            let _ = log_channel.send(LogLineEvent {
                line,
                is_stderr,
                timestamp_ms: current_epoch_ms(),
            });
        },
        move |exit_code| {
            let running_ref = Arc::clone(&running_map);
            let pid_key = profile_id_for_exit.clone();
            tokio::spawn(async move {
                let mut guard = running_ref.lock().await;
                guard.remove(&pid_key);
            });

            if should_restore_window {
                let _ = window_for_exit.show();
                let _ = window_for_exit.set_focus();
            }

            let _ = exit_channel.send(InstanceExitEvent {
                profile_id: profile_id_for_exit,
                exit_code,
            });
        },
    )
    .await?;

    {
        let mut guard = state.running_processes.lock().await;
        guard.insert(profile.id, pid);
    }

    if effective_behavior == "hide_and_restore" {
        let _ = window.hide();
    } else if effective_behavior == "close" {
        let _ = window.close();
    }

    Ok(LaunchResult {
        pid,
        fast_path_hits: summary.fast_path_hits,
        downloaded_files: summary.downloaded_files,
        java_major: effective_java_major,
    })
}

#[tauri::command]
pub async fn import_mrpack_bytes(
    state: State<'_, AppState>,
    bytes: Vec<u8>,
    on_progress: Channel<LaunchProgressEvent>,
) -> AppResult<MrpackImportResult> {
    state.paths.ensure_base_dirs().await?;
    let temp_path = state.paths.shared_cache_dir().join(format!(
        "import-{}.mrpack",
        uuid::Uuid::new_v4().simple()
    ));
    tokio::fs::write(&temp_path, &bytes).await?;

    let temp_for_read = temp_path.clone();
    let index_res =
        tokio::task::spawn_blocking(move || read_mrpack_index_blocking(&temp_for_read))
            .await
            .map_err(|err| AppError::ContentError(format!("Error leyendo .mrpack: {err}")));

    let index = match index_res {
        Ok(Ok(idx)) => idx,
        Ok(Err(err)) => {
            let _ = tokio::fs::remove_file(&temp_path).await;
            return Err(err);
        }
        Err(err) => {
            let _ = tokio::fs::remove_file(&temp_path).await;
            return Err(err);
        }
    };

    let (mc_version, loader, loader_version) =
        match detect_loader_from_dependencies(&index.dependencies) {
            Ok(v) => v,
            Err(err) => {
                let _ = tokio::fs::remove_file(&temp_path).await;
                return Err(err);
            }
        };

    if let Err(err) = validate_version_id(&mc_version) {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(err);
    }

    let profile_name = if index.name.trim().is_empty() {
        format!("Modpack {mc_version}")
    } else {
        index.name.trim().to_string()
    };
    let profile_id = slugify_profile_name(&profile_name);
    let ram_mb = if loader == ModLoaderKind::Vanilla {
        state.hardware.recommended_vanilla_mb
    } else {
        state.hardware.recommended_modded_mb
    };

    let profile = Profile {
        id: profile_id.clone(),
        name: profile_name,
        mc_version,
        loader,
        loader_version,
        ram_mb,
        gc_preset: GcPreset::GenerationalZgc,
        server_address: None,
        is_default: false,
        window_width: None,
        window_height: None,
        fullscreen: false,
        custom_jvm_args: None,
        custom_java_path: None,
    };

    state.paths.ensure_instance_dirs(&profile.id).await?;
    let inst_dir = state.paths.instance_dir(&profile.id);

    let progress_cb = on_progress.clone();
    let pop_res = populate_instance_from_mrpack(
        &state.client,
        &temp_path,
        &index,
        &inst_dir,
        move |ev| {
            let _ = progress_cb.send(ev.into());
        },
    )
    .await;
    let _ = tokio::fs::remove_file(&temp_path).await;

    let (downloaded_files, extracted_overrides, skipped_server_only) = match pop_res {
        Ok(counts) => counts,
        Err(err) => {
            let _ = tokio::fs::remove_dir_all(&inst_dir).await;
            return Err(err);
        }
    };

    // Seed optimized options.txt and apply global portable game options if enabled
    let _ = ensure_optimized_options_txt(&inst_dir).await;
    let global_opts = load_global_options(&state.paths).await;
    if global_opts.auto_apply_on_new_instance && !global_opts.entries.is_empty() {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_secs());
        let _ = apply_global_options_to_instance_dir(&inst_dir, &global_opts, ts).await;
    }

    {
        let mut guard = state.config.lock().await;
        upsert_profile(&state.paths, &mut guard, profile.clone()).await?;
    }

    Ok(MrpackImportResult {
        profile,
        downloaded_files,
        extracted_overrides,
        skipped_server_only,
    })
}

#[tauri::command]
pub async fn export_profile_mrpack(
    state: State<'_, AppState>,
    profile_id: String,
    include_config: bool,
) -> AppResult<MrpackExportResult> {
    validate_profile_id(&profile_id)?;
    let profile = {
        let guard = state.config.lock().await;
        guard
            .profiles
            .iter()
            .find(|p| p.id == profile_id)
            .cloned()
            .ok_or_else(|| AppError::ConfigError(format!("Profile '{profile_id}' not found")))?
    };

    export_instance_to_mrpack(&state.client, &state.paths, &profile, include_config, None).await
}

#[tauri::command]
pub async fn get_global_game_options(
    state: State<'_, AppState>,
) -> AppResult<GlobalGameOptionsResponse> {
    let opts = load_global_options(&state.paths).await;
    Ok(opts.into())
}

#[tauri::command]
pub async fn save_global_game_options(
    state: State<'_, AppState>,
    payload: SaveGlobalGameOptionsPayload,
) -> AppResult<GlobalGameOptionsResponse> {
    let updated = update_global_options_from_ui(&state.paths, payload).await?;
    Ok(updated.into())
}

#[tauri::command]
pub async fn import_global_options_from_instance(
    state: State<'_, AppState>,
    profile_id: String,
) -> AppResult<GlobalGameOptionsResponse> {
    validate_profile_id(&profile_id)?;
    let profile = {
        let guard = state.config.lock().await;
        guard
            .profiles
            .iter()
            .find(|p| p.id == profile_id)
            .cloned()
            .ok_or_else(|| AppError::ConfigError(format!("Profile '{profile_id}' not found")))?
    };

    let inst_dir = state.paths.instance_dir(&profile.id);
    let updated =
        import_global_options_from_instance_dir(&state.paths, &inst_dir, &profile.name).await?;
    Ok(updated.into())
}

#[tauri::command]
pub async fn apply_global_options_to_instance(
    state: State<'_, AppState>,
    profile_id: String,
) -> AppResult<ApplyGlobalOptionsResult> {
    validate_profile_id(&profile_id)?;
    {
        let running = state.running_processes.lock().await;
        if running.contains_key(&profile_id) {
            return Err(AppError::ConfigError(
                "Detén Minecraft antes de aplicar los ajustes globales a esta instancia."
                    .to_string(),
            ));
        }
    }

    let opts = load_global_options(&state.paths).await;
    if opts.entries.is_empty() {
        return Err(AppError::ConfigError(
            "Todavía no hay ajustes globales guardados. Importa desde una instancia o configura tus preferencias primero."
                .to_string(),
        ));
    }

    let inst_dir = state.paths.instance_dir(&profile_id);
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let mut backups = Vec::new();
    if let Some(bak) = apply_global_options_to_instance_dir(&inst_dir, &opts, ts).await? {
        backups.push(bak);
    }

    Ok(ApplyGlobalOptionsResult {
        applied_instances: 1,
        skipped_running: 0,
        backups_created: backups,
    })
}

#[tauri::command]
pub async fn apply_global_options_to_all_instances(
    state: State<'_, AppState>,
) -> AppResult<ApplyGlobalOptionsResult> {
    let opts = load_global_options(&state.paths).await;
    if opts.entries.is_empty() {
        return Err(AppError::ConfigError(
            "Todavía no hay ajustes globales guardados.".to_string(),
        ));
    }

    let profile_ids: Vec<String> = {
        let guard = state.config.lock().await;
        guard.profiles.iter().map(|p| p.id.clone()).collect()
    };
    let running_ids: std::collections::HashSet<String> = {
        let running = state.running_processes.lock().await;
        running.keys().cloned().collect()
    };

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let mut applied = 0_usize;
    let mut skipped = 0_usize;
    let mut backups = Vec::new();

    for pid in profile_ids {
        if running_ids.contains(&pid) {
            skipped += 1;
            continue;
        }
        let inst_dir = state.paths.instance_dir(&pid);
        if let Some(bak) = apply_global_options_to_instance_dir(&inst_dir, &opts, ts).await? {
            backups.push(format!("{pid}/{bak}"));
        }
        applied += 1;
    }

    Ok(ApplyGlobalOptionsResult {
        applied_instances: applied,
        skipped_running: skipped,
        backups_created: backups,
    })
}

const GITHUB_RELEASES_API_URL: &str =
    "https://api.github.com/repos/HugoSabater/Vexel-Launcher/releases/latest";
const ALLOWED_RELEASE_URL_PREFIX: &str =
    "https://github.com/HugoSabater/Vexel-Launcher/releases/";
const UPDATE_CHECK_TTL_SECS: u64 = 24 * 3600;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub release_url: String,
    #[serde(default)]
    pub checked_at_secs: u64,
}

#[derive(Debug, Deserialize)]
struct GithubLatestRelease {
    tag_name: String,
    html_url: String,
}

#[must_use]
fn parse_semver_triple(raw: &str) -> Option<(u64, u64, u64)> {
    let trimmed = raw.trim().trim_start_matches('v').trim_start_matches('V');
    let core = trimmed.split('-').next()?.split('+').next()?;
    let mut parts = core.split('.');
    let major = parts.next()?.parse::<u64>().ok()?;
    let minor = parts.next()?.parse::<u64>().ok()?;
    let patch = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch))
}

#[must_use]
fn is_newer_semver(current: &str, latest: &str) -> bool {
    let Some(curr_t) = parse_semver_triple(current) else {
        return false;
    };
    let Some(lat_t) = parse_semver_triple(latest) else {
        return false;
    };
    if lat_t != curr_t {
        return lat_t > curr_t;
    }
    // Same numeric triple: stable release is newer than a pre-release (e.g. 1.1.0 > 1.1.0-beta.1)
    let curr_pre = current.contains('-');
    let lat_pre = latest.contains('-');
    curr_pre && !lat_pre
}

#[must_use]
fn is_safe_release_url(url: &str) -> bool {
    let trimmed = url.trim();
    if !trimmed.starts_with(ALLOWED_RELEASE_URL_PREFIX) {
        return false;
    }
    !trimmed.chars().any(|c| {
        c.is_control()
            || c.is_whitespace()
            || matches!(
                c,
                '&' | '|' | '"' | '\'' | '<' | '>' | ';' | '`' | '$' | '(' | ')' | '%' | '^'
            )
    })
}

#[tauri::command]
pub async fn check_launcher_update(state: State<'_, AppState>) -> AppResult<UpdateCheckResult> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let cache_path = state.paths.update_check_cache_path();

    if let Ok(raw) = tokio::fs::read_to_string(&cache_path).await {
        if let Ok(mut cached) = serde_json::from_str::<UpdateCheckResult>(&raw) {
            if now_secs.saturating_sub(cached.checked_at_secs) < UPDATE_CHECK_TTL_SECS {
                cached.current_version = current.clone();
                cached.update_available = is_newer_semver(&current, &cached.latest_version)
                    && is_safe_release_url(&cached.release_url);
                return Ok(cached);
            }
        }
    }

    let fallback = UpdateCheckResult {
        current_version: current.clone(),
        latest_version: current.clone(),
        update_available: false,
        release_url: String::new(),
        checked_at_secs: now_secs,
    };

    let Ok(resp) = state
        .client
        .get(GITHUB_RELEASES_API_URL)
        .timeout(Duration::from_secs(5))
        .send()
        .await
    else {
        return Ok(fallback);
    };
    if !resp.status().is_success() {
        return Ok(fallback);
    }
    let Ok(release) = resp.json::<GithubLatestRelease>().await else {
        return Ok(fallback);
    };

    let latest_clean = release
        .tag_name
        .trim()
        .trim_start_matches('v')
        .trim_start_matches('V')
        .to_string();
    let safe_url = if is_safe_release_url(&release.html_url) {
        release.html_url.trim().to_string()
    } else {
        String::new()
    };
    let update_available =
        !safe_url.is_empty() && is_newer_semver(&current, &release.tag_name);

    let result = UpdateCheckResult {
        current_version: current,
        latest_version: latest_clean,
        update_available,
        release_url: safe_url,
        checked_at_secs: now_secs,
    };

    if let Ok(serialized) = serde_json::to_vec_pretty(&result) {
        let _ = state.paths.ensure_base_dirs().await;
        let tmp = cache_path.with_extension("json.tmp");
        if tokio::fs::write(&tmp, &serialized).await.is_ok()
            && tokio::fs::rename(&tmp, &cache_path).await.is_err()
        {
            let _ = tokio::fs::remove_file(&tmp).await;
        }
    }

    Ok(result)
}

#[tauri::command]
pub async fn open_external_url(url: String) -> AppResult<()> {
    let trimmed = url.trim();
    if !is_safe_release_url(trimmed) {
        return Err(AppError::ConfigError(
            "URL externa no permitida por la política de seguridad.".to_string(),
        ));
    }

    #[cfg(windows)]
    {
        tokio::process::Command::new("explorer.exe")
            .arg(trimmed)
            .spawn()
            .map_err(|err| AppError::ProcessLaunch(format!("No se pudo abrir el navegador: {err}")))?;
    }
    #[cfg(not(windows))]
    {
        let _ = trimmed;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{is_newer_semver, is_safe_release_url, validate_offline_username, validate_skin_png};

    fn make_png_header(width: u32, height: u32) -> Vec<u8> {
        let mut buf = Vec::with_capacity(24);
        buf.extend_from_slice(b"\x89PNG\r\n\x1a\n");
        buf.extend_from_slice(&13_u32.to_be_bytes());
        buf.extend_from_slice(b"IHDR");
        buf.extend_from_slice(&width.to_be_bytes());
        buf.extend_from_slice(&height.to_be_bytes());
        buf
    }

    #[test]
    fn test_validate_offline_username() {
        assert_eq!(validate_offline_username("Hugo_01").ok().as_deref(), Some("Hugo_01"));
        assert_eq!(validate_offline_username("  Steve  ").ok().as_deref(), Some("Steve"));
        assert!(validate_offline_username("ab").is_err());
        assert!(validate_offline_username("NombreDemasiadoLargo123").is_err());
        assert!(validate_offline_username("Hugo Dev").is_err());
        assert!(validate_offline_username("Hugó").is_err());
    }

    #[test]
    fn test_validate_skin_png_ihdr_dimensions() {
        assert_eq!(validate_skin_png(&make_png_header(64, 64)).ok(), Some((64, 64)));
        assert_eq!(validate_skin_png(&make_png_header(64, 32)).ok(), Some((64, 32)));
        assert_eq!(validate_skin_png(&make_png_header(128, 128)).ok(), Some((128, 128)));
        assert_eq!(validate_skin_png(&make_png_header(256, 128)).ok(), Some((256, 128)));

        // Truncated or missing IHDR must never panic
        assert!(validate_skin_png(b"\x89PNG\r\n\x1a\nshort").is_err());
        let mut bad_chunk = make_png_header(64, 64);
        bad_chunk[12..16].copy_from_slice(b"IDAT");
        assert!(validate_skin_png(&bad_chunk).is_err());

        // Invalid dimensions
        assert!(validate_skin_png(&make_png_header(100, 100)).is_err());
        assert!(validate_skin_png(&make_png_header(32, 32)).is_err());
        assert!(validate_skin_png(&make_png_header(2048, 2048)).is_err());
    }

    #[test]
    fn test_infer_java_major_maps_1_17_to_17_and_modern_to_21() {
        assert_eq!(super::infer_java_major_for_mc_version("1.8.9"), 8);
        assert_eq!(super::infer_java_major_for_mc_version("1.16.5"), 8);
        assert_eq!(super::infer_java_major_for_mc_version("1.17.1"), 17);
        assert_eq!(super::infer_java_major_for_mc_version("1.20.4"), 17);
        assert_eq!(super::infer_java_major_for_mc_version("1.20.5"), 21);
        assert_eq!(super::infer_java_major_for_mc_version("1.21.4"), 21);
        assert_eq!(super::infer_java_major_for_mc_version("24w45a"), 21);
    }

    #[test]
    fn test_semver_update_comparison_and_safe_release_url() {
        assert!(is_newer_semver("1.0.0", "1.1.0"));
        assert!(is_newer_semver("1.0.0", "v1.1.0"));
        assert!(is_newer_semver("1.0.9", "1.1.0"));
        assert!(is_newer_semver("1.1.0-beta.1", "1.1.0"));
        assert!(!is_newer_semver("1.1.0", "1.1.0"));
        assert!(!is_newer_semver("1.1.0", "v1.0.9"));
        assert!(!is_newer_semver("1.1.0", "1.1.0-beta.2"));
        assert!(!is_newer_semver("1.0.0", "invalid-tag"));

        assert!(is_safe_release_url(
            "https://github.com/HugoSabater/Vexel-Launcher/releases/tag/v1.1.0"
        ));
        assert!(!is_safe_release_url("https://evil.example/releases/v1.1.0"));
        assert!(!is_safe_release_url(
            "https://github.com/HugoSabater/Vexel-Launcher/releases/tag/v1.1.0&calc.exe"
        ));
        assert!(!is_safe_release_url(
            "https://github.com/HugoSabater/Vexel-Launcher/releases/tag/v1.1.0 | whoami"
        ));
    }
}
