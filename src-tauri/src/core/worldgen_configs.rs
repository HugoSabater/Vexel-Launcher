use std::path::{Path, PathBuf};

use crate::core::content::{ContentKind, InstanceContentIndex};
use crate::core::hardware::HardwareInfo;
use crate::core::instance::ModLoaderKind;
use crate::core::paths::LauncherPaths;
use crate::error::AppResult;

#[derive(Debug, Clone, Default)]
struct ActiveWorldgenMods {
    has_sodium: bool,
    has_c2me: bool,
    has_distant_horizons: bool,
}

fn classify_mod_token(raw: &str, flags: &mut ActiveWorldgenMods) {
    let norm: String = raw
        .to_ascii_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();

    if norm == "sodium"
        || norm.starts_with("sodiumfabric")
        || norm.starts_with("sodiumneoforge")
        || norm.starts_with("sodiummc")
    {
        flags.has_sodium = true;
    }
    if norm == "c2me" || norm.starts_with("c2mefabric") || norm.starts_with("c2memc") {
        flags.has_c2me = true;
    }
    if norm.starts_with("distanthorizons") {
        flags.has_distant_horizons = true;
    }
}

async fn detect_active_worldgen_mods(
    paths: &LauncherPaths,
    profile_id: &str,
) -> ActiveWorldgenMods {
    let mut flags = ActiveWorldgenMods::default();
    let mods_dir = paths.instance_mods_dir(profile_id);

    let index = InstanceContentIndex::load(&paths.instance_content_index_path(profile_id)).await;
    for entry in &index.entries {
        if entry.kind != ContentKind::Mod || entry.file_name.ends_with(".disabled") {
            continue;
        }
        // Only count index entries whose active .jar still exists on disk
        if !tokio::fs::try_exists(mods_dir.join(&entry.file_name))
            .await
            .unwrap_or(false)
        {
            continue;
        }
        if let Some(slug) = entry.slug.as_deref() {
            classify_mod_token(slug, &mut flags);
        }
        if let Some(mod_id) = entry.mod_id.as_deref() {
            classify_mod_token(mod_id, &mut flags);
        }
        classify_mod_token(&entry.file_name, &mut flags);
    }

    if let Ok(mut entries) = tokio::fs::read_dir(&mods_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let file_name = entry.file_name().to_string_lossy().into_owned();
            if !file_name.to_ascii_lowercase().ends_with(".jar") {
                continue;
            }
            classify_mod_token(&file_name, &mut flags);
        }
    }

    flags
}

#[must_use]
fn append_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut os = path.as_os_str().to_os_string();
    os.push(suffix);
    PathBuf::from(os)
}

/// Copies an existing file to `<file>.bak` (or `<file>.<timestamp>.bak` if `.bak` already exists)
/// so the user's original settings are never destroyed.
pub async fn backup_file_before_overwrite(
    path: &Path,
    timestamp_secs: u64,
) -> AppResult<Option<PathBuf>> {
    if !tokio::fs::try_exists(path).await? {
        return Ok(None);
    }

    let primary = append_suffix(path, ".bak");
    let target = if !tokio::fs::try_exists(&primary).await? {
        primary
    } else {
        let mut candidate = append_suffix(path, &format!(".{timestamp_secs}.bak"));
        let mut counter = 1_u32;
        while tokio::fs::try_exists(&candidate).await? {
            candidate = append_suffix(path, &format!(".{timestamp_secs}-{counter}.bak"));
            counter = counter.saturating_add(1);
        }
        candidate
    };

    tokio::fs::copy(path, &target).await?;
    Ok(Some(target))
}

async fn write_atomic(path: &Path, content: &str) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let tmp_path = append_suffix(path, ".tmp");
    tokio::fs::write(&tmp_path, content.as_bytes()).await?;
    tokio::fs::rename(&tmp_path, path).await?;
    Ok(())
}

