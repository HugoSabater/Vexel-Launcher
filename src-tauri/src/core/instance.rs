use serde::{Deserialize, Serialize};

use crate::core::hardware::HardwareInfo;
use crate::core::jvm_optimizer::GcPreset;
use crate::core::paths::LauncherPaths;
use crate::core::runner::ProcessPriority;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModLoaderKind {
    Vanilla,
    Fabric,
    Forge,
    NeoForge,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub mc_version: String,
    pub loader: ModLoaderKind,
    pub loader_version: Option<String>,
    pub ram_mb: u64,
    pub gc_preset: GcPreset,
    pub server_address: Option<String>,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LauncherConfig {
    pub offline_username: String,
    pub process_priority: ProcessPriority,
    pub close_on_launch: bool,
    pub profiles: Vec<Profile>,
}

impl LauncherConfig {
    #[must_use]
    pub fn default_with_hardware(hw: &HardwareInfo) -> Self {
        Self {
            offline_username: "Player".to_string(),
            process_priority: ProcessPriority::AboveNormal,
            close_on_launch: false,
            profiles: vec![
                Profile {
                    id: "vanilla-1-21-4".to_string(),
                    name: "Vanilla 1.21.4 Ultra".to_string(),
                    mc_version: "1.21.4".to_string(),
                    loader: ModLoaderKind::Vanilla,
                    loader_version: None,
                    ram_mb: hw.recommended_vanilla_mb,
                    gc_preset: GcPreset::GenerationalZgc,
                    server_address: None,
                    is_default: true,
                },
                Profile {
                    id: "fabric-1-21-1-perf".to_string(),
                    name: "Fabric 1.21.1 Performance".to_string(),
                    mc_version: "1.21.1".to_string(),
                    loader: ModLoaderKind::Fabric,
                    loader_version: None,
                    ram_mb: hw.recommended_modded_mb,
                    gc_preset: GcPreset::GenerationalZgc,
                    server_address: None,
                    is_default: false,
                },
            ],
        }
    }
}

pub fn validate_profile_id(profile_id: &str) -> AppResult<()> {
    if profile_id.is_empty()
        || profile_id.contains("..")
        || profile_id.contains('/')
        || profile_id.contains('\\')
    {
        return Err(AppError::ConfigError(format!(
            "Invalid profile identifier: '{profile_id}'"
        )));
    }
    Ok(())
}

pub async fn save_config_atomic(paths: &LauncherPaths, config: &LauncherConfig) -> AppResult<()> {
    paths.ensure_base_dirs().await?;
    let config_path = paths.config_path();
    let tmp_path = config_path.with_extension("json.tmp");
    let serialized = serde_json::to_vec_pretty(config)?;
    tokio::fs::write(&tmp_path, serialized).await?;
    tokio::fs::rename(&tmp_path, &config_path).await?;
    Ok(())
}

pub async fn load_or_init_config(
    paths: &LauncherPaths,
    hw: &HardwareInfo,
) -> AppResult<LauncherConfig> {
    paths.ensure_base_dirs().await?;
    let config_path = paths.config_path();

    let config = if tokio::fs::try_exists(&config_path).await? {
        let raw = tokio::fs::read_to_string(&config_path).await?;
        serde_json::from_str::<LauncherConfig>(&raw)?
    } else {
        let initial = LauncherConfig::default_with_hardware(hw);
        save_config_atomic(paths, &initial).await?;
        initial
    };

    for profile in &config.profiles {
        validate_profile_id(&profile.id)?;
        paths.ensure_instance_dirs(&profile.id).await?;
    }

    Ok(config)
}

pub async fn upsert_profile(
    paths: &LauncherPaths,
    config: &mut LauncherConfig,
    mut profile: Profile,
) -> AppResult<()> {
    validate_profile_id(&profile.id)?;
    paths.ensure_instance_dirs(&profile.id).await?;

    if profile.is_default {
        for p in &mut config.profiles {
            p.is_default = false;
        }
    } else if config.profiles.is_empty() {
        profile.is_default = true;
    }

    if let Some(existing) = config.profiles.iter_mut().find(|p| p.id == profile.id) {
        *existing = profile;
    } else {
        config.profiles.push(profile);
    }

    if !config.profiles.iter().any(|p| p.is_default) {
        if let Some(first) = config.profiles.first_mut() {
            first.is_default = true;
        }
    }

    save_config_atomic(paths, config).await
}

pub fn delete_profile(config: &mut LauncherConfig, profile_id: &str) -> AppResult<()> {
    if config.profiles.len() <= 1 {
        return Err(AppError::ConfigError(
            "Cannot remove the last remaining profile".to_string(),
        ));
    }

    let original_len = config.profiles.len();
    config.profiles.retain(|p| p.id != profile_id);
    if config.profiles.len() == original_len {
        return Err(AppError::ConfigError(format!(
            "Profile '{profile_id}' not found"
        )));
    }

    if !config.profiles.iter().any(|p| p.is_default) {
        if let Some(first) = config.profiles.first_mut() {
            first.is_default = true;
        }
    }

    Ok(())
}
