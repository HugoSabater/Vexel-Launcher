use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{State, Window};
use tokio::sync::Mutex;

use crate::core::content::{
    import_content_file, inject_modrinth_performance_stack, list_instance_content,
    toggle_content_item, ContentItem, ContentKind,
};
use crate::core::downloader::{verify_and_download_all, DownloadProgress};
use crate::core::hardware::HardwareInfo;
use crate::core::instance::{
    delete_profile, save_config_atomic, upsert_profile, LauncherConfig, ModLoaderKind, Profile,
};
use crate::core::java::{check_java_runtime, install_java_runtime, JavaRuntimeStatus};
use crate::core::jvm_optimizer::{generate_jvm_flags, GcPreset, JvmTuningInput, JvmTuningOutput};
use crate::core::loaders::{merge_overlay_into_plan, resolve_fabric_overlay};
use crate::core::manifest::{
    build_download_plan, extract_game_arguments, fetch_or_load_asset_index,
    fetch_or_load_version_manifest,
};
use crate::core::paths::LauncherPaths;
use crate::core::runner::{spawn_minecraft, LaunchRequest, ProcessPriority};
use crate::error::{AppError, AppResult};

pub struct AppState {
    pub client: reqwest::Client,
    pub paths: LauncherPaths,
    pub hardware: HardwareInfo,
    pub config: Mutex<LauncherConfig>,
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
    pub timestamp: String,
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

fn current_hms_timestamp() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() % 86_400);
    let hours = secs / 3_600;
    let mins = (secs % 3_600) / 60;
    let rem_secs = secs % 60;
    format!("{hours:02}:{mins:02}:{rem_secs:02}")
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
pub async fn inject_performance_stack(
    state: State<'_, AppState>,
    profile_id: String,
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

    inject_modrinth_performance_stack(
        &state.client,
        &state.paths,
        &profile.id,
        &profile.mc_version,
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
    let javaw_path =
        install_java_runtime(&state.client, major, &state.paths, move |done, total, msg| {
            let completed = (done / 1024) as usize;
            let total_kb = total.map_or(0, |t| (t / 1024) as usize);
            let _ = on_progress.send(LaunchProgressEvent {
                phase: format!("Instalando Adoptium Java {major}"),
                completed,
                total: total_kb.max(1),
                bytes_downloaded: done,
                detail: msg.to_string(),
                fast_path_hits: 0,
            });
        })
        .await?;

    Ok(JavaRuntimeStatus::Installed {
        major,
        javaw_path: javaw_path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn launch_profile(
    window: Window,
    state: State<'_, AppState>,
    profile_id: String,
    on_progress: Channel<LaunchProgressEvent>,
    on_log: Channel<LogLineEvent>,
) -> AppResult<LaunchResult> {
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
    let pid = spawn_minecraft(
        LaunchRequest {
            profile_id: profile.id,
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
                timestamp: current_hms_timestamp(),
            });
        },
    )
    .await?;

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
