use std::path::Path;

use crate::core::content::{ContentKind, InstanceContentIndex};
use crate::core::hardware::HardwareInfo;
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

    let index = InstanceContentIndex::load(&paths.instance_content_index_path(profile_id)).await;
    for entry in &index.entries {
        if entry.kind != ContentKind::Mod || entry.file_name.ends_with(".disabled") {
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

    let mods_dir = paths.instance_mods_dir(profile_id);
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

/// Complete Sodium 0.8.x JSON schema (all 5 sections populated so Gson never hits NPE).
#[must_use]
pub fn build_sodium_options_json(logical_cores: usize) -> String {
    let chunk_builder_threads = (logical_cores / 2).clamp(1, 6);
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
            "chunk_build_defer_mode": "ALWAYS",
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

/// Verified C2ME 0.4.x (`version = 3`) TOML configuration with safe parallelism ceiling for laptops.
#[must_use]
pub fn build_c2me_toml(logical_cores: usize) -> String {
    let parallelism = (logical_cores / 2).clamp(2, 6);
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

async fn write_if_missing_atomic(path: &Path, content: &str) -> AppResult<bool> {
    if tokio::fs::try_exists(path).await? {
        return Ok(false);
    }
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let tmp_path = path.with_extension("tmp");
    tokio::fs::write(&tmp_path, content.as_bytes()).await?;
    tokio::fs::rename(&tmp_path, path).await?;
    Ok(true)
}

/// Seeds hardware-tuned initial configs for active worldgen/rendering mods ONLY if each file does not exist.
/// Returns human-readable log lines describing which files were created.
pub async fn ensure_worldgen_mod_configs(
    paths: &LauncherPaths,
    profile_id: &str,
    hw: &HardwareInfo,
) -> AppResult<Vec<String>> {
    let active = detect_active_worldgen_mods(paths, profile_id).await;
    if !active.has_sodium && !active.has_c2me && !active.has_distant_horizons {
        return Ok(Vec::new());
    }

    let config_dir = paths.instance_config_dir(profile_id);
    let mut created = Vec::new();

    if active.has_sodium {
        let sodium_path = config_dir.join("sodium-options.json");
        let content = build_sodium_options_json(hw.logical_cores);
        if !content.is_empty() && write_if_missing_atomic(&sodium_path, &content).await? {
            let threads = (hw.logical_cores / 2).clamp(1, 6);
            created.push(format!(
                "config/sodium-options.json (chunk_builder_threads={threads}, defer=ALWAYS)"
            ));
        }
    }

    if active.has_c2me {
        let c2me_path = config_dir.join("c2me.toml");
        let content = build_c2me_toml(hw.logical_cores);
        if write_if_missing_atomic(&c2me_path, &content).await? {
            let parallelism = (hw.logical_cores / 2).clamp(2, 6);
            created.push(format!(
                "config/c2me.toml (globalExecutorParallelism={parallelism}, priority=LOW)"
            ));
        }
    }

    if active.has_distant_horizons {
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

#[cfg(test)]
mod tests {
    use super::{
        build_c2me_toml, build_distant_horizons_toml, build_sodium_options_json,
        ensure_worldgen_mod_configs,
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
        let sodium_raw = build_sodium_options_json(8);
        let parsed: serde_json::Value = serde_json::from_str(&sodium_raw)?;
        assert_eq!(parsed["performance"]["chunk_builder_threads"], 4);
        assert_eq!(parsed["performance"]["chunk_build_defer_mode"], "ALWAYS");
        assert!(parsed.get("quality").is_some());
        assert!(parsed.get("advanced").is_some());
        assert!(parsed.get("notifications").is_some());
        assert!(parsed.get("debug").is_some());

        let c2me_raw = build_c2me_toml(16);
        assert!(c2me_raw.contains("version = 3"));
        assert!(c2me_raw.contains("threadPoolPriorityPreset = \"LOW\""));
        assert!(c2me_raw.contains("globalExecutorParallelism = 6"));

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

        // Pre-create custom user c2me.toml — must NEVER be overwritten
        let config_dir = paths.instance_config_dir(profile_id);
        tokio::fs::create_dir_all(&config_dir).await?;
        tokio::fs::write(config_dir.join("c2me.toml"), b"# custom user c2me\n").await?;

        let hw = sample_hw(8, 16_384);
        let created = ensure_worldgen_mod_configs(&paths, profile_id, &hw).await?;
        assert_eq!(created.len(), 1);
        assert!(created[0].contains("sodium-options.json"));

        assert!(tokio::fs::try_exists(config_dir.join("sodium-options.json")).await?);
        assert!(!tokio::fs::try_exists(config_dir.join("DistantHorizons.toml")).await?);
        let c2me_after = tokio::fs::read_to_string(config_dir.join("c2me.toml")).await?;
        assert_eq!(c2me_after, "# custom user c2me\n");

        // Second run must be a no-op
        let created_second = ensure_worldgen_mod_configs(&paths, profile_id, &hw).await?;
        assert!(created_second.is_empty());

        let _ = tokio::fs::remove_dir_all(&tmp).await;
        Ok(())
    }
}
