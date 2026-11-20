use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{State, Window};
use tokio::sync::Mutex;

use crate::core::content::{
    import_content_bytes, import_content_file, inject_modrinth_preset,
    install_single_modrinth_item, list_curated_recommendations, list_instance_content,
    search_modrinth_catalog, toggle_content_item, ContentItem, ContentKind, CuratedRecommendation,
    PerformancePreset,
};
use crate::core::downloader::{verify_and_download_all, DownloadProgress};
use crate::core::hardware::HardwareInfo;
use crate::core::instance::{
    delete_profile, save_config_atomic, upsert_profile, validate_profile_id, LauncherConfig,
    ModLoaderKind, Profile,
};
use crate::core::java::{check_java_runtime, install_java_runtime, JavaRuntimeStatus};
use crate::core::jvm_optimizer::{generate_jvm_flags, GcPreset, JvmTuningInput, JvmTuningOutput};
use crate::core::loaders::{merge_overlay_into_plan, resolve_fabric_overlay};
use crate::core::manifest::{
    build_download_plan, extract_game_arguments, fetch_or_load_asset_index,
    fetch_or_load_version_manifest,
};
use crate::core::paths::LauncherPaths;
use crate::core::runner::{spawn_minecraft, terminate_process, LaunchRequest, ProcessPriority};
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
pub struct WorldSummary {
    pub folder_name: String,
    pub last_modified_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct InstanceSummary {
    pub recent_worlds: Vec<WorldSummary>,
    pub latest_screenshot_data_url: Option<String>,
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
pub async fn save_global_settings(
    state: State<'_, AppState>,
    offline_username: String,
    process_priority: ProcessPriority,
    close_on_launch: bool,
) -> AppResult<LauncherConfig> {
    let trimmed = offline_username.trim();
    if trimmed.is_empty() {
        return Err(AppError::ConfigError(
            "Offline username cannot be empty".to_string(),
        ));
    }

    let mut guard = state.config.lock().await;
    guard.offline_username = trimmed.to_string();
    guard.process_priority = process_priority;
    guard.close_on_launch = close_on_launch;
    save_config_atomic(&state.paths, &guard).await?;
    Ok(guard.clone())
}

#[tauri::command]
pub async fn create_or_update_profile(
    state: State<'_, AppState>,
    profile: Profile,
) -> AppResult<LauncherConfig> {
    let mut guard = state.config.lock().await;
    upsert_profile(&state.paths, &mut guard, profile).await?;
    Ok(guard.clone())
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
) -> AppResult<LauncherConfig> {
    let mut guard = state.config.lock().await;
    delete_profile(&mut guard, &profile_id)?;
    save_config_atomic(&state.paths, &guard).await?;
    Ok(guard.clone())
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
pub async fn import_profile_content(
    state: State<'_, AppState>,
    profile_id: String,
    kind: ContentKind,
    source_path: String,
) -> AppResult<ContentItem> {
    import_content_file(&state.paths, &profile_id, kind, &PathBuf::from(source_path)).await
}

#[tauri::command]
pub async fn import_profile_content_bytes(
    state: State<'_, AppState>,
    profile_id: String,
    kind: ContentKind,
    file_name: String,
    bytes: Vec<u8>,
) -> AppResult<ContentItem> {
    import_content_bytes(&state.paths, &profile_id, kind, &file_name, &bytes).await
}

#[tauri::command]
pub async fn search_modrinth(
    state: State<'_, AppState>,
    profile_id: String,
    query: String,
    mc_version: String,
    loader: String,
    kind: ContentKind,
) -> AppResult<Vec<CuratedRecommendation>> {
    search_modrinth_catalog(
        &state.client,
        &state.paths,
        &profile_id,
        &query,
        &mc_version,
        &loader,
        kind,
    )
    .await
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

#[tauri::command]
pub async fn upload_custom_skin(
    state: State<'_, AppState>,
    source_path: String,
) -> AppResult<String> {
    let src = PathBuf::from(&source_path);
    let bytes = tokio::fs::read(&src).await?;
    validate_png_signature(&bytes)?;

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
pub async fn upload_custom_skin_bytes(
    state: State<'_, AppState>,
    bytes: Vec<u8>,
) -> AppResult<String> {
    validate_png_signature(&bytes)?;

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
    let mut worlds = Vec::new();
    if tokio::fs::try_exists(&saves_dir).await? {
        let mut entries = tokio::fs::read_dir(&saves_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let meta = entry.metadata().await?;
            if !meta.is_dir() {
                continue;
            }
            let modified_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_millis() as u64);
            worlds.push(WorldSummary {
                folder_name: entry.file_name().to_string_lossy().into_owned(),
                last_modified_ms: modified_ms,
            });
        }
    }
    worlds.sort_by(|a, b| b.last_modified_ms.cmp(&a.last_modified_ms));
    worlds.truncate(3);

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
pub async fn inject_performance_preset(
    state: State<'_, AppState>,
    profile_id: String,
    preset: PerformancePreset,
    on_progress: Channel<LaunchProgressEvent>,
) -> AppResult<Vec<String>> {
    let profile = {
        let guard = state.config.lock().await;
        guard
            .profiles
            .iter()
            .find(|p| p.id == profile_id)
            .cloned()
            .ok_or_else(|| AppError::ConfigError(format!("Profile '{profile_id}' not found")))?
    };

    inject_modrinth_preset(
        &state.client,
        &state.paths,
        &profile.id,
        &profile.mc_version,
        preset,
        move |progress| {
            let _ = on_progress.send(progress.into());
        },
    )
    .await
}

#[tauri::command]
pub async fn get_curated_recommendations(
    state: State<'_, AppState>,
    profile_id: String,
) -> AppResult<Vec<CuratedRecommendation>> {
    list_curated_recommendations(&state.paths, &profile_id).await
}

#[tauri::command]
pub async fn install_modrinth_item(
    state: State<'_, AppState>,
    profile_id: String,
    slug: String,
    kind: ContentKind,
    on_progress: Channel<LaunchProgressEvent>,
) -> AppResult<Vec<String>> {
    let profile = {
        let guard = state.config.lock().await;
        guard
            .profiles
            .iter()
            .find(|p| p.id == profile_id)
            .cloned()
            .ok_or_else(|| AppError::ConfigError(format!("Profile '{profile_id}' not found")))?
    };

    install_single_modrinth_item(
        &state.client,
        &state.paths,
        &profile.id,
        &profile.mc_version,
        &slug,
        kind,
        move |progress| {
            let _ = on_progress.send(progress.into());
        },
    )
    .await
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
    } else if major == 1 && minor >= 18 {
        17
    } else if major == 1 && minor == 17 {
        16
    } else {
        8
    }
}

#[tauri::command]
pub async fn check_profile_java(
    state: State<'_, AppState>,
    mc_version: String,
) -> AppResult<JavaRuntimeStatus> {
    let cached_manifest = state.paths.version_json_path(&mc_version);
    let required_major = if tokio::fs::try_exists(&cached_manifest).await? {
        let raw = tokio::fs::read_to_string(&cached_manifest).await?;
        serde_json::from_str::<crate::core::manifest::VersionManifest>(&raw)
            .ok()
            .and_then(|m| m.java_version.map(|j| j.major_version))
            .unwrap_or_else(|| infer_java_major_for_mc_version(&mc_version))
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
                "Extrayendo runtime..." => (95, 100),
                "Runtime listo" => (100, 100),
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
    on_progress: Channel<LaunchProgressEvent>,
    on_log: Channel<LogLineEvent>,
    on_exit: Channel<InstanceExitEvent>,
) -> AppResult<LaunchResult> {
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
        phase: "Resolviendo manifiesto".to_string(),
        completed: 0,
        total: 4,
        bytes_downloaded: 0,
        detail: format!("Cargando metadatos de Minecraft {}...", profile.mc_version),
        fast_path_hits: 0,
    });

    let manifest =
        fetch_or_load_version_manifest(&state.client, &profile.mc_version, &state.paths).await?;
    let required_major = manifest
        .java_version
        .as_ref()
        .map_or(21, |j| j.major_version);

    let javaw_path = match check_java_runtime(required_major, &state.paths).await? {
        JavaRuntimeStatus::Installed { javaw_path, .. } => PathBuf::from(javaw_path),
        JavaRuntimeStatus::Missing { major, .. } => {
            return Err(AppError::JavaNotFound {
                required_major: major,
            });
        }
    };

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
    let mut extra_game_args = extract_game_arguments(&manifest);

    match profile.loader {
        ModLoaderKind::Vanilla => {}
        ModLoaderKind::Fabric => {
            let _ = on_progress.send(LaunchProgressEvent {
                phase: "Resolviendo Fabric Meta API".to_string(),
                completed: 1,
                total: 4,
                bytes_downloaded: 0,
                detail: format!("Obteniendo perfil Fabric para MC {}...", profile.mc_version),
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
                merge_overlay_into_plan(&mut plan, overlay);
            main_class = loader_main;
            extra_jvm_args.extend(loader_jvm);
            extra_game_args.append(&mut loader_game);
        }
        ModLoaderKind::Forge | ModLoaderKind::NeoForge => {
            return Err(AppError::LoaderError(format!(
                "{:?} metadata pipeline initialized; use Vanilla or Fabric for direct launch in this release",
                profile.loader
            )));
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
        phase: "Lanzando JVM".to_string(),
        completed: summary.total_artifacts,
        total: summary.total_artifacts.max(1),
        bytes_downloaded: 0,
        detail: format!(
            "Arrancando {} ({} Fast-Path hits)",
            profile.name, summary.fast_path_hits
        ),
        fast_path_hits: summary.fast_path_hits,
    });

    let log_channel = on_log.clone();
    let running_map = Arc::clone(&state.running_processes);
    let profile_id_for_exit = profile.id.clone();
    let window_for_exit = window.clone();
    let should_restore_window = config_snapshot.close_on_launch;
    let exit_channel = on_exit.clone();

    let pid = spawn_minecraft(
        LaunchRequest {
            profile_id: profile.id.clone(),
            mc_version: profile.mc_version,
            username: config_snapshot.offline_username,
            ram_mb: profile.ram_mb,
            gc_preset: profile.gc_preset,
            process_priority: config_snapshot.process_priority,
            server_address: profile.server_address,
            javaw_path,
            main_class,
            java_major: required_major,
            classpath_entries: plan.classpath_entries,
            native_archives: plan.native_archives,
            asset_index_id,
            extra_jvm_args,
            extra_game_args,
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

    if config_snapshot.close_on_launch {
        let _ = window.hide();
    }

    Ok(LaunchResult {
        pid,
        fast_path_hits: summary.fast_path_hits,
        downloaded_files: summary.downloaded_files,
        java_major: required_major,
    })
}