async fn write_if_missing_atomic(path: &Path, content: &str) -> AppResult<bool> {
    if tokio::fs::try_exists(path).await? {
        return Ok(false);
    }
    write_atomic(path, content).await?;
    Ok(true)
}

/// Balanced Sodium chunk builder budget: leaves headroom for Render, Server and C2ME threads.
#[must_use]
pub fn sodium_chunk_builder_threads(logical_cores: usize) -> usize {
    (logical_cores / 4).clamp(2, 4)
}

/// Balanced C2ME executor budget: avoids oversubscribing laptop CPUs/iGPUs alongside Sodium.
#[must_use]
pub fn c2me_executor_parallelism(logical_cores: usize) -> usize {
    (logical_cores / 3).clamp(2, 4)
}

/// Complete Sodium 0.8.x JSON schema (all 5 sections populated so Gson never hits NPE).
/// Uses verified `DeferMode::ONE_FRAME` ("Soon") to eliminate /tp chunk lag without blocking iGPUs.
#[must_use]
pub fn build_sodium_options_json(logical_cores: usize) -> String {
    let chunk_builder_threads = sodium_chunk_builder_threads(logical_cores);
    let doc = serde_json::json!({
        "quality": {
            "weather_quality": "DEFAULT",
            "leaves_quality": "FAST",
            "enable_vignette": false,
            "use_closest_point_entity_sort": false
        },
        "advanced": {
            "enable_memory_tracing": false,
            "use_advanced_staging_buffers": true,
            "cpu_render_ahead_limit": 3
        },
        "performance": {
            "chunk_builder_threads": chunk_builder_threads,
            "chunk_build_defer_mode": "ONE_FRAME",
            "animate_only_visible_textures": true,
            "use_entity_culling": true,
            "use_fog_occlusion": true,
            "use_block_face_culling": true,
            "use_no_error_g_l_context": true,
            "quad_splitting_mode": "SAFE"
        },
        "notifications": {
            "has_cleared_donation_button": false,
            "has_seen_donation_prompt": false
        },
        "debug": {
            "terrain_sorting_enabled": true
        }
    });
    serde_json::to_string_pretty(&doc).unwrap_or_default()
}

/// Verified C2ME 0.4.x (`version = 3`) TOML configuration with balanced parallelism for laptops.
#[must_use]
pub fn build_c2me_toml(logical_cores: usize) -> String {
    let parallelism = c2me_executor_parallelism(logical_cores);
    format!(
        "\
version = 3
defaultGlobalExecutorParallelismExpression = \"default\"
threadPoolPriorityPreset = \"LOW\"
globalExecutorParallelism = {parallelism}
"
    )
}

/// Verified Distant Horizons 3.x (`_version = 5`) TOML configuration balanced for iGPU / C2ME coexistence.
#[must_use]
pub fn build_distant_horizons_toml(logical_cores: usize, total_ram_mb: u64) -> String {
    let threads = (logical_cores / 3).clamp(1, 4);
    let runtime_ratio = if logical_cores <= 8 || total_ram_mb <= 16_384 {
        "0.5"
    } else {
        "0.75"
    };
    format!(
        "\
_version = 5

[common.multiThreading]
numberOfThreads = {threads}
threadRunTimeRatio = \"{runtime_ratio}\"
threadPriority = 4

[common.worldGenerator]
pauseIfMovingQuickly = true
"
    )
}

