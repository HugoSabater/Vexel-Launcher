use std::fs::File;
use std::io::Write;
use std::path::Path;

use sha1::{Digest, Sha1};
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;

use crate::core::instance::validate_profile_id;
use crate::core::paths::LauncherPaths;
use crate::error::{AppError, AppResult};

const SKIN_PACK_FILENAME: &str = "_launcher_skin.zip";
const SKIN_PACK_STAMP_FILENAME: &str = ".launcher_skin.sha1";
const SKIN_PACK_FORMAT_VERSION: &str = "v3";
const SKIN_PACK_ENTRY: &str = "\"file/_launcher_skin.zip\"";

const DEFAULT_SKIN_NAMES: &[&str] = &[
    "alex", "ari", "efe", "kai", "makena", "noor", "steve", "sunny", "zuri",
];

fn build_skin_zip_blocking(skin_bytes: &[u8], zip_path: &Path) -> AppResult<()> {
    if let Some(parent) = zip_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let file = File::create(zip_path)?;
    let mut writer = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    let mcmeta = r#"{
  "pack": {
    "pack_format": 34,
    "supported_formats": [15, 69],
    "min_format": 15,
    "max_format": 99,
    "description": "Vexel Launcher - Skin personalizada"
  }
}"#;
    writer.start_file("pack.mcmeta", options)?;
    writer.write_all(mcmeta.as_bytes())?;

    // Modern Minecraft (1.19.3+) default player skins (wide + slim)
    for variant in ["wide", "slim"] {
        for name in DEFAULT_SKIN_NAMES {
            let entry_path = format!("assets/minecraft/textures/entity/player/{variant}/{name}.png");
            writer.start_file(entry_path, options)?;
            writer.write_all(skin_bytes)?;
        }
    }

    // Legacy Minecraft (<= 1.19.2) steve.png & alex.png
    for legacy in ["steve", "alex"] {
        let entry_path = format!("assets/minecraft/textures/entity/{legacy}.png");
        writer.start_file(entry_path, options)?;
        writer.write_all(skin_bytes)?;
    }

    writer.finish()?;
    Ok(())
}

fn parse_quoted_resource_pack_list(inner: &str) -> Vec<String> {
    let mut entries = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut escaped = false;

    for ch in inner.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }
        match ch {
            '\\' if in_quotes => {
                current.push(ch);
                escaped = true;
            }
            '"' => {
                in_quotes = !in_quotes;
                current.push(ch);
            }
            ',' if !in_quotes => {
                let trimmed = current.trim();
                if !trimmed.is_empty() {
                    entries.push(trimmed.to_string());
                }
                current.clear();
            }
            _ => current.push(ch),
        }
    }

    let trimmed = current.trim();
    if !trimmed.is_empty() {
        entries.push(trimmed.to_string());
    }
    entries
}

#[must_use]
pub fn update_options_txt_resource_packs(content: &str, include_skin_pack: bool) -> String {
    let line_ending = if content.contains("\r\n") { "\r\n" } else { "\n" };
    let mut lines: Vec<String> = content.lines().map(str::to_string).collect();
    let mut found = false;

    for line in &mut lines {
        if let Some(rest) = line.strip_prefix("resourcePacks:") {
            found = true;
            let trimmed = rest.trim();
            let inner = trimmed
                .strip_prefix('[')
                .and_then(|s| s.strip_suffix(']'))
                .unwrap_or("");

            let mut entries = parse_quoted_resource_pack_list(inner);

            entries.retain(|e| e != SKIN_PACK_ENTRY);
            if include_skin_pack {
                if !entries.iter().any(|e| e == "\"vanilla\"") {
                    entries.insert(0, "\"vanilla\"".to_string());
                }
                entries.push(SKIN_PACK_ENTRY.to_string());
            }

            *line = format!("resourcePacks:[{}]", entries.join(","));
            break;
        }
    }

    if !found && include_skin_pack {
        lines.push(format!("resourcePacks:[\"vanilla\",{SKIN_PACK_ENTRY}]"));
    }

    if lines.is_empty() {
        String::new()
    } else {
        format!("{}{line_ending}", lines.join(line_ending))
    }
}

