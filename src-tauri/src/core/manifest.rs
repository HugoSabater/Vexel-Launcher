use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::core::downloader::DownloadArtifact;
use crate::core::paths::LauncherPaths;
use crate::error::{AppError, AppResult};

pub const MOJANG_VERSION_MANIFEST_V2_URL: &str =
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionManifestList {
    pub latest: LatestVersions,
    pub versions: Vec<VersionSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatestVersions {
    pub release: String,
    pub snapshot: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionSummary {
    pub id: String,
    #[serde(rename = "type")]
    pub version_type: String,
    pub url: String,
    pub sha1: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionManifest {
    pub id: String,
    #[serde(rename = "type", default)]
    pub version_type: Option<String>,
    pub main_class: String,
    pub java_version: Option<JavaVersionSpec>,
    pub asset_index: Option<AssetIndexRef>,
    pub assets: Option<String>,
    pub downloads: Option<VersionDownloads>,
    #[serde(default)]
    pub libraries: Vec<Library>,
    pub arguments: Option<ArgumentsBlock>,
    pub minecraft_arguments: Option<String>,
    pub inherits_from: Option<String>,
    pub logging: Option<LoggingSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoggingSpec {
    pub client: Option<ClientLoggingSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientLoggingSpec {
    pub argument: String,
    pub file: LoggingFile,
    #[serde(rename = "type")]
    pub log_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoggingFile {
    pub id: String,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaVersionSpec {
    pub component: String,
    pub major_version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetIndexRef {
    pub id: String,
    pub sha1: String,
    pub size: u64,
    pub total_size: Option<u64>,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionDownloads {
    pub client: Option<DownloadFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadFile {
    pub path: Option<String>,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Library {
    pub name: String,
    pub url: Option<String>,
    pub downloads: Option<LibraryDownloads>,
    pub rules: Option<Vec<Rule>>,
    pub natives: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryDownloads {
    pub artifact: Option<DownloadFile>,
    pub classifiers: Option<HashMap<String, DownloadFile>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rule {
    pub action: String,
    pub os: Option<OsRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsRule {
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArgumentsBlock {
    #[serde(default)]
    pub game: Vec<serde_json::Value>,
    #[serde(default)]
    pub jvm: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetIndexFile {
    pub objects: HashMap<String, AssetObject>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetObject {
    pub hash: String,
    pub size: u64,
}

#[derive(Debug, Clone)]
pub struct DownloadPlan {
    pub artifacts: Vec<DownloadArtifact>,
    pub classpath_entries: Vec<PathBuf>,
    pub native_archives: Vec<PathBuf>,
    pub logging_jvm_arg: Option<String>,
}

#[must_use]
pub fn library_applies_to_windows(lib: &Library) -> bool {
    let Some(rules) = &lib.rules else {
        return true;
    };
    if rules.is_empty() {
        return true;
    }

    let mut allowed = false;
    for rule in rules {
        let os_matches = match &rule.os {
            None => true,
            Some(os) => os.name.as_deref() == Some("windows"),
        };

        if os_matches {
            allowed = rule.action == "allow";
        }
    }
    allowed
}

pub fn maven_coords_to_relative_path(coords: &str) -> AppResult<PathBuf> {
    let mut parts = coords.split(':');
    let group = parts
        .next()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::ManifestError(format!("Invalid maven coords: {coords}")))?;
    let artifact = parts
        .next()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::ManifestError(format!("Invalid maven coords: {coords}")))?;
    let version = parts
        .next()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::ManifestError(format!("Invalid maven coords: {coords}")))?;
    let classifier_raw = parts.next();

    let (version_clean, ext) = match version.split_once('@') {
        Some((v, e)) => (v, e),
        None => (version, "jar"),
    };

    let (classifier_clean, final_ext) = match classifier_raw {
        Some(c) => match c.split_once('@') {
            Some((cls, e)) => (Some(cls), e),
            None => (Some(c), ext),
        },
        None => (None, ext),
    };

    let mut path = PathBuf::new();
    for segment in group.split('.') {
        path.push(segment);
    }
    path.push(artifact);
    path.push(version_clean);

    let file_name = match classifier_clean {
        Some(cls) if !cls.is_empty() => format!("{artifact}-{version_clean}-{cls}.{final_ext}"),
        _ => format!("{artifact}-{version_clean}.{final_ext}"),
    };
    path.push(file_name);
    Ok(path)
}

#[must_use]
pub fn extract_game_arguments(manifest: &VersionManifest) -> Vec<String> {
    if let Some(args) = &manifest.arguments {
        let mut out = Vec::new();
        for item in &args.game {
            if let Some(s) = item.as_str() {
                out.push(s.to_string());
            }
        }
        return out;
    }

    if let Some(legacy) = &manifest.minecraft_arguments {
        return legacy.split_whitespace().map(str::to_string).collect();
    }

    Vec::new()
}

pub async fn fetch_version_catalog(client: &reqwest::Client) -> AppResult<VersionManifestList> {
    let response = client
        .get(MOJANG_VERSION_MANIFEST_V2_URL)
        .send()
        .await?
        .error_for_status()?;
    let catalog: VersionManifestList = response.json().await?;
    Ok(catalog)
}

pub async fn fetch_or_load_version_manifest(
    client: &reqwest::Client,
    version_id: &str,
    paths: &LauncherPaths,
) -> AppResult<VersionManifest> {
    let cached_path = paths.version_json_path(version_id);
    if tokio::fs::try_exists(&cached_path).await? {
        let raw = tokio::fs::read_to_string(&cached_path).await?;
        let manifest: VersionManifest = serde_json::from_str(&raw)?;
        return Ok(manifest);
    }

    let catalog = fetch_version_catalog(client).await?;
    let summary = catalog
        .versions
        .into_iter()
        .find(|v| v.id == version_id)
        .ok_or_else(|| {
            AppError::ManifestError(format!(
                "Minecraft version '{version_id}' not found in Mojang catalog"
            ))
        })?;

    let raw = client
        .get(&summary.url)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;

    let manifest: VersionManifest = serde_json::from_str(&raw)?;
    let version_dir = paths.version_dir(version_id);
    tokio::fs::create_dir_all(&version_dir).await?;
    tokio::fs::write(&cached_path, raw.as_bytes()).await?;
    Ok(manifest)
}

pub async fn fetch_or_load_asset_index(
    client: &reqwest::Client,
    manifest: &VersionManifest,
    paths: &LauncherPaths,
) -> AppResult<AssetIndexFile> {
    let index_ref = manifest.asset_index.as_ref().ok_or_else(|| {
        AppError::ManifestError(format!(
            "Version '{}' does not define an assetIndex",
            manifest.id
        ))
    })?;

    let index_path = paths
        .shared_assets_indexes_dir()
        .join(format!("{}.json", index_ref.id));

    if tokio::fs::try_exists(&index_path).await? {
        let raw = tokio::fs::read_to_string(&index_path).await?;
        let parsed: AssetIndexFile = serde_json::from_str(&raw)?;
        return Ok(parsed);
    }

    let raw = client
        .get(&index_ref.url)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;

    let parsed: AssetIndexFile = serde_json::from_str(&raw)?;
    tokio::fs::create_dir_all(paths.shared_assets_indexes_dir()).await?;
    tokio::fs::write(&index_path, raw.as_bytes()).await?;
    Ok(parsed)
}

pub fn build_download_plan(
    manifest: &VersionManifest,
    asset_index: &AssetIndexFile,
    paths: &LauncherPaths,
) -> AppResult<DownloadPlan> {
    let mut artifacts = Vec::new();
    let mut classpath_entries = Vec::new();
    let mut native_archives = Vec::new();

    if let Some(downloads) = &manifest.downloads {
        if let Some(client_dl) = &downloads.client {
            let client_dest = paths.version_jar_path(&manifest.id);
            classpath_entries.push(client_dest.clone());
            artifacts.push(DownloadArtifact {
                relative_key: format!("versions/{}/{}.jar", manifest.id, manifest.id),
                url: client_dl.url.clone(),
                destination: client_dest,
                expected_sha1: client_dl.sha1.clone(),
                expected_size: client_dl.size,
            });
        }
    }

    for lib in &manifest.libraries {
        if !library_applies_to_windows(lib) {
            continue;
        }

        if let Some(dl) = &lib.downloads {
            if let Some(artifact) = &dl.artifact {
                let rel_path = match &artifact.path {
                    Some(p) => PathBuf::from(p),
                    None => maven_coords_to_relative_path(&lib.name)?,
                };
                let dest = paths.shared_libraries_dir().join(&rel_path);
                let rel_key = format!("libraries/{}", rel_path.to_string_lossy().replace('\\', "/"));

                classpath_entries.push(dest.clone());
                artifacts.push(DownloadArtifact {
                    relative_key: rel_key,
                    url: artifact.url.clone(),
                    destination: dest,
                    expected_sha1: artifact.sha1.clone(),
                    expected_size: artifact.size,
                });
            }

            if let Some(classifiers) = &dl.classifiers {
                let native_key = lib
                    .natives
                    .as_ref()
                    .and_then(|n| n.get("windows"))
                    .map(|k| k.replace("${arch}", "64"))
                    .unwrap_or_else(|| "natives-windows".to_string());

                if let Some(native_dl) = classifiers.get(&native_key) {
                    let rel_path = match &native_dl.path {
                        Some(p) => PathBuf::from(p),
                        None => maven_coords_to_relative_path(&lib.name)?,
                    };
                    let dest = paths.shared_libraries_dir().join(&rel_path);
                    let rel_key =
                        format!("libraries/{}", rel_path.to_string_lossy().replace('\\', "/"));

                    native_archives.push(dest.clone());
                    artifacts.push(DownloadArtifact {
                        relative_key: rel_key,
                        url: native_dl.url.clone(),
                        destination: dest,
                        expected_sha1: native_dl.sha1.clone(),
                        expected_size: native_dl.size,
                    });
                }
            }
        } else if let Some(base_url) = &lib.url {
            let rel_path = maven_coords_to_relative_path(&lib.name)?;
            let rel_str = rel_path.to_string_lossy().replace('\\', "/");
            let url = format!("{}/{rel_str}", base_url.trim_end_matches('/'));
            let dest = paths.shared_libraries_dir().join(&rel_path);

            classpath_entries.push(dest.clone());
            artifacts.push(DownloadArtifact {
                relative_key: format!("libraries/{rel_str}"),
                url,
                destination: dest,
                expected_sha1: None,
                expected_size: None,
            });
        }
    }

    for object in asset_index.objects.values() {
        if object.hash.len() < 2 {
            continue;
        }
        let prefix = &object.hash[..2];
        let rel_key = format!("assets/objects/{prefix}/{}", object.hash);
        let dest = paths
            .shared_assets_objects_dir()
            .join(prefix)
            .join(&object.hash);
        let url = format!(
            "https://resources.download.minecraft.net/{prefix}/{}",
            object.hash
        );

        artifacts.push(DownloadArtifact {
            relative_key: rel_key,
            url,
            destination: dest,
            expected_sha1: Some(object.hash.clone()),
            expected_size: Some(object.size),
        });
    }

    let mut logging_jvm_arg = None;
    if let Some(client_log) = manifest.logging.as_ref().and_then(|l| l.client.as_ref()) {
        let safe_name = std::path::Path::new(&client_log.file.id)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("client-log4j.xml");
        let dest = paths.shared_assets_log_configs_dir().join(safe_name);
        let resolved_arg = client_log
            .argument
            .replace("${path}", &dest.to_string_lossy());
        logging_jvm_arg = Some(resolved_arg);
        artifacts.push(DownloadArtifact {
            relative_key: format!("assets/log_configs/{safe_name}"),
            url: client_log.file.url.clone(),
            destination: dest,
            expected_sha1: client_log.file.sha1.clone(),
            expected_size: client_log.file.size,
        });
    }

    Ok(DownloadPlan {
        artifacts,
        classpath_entries,
        native_archives,
        logging_jvm_arg,
    })
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::path::PathBuf;

    use super::{
        build_download_plan, extract_game_arguments, library_applies_to_windows,
        maven_coords_to_relative_path, AssetIndexFile, AssetObject, VersionManifest,
    };
    use crate::core::paths::LauncherPaths;

    const SAMPLE_MANIFEST_JSON: &str = r#"{
        "id": "1.21.4",
        "type": "release",
        "mainClass": "net.minecraft.client.main.Main",
        "javaVersion": {
            "component": "java-runtime-delta",
            "majorVersion": 21
        },
        "logging": {
            "client": {
                "argument": "-Dlog4j.configurationFile=${path}",
                "file": {
                    "id": "client-1.12.xml",
                    "sha1": "1111111111111111111111111111111111111111",
                    "size": 888,
                    "url": "https://piston-data.mojang.com/v1/objects/11/client-1.12.xml"
                },
                "type": "log4j2-xml"
            }
        },
        "assetIndex": {
            "id": "19",
            "sha1": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "size": 1234,
            "totalSize": 99999,
            "url": "https://piston-meta.mojang.com/v1/packages/aa/19.json"
        },
        "downloads": {
            "client": {
                "sha1": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "size": 25000000,
                "url": "https://piston-data.mojang.com/v1/objects/bb/client.jar"
            }
        },
        "arguments": {
            "game": ["--username", "${auth_player_name}", {"rules": [{"action": "allow"}], "value": "--demo"}],
            "jvm": []
        },
        "libraries": [
            {
                "name": "com.mojang:brigadier:1.3.10",
                "downloads": {
                    "artifact": {
                        "path": "com/mojang/brigadier/1.3.10/brigadier-1.3.10.jar",
                        "sha1": "cccccccccccccccccccccccccccccccccccccccc",
                        "size": 80000,
                        "url": "https://libraries.minecraft.net/com/mojang/brigadier/1.3.10/brigadier-1.3.10.jar"
                    }
                }
            },
            {
                "name": "org.lwjgl:lwjgl:3.3.3",
                "rules": [{ "action": "allow", "os": { "name": "osx" } }],
                "downloads": {
                    "artifact": {
                        "path": "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-macos.jar",
                        "sha1": "dddddddddddddddddddddddddddddddddddddddd",
                        "size": 50000,
                        "url": "https://libraries.minecraft.net/org/lwjgl/lwjgl-macos.jar"
                    }
                }
            },
            {
                "name": "org.lwjgl:lwjgl:3.3.3:natives-windows",
                "rules": [{ "action": "allow", "os": { "name": "windows" } }],
                "downloads": {
                    "artifact": {
                        "path": "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar",
                        "sha1": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                        "size": 60000,
                        "url": "https://libraries.minecraft.net/org/lwjgl/lwjgl-natives-windows.jar"
                    }
                }
            }
        ]
    }"#;

    #[test]
    fn test_manifest_parsing_and_windows_rule_filtering() -> Result<(), Box<dyn std::error::Error>> {
        let manifest: VersionManifest = serde_json::from_str(SAMPLE_MANIFEST_JSON)?;
        assert_eq!(manifest.id, "1.21.4");
        assert_eq!(
            manifest.java_version.as_ref().map(|j| j.major_version),
            Some(21)
        );
        assert!(library_applies_to_windows(&manifest.libraries[0]));
        assert!(!library_applies_to_windows(&manifest.libraries[1]));
        assert!(library_applies_to_windows(&manifest.libraries[2]));

        let game_args = extract_game_arguments(&manifest);
        assert_eq!(game_args, vec!["--username", "${auth_player_name}"]);

        let mut objects = HashMap::new();
        objects.insert(
            "minecraft/sounds/click.ogg".to_string(),
            AssetObject {
                hash: "ab1234567890abcdef1234567890abcdef123456".to_string(),
                size: 4096,
            },
        );
        let asset_index = AssetIndexFile { objects };
        let paths = LauncherPaths::with_root(PathBuf::from("test-root"));
        let plan = build_download_plan(&manifest, &asset_index, &paths)?;

        // client.jar + 2 windows libs + 1 asset + 1 log4j xml = 5 artifacts
        assert_eq!(plan.artifacts.len(), 5);
        assert_eq!(plan.classpath_entries.len(), 3);
        assert_eq!(manifest.version_type.as_deref(), Some("release"));
        let log_arg = plan
            .logging_jvm_arg
            .as_deref()
            .ok_or("Expected logging_jvm_arg to be present")?;
        assert!(log_arg.starts_with("-Dlog4j.configurationFile="));
        assert!(log_arg.ends_with("client-1.12.xml"));
        assert!(!log_arg.contains('"'));
        Ok(())
    }

    #[test]
    fn test_maven_coords_resolution() -> Result<(), Box<dyn std::error::Error>> {
        let rel = maven_coords_to_relative_path("net.fabricmc:sponge-mixin:0.15.3+mixin.0.8.7")?;
        assert_eq!(
            rel,
            PathBuf::from("net")
                .join("fabricmc")
                .join("sponge-mixin")
                .join("0.15.3+mixin.0.8.7")
                .join("sponge-mixin-0.15.3+mixin.0.8.7.jar")
        );
        Ok(())
    }
}