/// Seeds hardware-tuned initial configs for active worldgen/rendering mods ONLY if each file does not exist.
/// On Forge/NeoForge profiles, only Distant Horizons is tuned (never Sodium/C2ME).
pub async fn ensure_worldgen_mod_configs(
    paths: &LauncherPaths,
    profile_id: &str,
    hw: &HardwareInfo,
    loader: ModLoaderKind,
) -> AppResult<Vec<String>> {
    if loader == ModLoaderKind::Vanilla {
        return Ok(Vec::new());
    }

    let active = detect_active_worldgen_mods(paths, profile_id).await;
    let is_fabric = loader == ModLoaderKind::Fabric;
    let tune_sodium = matches!(loader, ModLoaderKind::Fabric | ModLoaderKind::NeoForge) && active.has_sodium;
    let tune_c2me = is_fabric && active.has_c2me;
    let tune_dh = active.has_distant_horizons;

    if !tune_sodium && !tune_c2me && !tune_dh {
        return Ok(Vec::new());
    }

    let config_dir = paths.instance_config_dir(profile_id);
    let mut created = Vec::new();

    if tune_sodium {
        let sodium_path = config_dir.join("sodium-options.json");
        let content = build_sodium_options_json(hw.logical_cores);
        if !content.is_empty() && write_if_missing_atomic(&sodium_path, &content).await? {
            let threads = sodium_chunk_builder_threads(hw.logical_cores);
            created.push(format!(
                "config/sodium-options.json (chunk_builder_threads={threads}, defer=ONE_FRAME)"
            ));
        }
    }

    if tune_c2me {
        let c2me_path = config_dir.join("c2me.toml");
        let content = build_c2me_toml(hw.logical_cores);
        if write_if_missing_atomic(&c2me_path, &content).await? {
            let parallelism = c2me_executor_parallelism(hw.logical_cores);
            created.push(format!(
                "config/c2me.toml (globalExecutorParallelism={parallelism}, priority=LOW)"
            ));
        }
    }

    if tune_dh {
        let dh_path = config_dir.join("DistantHorizons.toml");
        let content = build_distant_horizons_toml(hw.logical_cores, hw.total_ram_mb);
        if write_if_missing_atomic(&dh_path, &content).await? {
            let threads = (hw.logical_cores / 3).clamp(1, 4);
            created.push(format!(
                "config/DistantHorizons.toml (numberOfThreads={threads}, priority=4)"
            ));
        }
    }

    Ok(created)
}

/// Regenerates optimal configs ONLY for active mods actually installed in the instance,
/// creating `.bak` backups before overwriting any existing config file.
/// On Forge/NeoForge profiles, only `DistantHorizons.toml` is touched (never Sodium/C2ME).
pub async fn reoptimize_worldgen_mod_configs(
    paths: &LauncherPaths,
    profile_id: &str,
    hw: &HardwareInfo,
    loader: ModLoaderKind,
    timestamp_secs: u64,
) -> AppResult<(Vec<String>, Vec<String>)> {
    if loader == ModLoaderKind::Vanilla {
        return Ok((Vec::new(), Vec::new()));
    }

    let active = detect_active_worldgen_mods(paths, profile_id).await;
    let is_fabric = loader == ModLoaderKind::Fabric;
    let tune_sodium = matches!(loader, ModLoaderKind::Fabric | ModLoaderKind::NeoForge) && active.has_sodium;
    let tune_c2me = is_fabric && active.has_c2me;
    let tune_dh = active.has_distant_horizons;

    if !tune_sodium && !tune_c2me && !tune_dh {
        return Ok((Vec::new(), Vec::new()));
    }

    let config_dir = paths.instance_config_dir(profile_id);
    let mut updated = Vec::new();
    let mut backups = Vec::new();

    if tune_sodium {
        let sodium_path = config_dir.join("sodium-options.json");
        let content = build_sodium_options_json(hw.logical_cores);
        if !content.is_empty() {
            if let Some(bak) = backup_file_before_overwrite(&sodium_path, timestamp_secs).await? {
                if let Some(name) = bak.file_name().and_then(|n| n.to_str()) {
                    backups.push(format!("config/{name}"));
                }
            }
            write_atomic(&sodium_path, &content).await?;
            updated.push("config/sodium-options.json".to_string());
        }
    }

    if tune_c2me {
        let c2me_path = config_dir.join("c2me.toml");
        let content = build_c2me_toml(hw.logical_cores);
        if let Some(bak) = backup_file_before_overwrite(&c2me_path, timestamp_secs).await? {
            if let Some(name) = bak.file_name().and_then(|n| n.to_str()) {
                backups.push(format!("config/{name}"));
            }
        }
        write_atomic(&c2me_path, &content).await?;
        updated.push("config/c2me.toml".to_string());
    }

    if tune_dh {
        let dh_path = config_dir.join("DistantHorizons.toml");
        let content = build_distant_horizons_toml(hw.logical_cores, hw.total_ram_mb);
        if let Some(bak) = backup_file_before_overwrite(&dh_path, timestamp_secs).await? {
            if let Some(name) = bak.file_name().and_then(|n| n.to_str()) {
                backups.push(format!("config/{name}"));
            }
        }
        write_atomic(&dh_path, &content).await?;
        updated.push("config/DistantHorizons.toml".to_string());
    }

    Ok((updated, backups))
}

