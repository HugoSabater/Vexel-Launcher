use std::collections::{BTreeMap, HashSet};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::core::paths::LauncherPaths;
use crate::core::worldgen_configs::backup_file_before_overwrite;
use crate::error::{AppError, AppResult};

const PORTABLE_EXACT_KEYS: &[&str] = &[
    "mouseSensitivity",
    "autoJump",
    "toggleSprint",
    "toggleCrouch",
    "invertYMouse",
    "rawMouseInput",
    "fov",
    "lang",
    "guiScale",
    "showSubtitles",
    "narrator",
];

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalGameOptions {
    #[serde(default = "default_true")]
    pub auto_apply_on_new_instance: bool,
    #[serde(default)]
    pub entries: BTreeMap<String, String>,
    #[serde(default)]
    pub source_profile_name: Option<String>,
    #[serde(default)]
    pub updated_at_secs: u64,
}

impl Default for GlobalGameOptions {
    fn default() -> Self {
        Self {
            auto_apply_on_new_instance: true,
            entries: BTreeMap::new(),
            source_profile_name: None,
            updated_at_secs: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct GlobalGameOptionsResponse {
    pub auto_apply_on_new_instance: bool,
    pub entries: BTreeMap<String, String>,
    pub source_profile_name: Option<String>,
    pub updated_at_secs: u64,
    pub custom_keybinds_count: usize,
}

impl From<GlobalGameOptions> for GlobalGameOptionsResponse {
    fn from(opts: GlobalGameOptions) -> Self {
        let custom_keybinds_count = opts
            .entries
            .keys()
            .filter(|k| k.starts_with("key_"))
            .count();
        Self {
            auto_apply_on_new_instance: opts.auto_apply_on_new_instance,
            entries: opts.entries,
            source_profile_name: opts.source_profile_name,
            updated_at_secs: opts.updated_at_secs,
            custom_keybinds_count,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaveGlobalGameOptionsPayload {
    pub auto_apply_on_new_instance: bool,
    #[serde(default)]
    pub entries: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApplyGlobalOptionsResult {
    pub applied_instances: usize,
    pub skipped_running: usize,
    pub backups_created: Vec<String>,
}

/// Strict whitelist of portable Minecraft `options.txt` keys.
/// Excludes `version`, `resourcePacks`, `incompatibleResourcePacks`, `renderDistance`,
/// `simulationDistance`, `enableVsync`, `prioritizeChunkUpdates`, `biomeBlendRadius`, `lastServer`, etc.
#[must_use]
pub fn is_portable_option_key(key: &str) -> bool {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return false;
    }
    trimmed.starts_with("key_")
        || trimmed.starts_with("soundCategory_")
        || PORTABLE_EXACT_KEYS.contains(&trimmed)
}

#[must_use]
pub fn extract_portable_options_from_txt(raw: &str) -> BTreeMap<String, String> {
    let mut map = BTreeMap::new();
    for line in raw.lines() {
        let clean = line.trim_end_matches('\r');
        let Some((k, v)) = clean.split_once(':') else {
            continue;
        };
        let key = k.trim();
        if is_portable_option_key(key) {
            map.insert(key.to_string(), v.to_string());
        }
    }
    map
}

/// Surgical merge of portable keys into an existing `options.txt`, preserving CRLF/LF
/// and leaving all non-portable keys (`resourcePacks`, `renderDistance`, `version`, etc.) untouched.
#[must_use]
pub fn merge_options_txt_with_portable_map(
    existing: &str,
    portable: &BTreeMap<String, String>,
) -> String {
    let eol = if existing.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let mut seen: HashSet<&str> = HashSet::new();
    let mut out_lines: Vec<String> = Vec::new();

    for raw_line in existing.lines() {
        let line = raw_line.trim_end_matches('\r');
        if let Some((k, _)) = line.split_once(':') {
            let key = k.trim();
            if is_portable_option_key(key) {
                if let Some((stored_k, stored_v)) = portable.get_key_value(key) {
                    if seen.insert(stored_k.as_str()) {
                        out_lines.push(format!("{stored_k}:{stored_v}"));
                    }
                    continue;
                }
            }
        }
        out_lines.push(line.to_string());
    }

    for (k, v) in portable {
        if is_portable_option_key(k) && !seen.contains(k.as_str()) {
            out_lines.push(format!("{k}:{v}"));
        }
    }

    let mut result = out_lines.join(eol);
    if !result.is_empty() {
        result.push_str(eol);
    }
    result
}

pub async fn load_global_options(paths: &LauncherPaths) -> GlobalGameOptions {
    let path = paths.global_options_path();
    let Ok(raw) = tokio::fs::read_to_string(&path).await else {
        return GlobalGameOptions::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

pub async fn save_global_options_atomic(
    paths: &LauncherPaths,
    opts: &GlobalGameOptions,
) -> AppResult<()> {
    paths.ensure_base_dirs().await?;
    let path = paths.global_options_path();
    let tmp = path.with_extension("json.tmp");
    let serialized = serde_json::to_vec_pretty(opts)?;
    tokio::fs::write(&tmp, &serialized).await?;
    if tokio::fs::rename(&tmp, &path).await.is_err() {
        let _ = tokio::fs::remove_file(&tmp).await;
        tokio::fs::write(&path, &serialized).await?;
    }
    Ok(())
}

pub async fn import_global_options_from_instance_dir(
    paths: &LauncherPaths,
    instance_dir: &Path,
    source_profile_name: &str,
) -> AppResult<GlobalGameOptions> {
    let options_path = instance_dir.join("options.txt");
    if !tokio::fs::try_exists(&options_path).await? {
        return Err(AppError::ConfigError(format!(
            "La instancia '{source_profile_name}' aún no tiene un archivo options.txt. Ábrela al menos una vez en Minecraft primero."
        )));
    }

    let raw = tokio::fs::read_to_string(&options_path).await?;
    let extracted = extract_portable_options_from_txt(&raw);
    if extracted.is_empty() {
        return Err(AppError::ConfigError(
            "No se encontraron ajustes portables en el options.txt seleccionado.".to_string(),
        ));
    }

    let existing = load_global_options(paths).await;
    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());

    let updated = GlobalGameOptions {
        auto_apply_on_new_instance: existing.auto_apply_on_new_instance,
        entries: extracted,
        source_profile_name: Some(source_profile_name.to_string()),
        updated_at_secs: now_secs,
    };
    save_global_options_atomic(paths, &updated).await?;
    Ok(updated)
}

pub async fn update_global_options_from_ui(
    paths: &LauncherPaths,
    payload: SaveGlobalGameOptionsPayload,
) -> AppResult<GlobalGameOptions> {
    let mut current = load_global_options(paths).await;
    current.auto_apply_on_new_instance = payload.auto_apply_on_new_instance;
    for (k, v) in payload.entries {
        if is_portable_option_key(&k) {
            current.entries.insert(k, v);
        }
    }
    current.updated_at_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    save_global_options_atomic(paths, &current).await?;
    Ok(current)
}

/// Applies global portable options to an instance's `options.txt`, creating a `.bak` backup
/// when `options.txt` already exists.
pub async fn apply_global_options_to_instance_dir(
    instance_dir: &Path,
    opts: &GlobalGameOptions,
    timestamp_secs: u64,
) -> AppResult<Option<String>> {
    if opts.entries.is_empty() {
        return Ok(None);
    }
    tokio::fs::create_dir_all(instance_dir).await?;
    let options_path = instance_dir.join("options.txt");

    let (next_content, backup_name) = if tokio::fs::try_exists(&options_path).await? {
        let bak_path = backup_file_before_overwrite(&options_path, timestamp_secs).await?;
        let bak_name = bak_path
            .and_then(|p| p.file_name().and_then(|n| n.to_str()).map(str::to_string));
        let existing = tokio::fs::read_to_string(&options_path).await?;
        (
            merge_options_txt_with_portable_map(&existing, &opts.entries),
            bak_name,
        )
    } else {
        let content = merge_options_txt_with_portable_map("", &opts.entries);
        (content, None)
    };

    let tmp_path = instance_dir.join("options.txt.tmp");
    tokio::fs::write(&tmp_path, next_content.as_bytes()).await?;
    if tokio::fs::rename(&tmp_path, &options_path).await.is_err() {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        tokio::fs::write(&options_path, next_content.as_bytes()).await?;
    }
    Ok(backup_name)
}

#[cfg(test)]
mod tests {
    use super::{
        apply_global_options_to_instance_dir, extract_portable_options_from_txt,
        import_global_options_from_instance_dir, is_portable_option_key,
        merge_options_txt_with_portable_map,
    };
    use crate::core::paths::LauncherPaths;

    #[test]
    fn test_portable_key_whitelist_excludes_graphics_and_packs() {
        assert!(is_portable_option_key("key_key.forward"));
        assert!(is_portable_option_key("mouseSensitivity"));
        assert!(is_portable_option_key("autoJump"));
        assert!(is_portable_option_key("toggleSprint"));
        assert!(is_portable_option_key("soundCategory_master"));
        assert!(is_portable_option_key("fov"));
        assert!(is_portable_option_key("lang"));

        assert!(!is_portable_option_key("version"));
        assert!(!is_portable_option_key("resourcePacks"));
        assert!(!is_portable_option_key("incompatibleResourcePacks"));
        assert!(!is_portable_option_key("renderDistance"));
        assert!(!is_portable_option_key("simulationDistance"));
        assert!(!is_portable_option_key("enableVsync"));
        assert!(!is_portable_option_key("prioritizeChunkUpdates"));
        assert!(!is_portable_option_key("biomeBlendRadius"));
        assert!(!is_portable_option_key("lastServer"));
    }

    #[tokio::test]
    async fn test_global_options_import_whitelist_and_surgical_merge()
    -> Result<(), Box<dyn std::error::Error>> {
        let tmp = std::env::temp_dir().join(format!(
            "vexel-global-opts-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let paths = LauncherPaths::with_root(tmp.clone());
        paths.ensure_base_dirs().await?;
        paths.ensure_instance_dirs("src-prof").await?;
        paths.ensure_instance_dirs("dst-prof").await?;

        // Source instance options.txt (mixed portable & non-portable keys)
        let src_txt = "version:3955\nrenderDistance:16\nresourcePacks:[\"vanilla\",\"custom.zip\"]\nfov:0.5\nmouseSensitivity:0.35\nautoJump:false\nlang:es_es\nsoundCategory_master:0.6\nkey_key.sprint:key.keyboard.r\nlastServer:play.example.com\n";
        tokio::fs::write(paths.instance_dir("src-prof").join("options.txt"), src_txt).await?;

        let imported = import_global_options_from_instance_dir(
            &paths,
            &paths.instance_dir("src-prof"),
            "Fabric 1.21.1",
        )
        .await?;
        assert_eq!(imported.entries.get("fov").map(String::as_str), Some("0.5"));
        assert_eq!(
            imported.entries.get("key_key.sprint").map(String::as_str),
            Some("key.keyboard.r")
        );
        assert!(!imported.entries.contains_key("version"));
        assert!(!imported.entries.contains_key("renderDistance"));
        assert!(!imported.entries.contains_key("resourcePacks"));
        assert!(!imported.entries.contains_key("lastServer"));

        // Target instance options.txt with CRLF, different packs & renderDistance
        let dst_crlf = "version:3465\r\nrenderDistance:8\r\nresourcePacks:[\"vanilla\",\"faithful.zip\"]\r\nfov:0.0\r\nautoJump:true\r\n";
        let dst_dir = paths.instance_dir("dst-prof");
        tokio::fs::write(dst_dir.join("options.txt"), dst_crlf).await?;

        let bak = apply_global_options_to_instance_dir(&dst_dir, &imported, 1_700_000_000).await?;
        assert_eq!(bak.as_deref(), Some("options.txt.bak"));
        assert!(dst_dir.join("options.txt.bak").exists());

        let merged = tokio::fs::read_to_string(dst_dir.join("options.txt")).await?;
        // Preserves CRLF
        assert!(merged.contains("\r\n"));
        // Preserves target non-portable keys untouched
        assert!(merged.contains("version:3465\r\n"));
        assert!(merged.contains("renderDistance:8\r\n"));
        assert!(merged.contains("resourcePacks:[\"vanilla\",\"faithful.zip\"]\r\n"));
        // Overwrites existing portable keys & appends missing ones
        assert!(merged.contains("fov:0.5\r\n"));
        assert!(merged.contains("autoJump:false\r\n"));
        assert!(merged.contains("key_key.sprint:key.keyboard.r\r\n"));
        assert!(merged.contains("soundCategory_master:0.6\r\n"));

        // Also verify LF preservation directly
        let lf_merged = merge_options_txt_with_portable_map(
            "renderDistance:10\nfov:0.0\n",
            &extract_portable_options_from_txt("fov:0.25\nlang:en_us\n"),
        );
        assert!(!lf_merged.contains("\r\n"));
        assert_eq!(lf_merged, "renderDistance:10\nfov:0.25\nlang:en_us\n");

        let _ = tokio::fs::remove_dir_all(&tmp).await;
        Ok(())
    }
}