pub async fn sync_instance_skin_pack(
    paths: &LauncherPaths,
    profile_id: &str,
    apply_skin_ingame: bool,
    skin_path_override: Option<&str>,
) -> AppResult<()> {
    validate_profile_id(profile_id)?;
    paths.ensure_instance_dirs(profile_id).await?;

    let options_path = paths.instance_dir(profile_id).join("options.txt");
    let existing_options = if tokio::fs::try_exists(&options_path).await? {
        tokio::fs::read_to_string(&options_path).await?
    } else {
        String::new()
    };

    let rp_dir = paths.instance_resourcepacks_dir(profile_id);
    let legacy_stamp_path = rp_dir.join(SKIN_PACK_STAMP_FILENAME);
    if tokio::fs::try_exists(&legacy_stamp_path).await.unwrap_or(false) {
        let _ = tokio::fs::remove_file(&legacy_stamp_path).await;
    }

    if !apply_skin_ingame {
        if !existing_options.is_empty() {
            let updated = update_options_txt_resource_packs(&existing_options, false);
            if updated != existing_options {
                tokio::fs::write(&options_path, updated.as_bytes()).await?;
            }
        }
        return Ok(());
    }

    let skin_candidate = skin_path_override
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| paths.custom_skin_path());

    if !tokio::fs::try_exists(&skin_candidate).await? {
        return Ok(());
    }

    let skin_bytes = tokio::fs::read(&skin_candidate).await?;
    let zip_path = rp_dir.join(SKIN_PACK_FILENAME);
    let stamp_path = paths.instance_dir(profile_id).join(SKIN_PACK_STAMP_FILENAME);

    let expected_stamp = format!("{SKIN_PACK_FORMAT_VERSION}:{}", hex::encode(Sha1::digest(&skin_bytes)));
    let zip_exists = tokio::fs::try_exists(&zip_path).await?;
    let existing_stamp = if tokio::fs::try_exists(&stamp_path).await? {
        tokio::fs::read_to_string(&stamp_path).await.unwrap_or_default()
    } else {
        String::new()
    };

    if !zip_exists || existing_stamp.trim() != expected_stamp {
        let zip_clone = zip_path.clone();
        tokio::task::spawn_blocking(move || build_skin_zip_blocking(&skin_bytes, &zip_clone))
            .await
            .map_err(|err| AppError::ContentError(format!("Skin pack build task failed: {err}")))??;
        tokio::fs::write(&stamp_path, expected_stamp.as_bytes()).await?;
    }

    let updated_options = update_options_txt_resource_packs(&existing_options, true);
    if updated_options != existing_options {
        tokio::fs::write(&options_path, updated_options.as_bytes()).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::update_options_txt_resource_packs;

    #[test]
    fn test_update_options_txt_resource_packs_add_and_remove() {
        let initial = "fov:0.0\nresourcePacks:[\"vanilla\",\"file/faithful.zip\"]\nlang:es_es\n";
        let added = update_options_txt_resource_packs(initial, true);
        assert!(added.contains("fov:0.0"));
        assert!(added.contains("lang:es_es"));
        assert!(added.contains(
            "resourcePacks:[\"vanilla\",\"file/faithful.zip\",\"file/_launcher_skin.zip\"]"
        ));

        // Idempotent second pass
        let added_again = update_options_txt_resource_packs(&added, true);
        assert_eq!(added, added_again);

        // Clean removal
        let removed = update_options_txt_resource_packs(&added, false);
        assert!(removed.contains("resourcePacks:[\"vanilla\",\"file/faithful.zip\"]"));
        assert!(!removed.contains("_launcher_skin.zip"));

        // Fresh options.txt creation
        let fresh = update_options_txt_resource_packs("", true);
        assert_eq!(
            fresh,
            "resourcePacks:[\"vanilla\",\"file/_launcher_skin.zip\"]\n"
        );

        // Preserves CRLF and resource pack names containing commas
        let crlf_with_comma =
            "fov:0.0\r\nresourcePacks:[\"vanilla\",\"file/Pack, v2.zip\"]\r\nlang:es_es\r\n";
        let updated = update_options_txt_resource_packs(crlf_with_comma, true);
        assert!(updated.contains("\r\n"));
        assert!(updated.contains(
            "resourcePacks:[\"vanilla\",\"file/Pack, v2.zip\",\"file/_launcher_skin.zip\"]"
        ));
    }

    #[tokio::test]
    async fn test_sync_instance_skin_pack_v3_cache_skips_rebuild() -> Result<(), Box<dyn std::error::Error>> {
        let tmp = std::env::temp_dir().join(format!(
            "vexel-skin-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let paths = crate::core::paths::LauncherPaths::with_root(tmp.clone());
        paths.ensure_base_dirs().await?;
        tokio::fs::write(paths.custom_skin_path(), b"\x89PNG\r\n\x1a\nFAKE_SKIN").await?;

        let rp_dir = paths.instance_resourcepacks_dir("demo");
        paths.ensure_instance_dirs("demo").await?;
        let legacy_stamp = rp_dir.join(".launcher_skin.sha1");
        tokio::fs::write(&legacy_stamp, b"v2:legacy").await?;

        super::sync_instance_skin_pack(&paths, "demo", true, None).await?;
        let zip_path = rp_dir.join("_launcher_skin.zip");
        let new_stamp_path = paths.instance_dir("demo").join(".launcher_skin.sha1");
        let stamp = tokio::fs::read_to_string(&new_stamp_path).await?;
        assert!(stamp.starts_with("v3:"));
        assert!(zip_path.exists());
        assert!(!legacy_stamp.exists());

        // Write sentinel over zip; second sync with identical skin hash must NOT overwrite zip
        tokio::fs::write(&zip_path, b"SENTINEL_ZIP").await?;
        super::sync_instance_skin_pack(&paths, "demo", true, None).await?;
        assert_eq!(tokio::fs::read(&zip_path).await?, b"SENTINEL_ZIP");

        let _ = tokio::fs::remove_dir_all(&tmp).await;
        Ok(())
    }
}