#[cfg(test)]
mod tests {
    use super::{
        build_c2me_toml, build_distant_horizons_toml, build_sodium_options_json,
        ensure_worldgen_mod_configs, reoptimize_worldgen_mod_configs,
    };
    use crate::core::hardware::HardwareInfo;
    use crate::core::paths::LauncherPaths;

    fn sample_hw(cores: usize, ram_mb: u64) -> HardwareInfo {
        HardwareInfo {
            total_ram_mb: ram_mb,
            available_ram_mb: ram_mb / 2,
            logical_cores: cores,
            recommended_vanilla_mb: 4096,
            recommended_modded_mb: 6144,
            max_safe_ram_mb: 8192,
        }
    }

    #[test]
    fn test_generated_schemas_match_verified_versions() -> Result<(), Box<dyn std::error::Error>> {
        // 12-thread laptop: Sodium -> (12/4).clamp(2,4) = 3, C2ME -> (12/3).clamp(2,4) = 4
        let sodium_12t = build_sodium_options_json(12);
        let parsed: serde_json::Value = serde_json::from_str(&sodium_12t)?;
        assert_eq!(parsed["performance"]["chunk_builder_threads"], 3);
        assert_eq!(parsed["performance"]["chunk_build_defer_mode"], "ONE_FRAME");
        assert!(parsed.get("quality").is_some());
        assert!(parsed.get("advanced").is_some());
        assert!(parsed.get("notifications").is_some());
        assert!(parsed.get("debug").is_some());

        let sodium_8t: serde_json::Value = serde_json::from_str(&build_sodium_options_json(8))?;
        assert_eq!(sodium_8t["performance"]["chunk_builder_threads"], 2);
        let sodium_24t: serde_json::Value = serde_json::from_str(&build_sodium_options_json(24))?;
        assert_eq!(sodium_24t["performance"]["chunk_builder_threads"], 4);

        let c2me_12t = build_c2me_toml(12);
        assert!(c2me_12t.contains("version = 3"));
        assert!(c2me_12t.contains("threadPoolPriorityPreset = \"LOW\""));
        assert!(c2me_12t.contains("globalExecutorParallelism = 4"));

        let c2me_6t = build_c2me_toml(6);
        assert!(c2me_6t.contains("globalExecutorParallelism = 2"));

        let dh_laptop = build_distant_horizons_toml(8, 16_384);
        assert!(dh_laptop.contains("_version = 5"));
        assert!(dh_laptop.contains("numberOfThreads = 2"));
        assert!(dh_laptop.contains("threadRunTimeRatio = \"0.5\""));
        assert!(dh_laptop.contains("pauseIfMovingQuickly = true"));

        let dh_desktop = build_distant_horizons_toml(16, 32_768);
        assert!(dh_desktop.contains("numberOfThreads = 4"));
        assert!(dh_desktop.contains("threadRunTimeRatio = \"0.75\""));
        Ok(())
    }

