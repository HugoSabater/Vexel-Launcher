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
    #[serde(default)]
    pub window_width: Option<u32>,
    #[serde(default)]
    pub window_height: Option<u32>,
    #[serde(default)]
    pub fullscreen: bool,
    #[serde(default)]
    pub custom_jvm_args: Option<String>,
    #[serde(default)]
    pub custom_java_path: Option<String>,
}

fn default_skin_model() -> String {
    "classic".to_string()
}

fn default_true() -> bool {
    true
}

fn default_accent_color() -> String {
    "emerald".to_string()
}

fn default_launch_behavior() -> String {
    "keep_open".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LauncherConfig {
    pub offline_username: String,
    pub process_priority: ProcessPriority,
    #[serde(default)]
    pub close_on_launch: bool,
    #[serde(default)]
    pub skin_path: Option<String>,
    #[serde(default = "default_skin_model")]
    pub skin_model: String,
    #[serde(default = "default_true")]
    pub apply_skin_ingame: bool,
    #[serde(default = "default_accent_color")]
    pub accent_color: String,
    #[serde(default = "default_launch_behavior")]
    pub launch_behavior: String,
    #[serde(default = "default_true")]
    pub auto_open_console_on_crash: bool,
    pub profiles: Vec<Profile>,
}

impl LauncherConfig {
    #[must_use]
    pub fn default_with_hardware(hw: &HardwareInfo) -> Self {
        Self {
            offline_username: "Player".to_string(),
            process_priority: ProcessPriority::AboveNormal,
            close_on_launch: false,
            skin_path: None,
            skin_model: default_skin_model(),
            apply_skin_ingame: true,
            accent_color: default_accent_color(),
            launch_behavior: default_launch_behavior(),
            auto_open_console_on_crash: true,
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
                    window_width: None,
                    window_height: None,
                    fullscreen: false,
                    custom_jvm_args: None,
                    custom_java_path: None,
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
                    window_width: None,
                    window_height: None,
                    fullscreen: false,
                    custom_jvm_args: None,
                    custom_java_path: None,
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

    let mut needs_save = false;
    let mut config = if tokio::fs::try_exists(&config_path).await? {
        match tokio::fs::read_to_string(&config_path).await {
            Ok(raw) => match serde_json::from_str::<LauncherConfig>(&raw) {
                Ok(parsed) => parsed,
                Err(err) => {
                    eprintln!("[Config Recovery] config.json corrupto ({err}); creando backup y reinicializando.");
                    let ts = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map_or(0, |d| d.as_secs());
                    let backup_path = config_path.with_extension(format!("json.corrupt.{ts}"));
                    let _ = tokio::fs::rename(&config_path, &backup_path).await;
                    needs_save = true;
                    LauncherConfig::default_with_hardware(hw)
                }
            },
            Err(_) => {
                needs_save = true;
                LauncherConfig::default_with_hardware(hw)
            }
        }
    } else {
        needs_save = true;
        LauncherConfig::default_with_hardware(hw)
    };

    // Migrate legacy close_on_launch: true -> launch_behavior: "hide_and_restore"
    if config.close_on_launch && config.launch_behavior == "keep_open" {
        config.launch_behavior = "hide_and_restore".to_string();
        needs_save = true;
    }

    if config.profiles.is_empty() {
        config.profiles = LauncherConfig::default_with_hardware(hw).profiles;
        needs_save = true;
    }

    if needs_save {
        save_config_atomic(paths, &config).await?;
    }

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

#[cfg(test)]
mod tests {
    use super::{delete_profile, load_or_init_config, upsert_profile, LauncherConfig};
    use crate::core::hardware::HardwareInfo;
    use crate::core::paths::LauncherPaths;

    fn sample_hw() -> HardwareInfo {
        HardwareInfo {
            total_ram_mb: 16384,
            available_ram_mb: 10240,
            logical_cores: 8,
            recommended_vanilla_mb: 4096,
            recommended_modded_mb: 6144,
            max_safe_ram_mb: 8192,
        }
    }

    #[tokio::test]
    async fn test_corrupt_config_recovery_and_legacy_close_on_launch_migration() -> Result<(), Box<dyn std::error::Error>> {
        let tmp = std::env::temp_dir().join(format!(
            "mc-launcher-cfg-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let paths = LauncherPaths::with_root(tmp.clone());
        paths.ensure_base_dirs().await?;

        // 1. Corrupt config.json recovers gracefully instead of crashing setup
        tokio::fs::write(paths.config_path(), b"{ invalid json !!!").await?;
        let recovered = load_or_init_config(&paths, &sample_hw()).await?;
        assert!(!recovered.profiles.is_empty());

        // 2. Legacy config with close_on_launch: true and missing launch_behavior migrates cleanly
        let legacy_json = r#"{
            "offline_username": "Tester",
            "process_priority": "above_normal",
            "close_on_launch": true,
            "profiles": []
        }"#;
        tokio::fs::write(paths.config_path(), legacy_json.as_bytes()).await?;
        let migrated = load_or_init_config(&paths, &sample_hw()).await?;
        assert_eq!(migrated.launch_behavior, "hide_and_restore");
        assert!(!migrated.profiles.is_empty());

        let _ = tokio::fs::remove_dir_all(&tmp).await;
        Ok(())
    }

    #[tokio::test]
    async fn test_upsert_and_delete_profile_preserves_default() -> Result<(), Box<dyn std::error::Error>> {
        let tmp = std::env::temp_dir().join(format!(
            "mc-launcher-prof-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let paths = LauncherPaths::with_root(tmp.clone());
        let mut cfg = LauncherConfig::default_with_hardware(&sample_hw());
        let mut third = cfg.profiles[0].clone();
        third.id = "custom-3".to_string();
        third.is_default = true;
        upsert_profile(&paths, &mut cfg, third).await?;
        assert_eq!(cfg.profiles.len(), 3);
        assert!(cfg.profiles.iter().find(|p| p.id == "custom-3").is_some_and(|p| p.is_default));

        delete_profile(&mut cfg, "custom-3")?;
        assert_eq!(cfg.profiles.len(), 2);
        assert!(cfg.profiles.iter().any(|p| p.is_default));

        let _ = tokio::fs::remove_dir_all(&tmp).await;
        Ok(())
    }
}