    #[tokio::test]
    async fn test_create_only_if_missing_and_ignore_disabled_mods()
    -> Result<(), Box<dyn std::error::Error>> {
        let tmp = std::env::temp_dir().join(format!(
            "mc-launcher-worldgen-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let paths = LauncherPaths::with_root(tmp.clone());
        let profile_id = "test-fabric";
        paths.ensure_instance_dirs(profile_id).await?;

        let mods_dir = paths.instance_mods_dir(profile_id);
        tokio::fs::write(mods_dir.join("sodium-fabric-0.8.4+mc1.21.1.jar"), b"jar").await?;
        tokio::fs::write(mods_dir.join("c2me-fabric-0.4.0.jar"), b"jar").await?;
        // Disabled DH must NOT generate DistantHorizons.toml
        tokio::fs::write(mods_dir.join("DistantHorizons-3.0.jar.disabled"), b"jar").await?;

        // Pre-create custom user c2me.toml — must NEVER be overwritten by ensure_*
        let config_dir = paths.instance_config_dir(profile_id);
        tokio::fs::create_dir_all(&config_dir).await?;
        tokio::fs::write(config_dir.join("c2me.toml"), b"# custom user c2me\n").await?;

        let hw = sample_hw(12, 16_384);
        let created = ensure_worldgen_mod_configs(
            &paths,
            profile_id,
            &hw,
            crate::core::instance::ModLoaderKind::Fabric,
        )
        .await?;
        assert_eq!(created.len(), 1);
        assert!(created[0].contains("sodium-options.json"));

        assert!(tokio::fs::try_exists(config_dir.join("sodium-options.json")).await?);
        assert!(!tokio::fs::try_exists(config_dir.join("DistantHorizons.toml")).await?);
        let c2me_after = tokio::fs::read_to_string(config_dir.join("c2me.toml")).await?;
        assert_eq!(c2me_after, "# custom user c2me\n");

        // Second run must be a no-op
        let created_second = ensure_worldgen_mod_configs(
            &paths,
            profile_id,
            &hw,
            crate::core::instance::ModLoaderKind::Fabric,
        )
        .await?;
        assert!(created_second.is_empty());

        let _ = tokio::fs::remove_dir_all(&tmp).await;
        Ok(())
    }

    #[tokio::test]
    async fn test_reoptimize_backs_up_existing_and_skips_vanilla_or_inactive_mods()
    -> Result<(), Box<dyn std::error::Error>> {
        use crate::core::instance::ModLoaderKind;

        let tmp = std::env::temp_dir().join(format!(
            "vexel-reopt-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let paths = LauncherPaths::with_root(tmp.clone());
        let profile_id = "fabric-12t";
        paths.ensure_instance_dirs(profile_id).await?;

        let mods_dir = paths.instance_mods_dir(profile_id);
        tokio::fs::write(mods_dir.join("sodium-fabric-0.8.13.jar"), b"jar").await?;
        tokio::fs::write(mods_dir.join("c2me-fabric-0.4.0.jar"), b"jar").await?;
        tokio::fs::write(mods_dir.join("DistantHorizons-3.0.jar.disabled"), b"jar").await?;

        let config_dir = paths.instance_config_dir(profile_id);
        tokio::fs::create_dir_all(&config_dir).await?;
        tokio::fs::write(config_dir.join("c2me.toml"), b"globalExecutorParallelism = 9\n").await?;

        let hw = sample_hw(12, 16_384);

        // Vanilla profile must NEVER create mod config files even if jars exist
        let (vanilla_updated, vanilla_backups) = reoptimize_worldgen_mod_configs(
            &paths,
            profile_id,
            &hw,
            ModLoaderKind::Vanilla,
            1_700_000_000,
        )
        .await?;
        assert!(vanilla_updated.is_empty());
        assert!(vanilla_backups.is_empty());

        // Forge profile must NEVER create sodium-options.json or c2me.toml (only DistantHorizons if active)
        let (forge_updated, _) = reoptimize_worldgen_mod_configs(
            &paths,
            profile_id,
            &hw,
            ModLoaderKind::Forge,
            1_700_000_000,
        )
        .await?;
        assert!(forge_updated.is_empty());

        // Enable DistantHorizons on Forge: must ONLY generate DistantHorizons.toml
        tokio::fs::write(mods_dir.join("DistantHorizons-3.0.jar"), b"jar").await?;
        let (forge_dh_updated, _) = reoptimize_worldgen_mod_configs(
            &paths,
            profile_id,
            &hw,
            ModLoaderKind::Forge,
            1_700_000_000,
        )
        .await?;
        assert_eq!(forge_dh_updated, vec!["config/DistantHorizons.toml"]);
        assert!(!config_dir.join("sodium-options.json").exists());
        let _ = tokio::fs::remove_file(mods_dir.join("DistantHorizons-3.0.jar")).await;
        let _ = tokio::fs::remove_file(config_dir.join("DistantHorizons.toml")).await;

        // NeoForge with active Sodium & DH must tune both Sodium and DH, but NEVER C2ME
        tokio::fs::write(mods_dir.join("sodium-neoforge-0.6.5+mc1.21.1.jar"), b"jar").await?;
        tokio::fs::write(mods_dir.join("DistantHorizons-3.0.jar"), b"jar").await?;
        let (nf_updated, _) = reoptimize_worldgen_mod_configs(
            &paths,
            profile_id,
            &hw,
            ModLoaderKind::NeoForge,
            1_700_000_000,
        )
        .await?;
        assert_eq!(
            nf_updated,
            vec!["config/sodium-options.json", "config/DistantHorizons.toml"]
        );
        let _ = tokio::fs::remove_file(mods_dir.join("sodium-neoforge-0.6.5+mc1.21.1.jar")).await;
        let _ = tokio::fs::remove_file(mods_dir.join("DistantHorizons-3.0.jar")).await;
        let _ = tokio::fs::remove_file(config_dir.join("sodium-options.json")).await;
        let _ = tokio::fs::remove_file(config_dir.join("DistantHorizons.toml")).await;

        // Fabric profile re-optimizes only active Sodium & C2ME, backing up old c2me.toml
        let (updated, backups) = reoptimize_worldgen_mod_configs(
            &paths,
            profile_id,
            &hw,
            ModLoaderKind::Fabric,
            1_700_000_000,
        )
        .await?;
        assert_eq!(
            updated,
            vec!["config/sodium-options.json", "config/c2me.toml"]
        );
        assert_eq!(backups, vec!["config/c2me.toml.bak"]);
        assert!(!config_dir.join("DistantHorizons.toml").exists());

        let old_bak = tokio::fs::read_to_string(config_dir.join("c2me.toml.bak")).await?;
        assert_eq!(old_bak, "globalExecutorParallelism = 9\n");

        let new_c2me = tokio::fs::read_to_string(config_dir.join("c2me.toml")).await?;
        assert!(new_c2me.contains("globalExecutorParallelism = 4"));

        // Running a second time preserves the original .bak and writes a timestamped .bak
        let (_, backups2) = reoptimize_worldgen_mod_configs(
            &paths,
            profile_id,
            &hw,
            ModLoaderKind::Fabric,
            1_700_000_555,
        )
        .await?;
        assert!(backups2.contains(&"config/c2me.toml.1700000555.bak".to_string()));
        assert!(backups2.contains(&"config/sodium-options.json.bak".to_string()));
        assert_eq!(
            tokio::fs::read_to_string(config_dir.join("c2me.toml.bak")).await?,
            "globalExecutorParallelism = 9\n"
        );

        let _ = tokio::fs::remove_dir_all(&tmp).await;
        Ok(())
    }
}
