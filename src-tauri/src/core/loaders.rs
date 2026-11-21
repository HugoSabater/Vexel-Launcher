use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::core::downloader::DownloadArtifact;
use crate::core::instance::ModLoaderKind;
use crate::core::manifest::{maven_coords_to_relative_path, ArgumentsBlock, DownloadPlan};
use crate::core::paths::LauncherPaths;
use crate::error::{AppError, AppResult};

pub const FABRIC_META_BASE_URL: &str = "https://meta.fabricmc.net/v2";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FabricLoaderVersionEntry {
    pub loader: FabricLoaderMeta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FabricLoaderMeta {
    pub version: String,
    pub stable: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FabricProfileJson {
    pub id: String,
    pub inherits_from: Option<String>,
    pub main_class: String,
    pub arguments: Option<ArgumentsBlock>,
    #[serde(default)]
    pub libraries: Vec<FabricLibrary>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FabricLibrary {
    pub name: String,
    pub url: Option<String>,
    pub sha1: Option<String>,
    pub size: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct ResolvedLoaderOverlay {
    pub loader_version: String,
    pub main_class: String,
    pub extra_jvm_args: Vec<String>,
    pub extra_game_args: Vec<String>,
    pub artifacts: Vec<DownloadArtifact>,
    pub classpath_entries: Vec<PathBuf>,
}

#[derive(Debug, Clone, Copy)]
pub struct MavenLoaderDescriptor {
    pub kind: ModLoaderKind,
    pub maven_base_url: &'static str,
    pub group_id: &'static str,
    pub artifact_id: &'static str,
}

pub const FORGE_DESCRIPTOR: MavenLoaderDescriptor = MavenLoaderDescriptor {
    kind: ModLoaderKind::Forge,
    maven_base_url: "https://maven.minecraftforge.net",
    group_id: "net.minecraftforge",
    artifact_id: "forge",
};

pub const NEOFORGE_DESCRIPTOR: MavenLoaderDescriptor = MavenLoaderDescriptor {
    kind: ModLoaderKind::NeoForge,
    maven_base_url: "https://maven.neoforged.net/releases",
    group_id: "net.neoforged",
    artifact_id: "neoforge",
};

pub fn build_installer_maven_url(
    desc: &MavenLoaderDescriptor,
    version: &str,
) -> AppResult<String> {
    if version.trim().is_empty() {
        return Err(AppError::LoaderError(format!(
            "{:?} version cannot be empty",
            desc.kind
        )));
    }
    let coords = format!(
        "{}:{}:{}:installer",
        desc.group_id,
        desc.artifact_id,
        version.trim()
    );
    let rel_path = maven_coords_to_relative_path(&coords)?;
    let rel_url = rel_path.to_string_lossy().replace('\\', "/");
    Ok(format!("{}/{}", desc.maven_base_url, rel_url))
}

pub async fn fetch_fabric_loader_versions(
    client: &reqwest::Client,
    mc_version: &str,
) -> AppResult<Vec<FabricLoaderVersionEntry>> {
    let url = format!("{FABRIC_META_BASE_URL}/versions/loader/{mc_version}");
    let entries: Vec<FabricLoaderVersionEntry> =
        client.get(&url).send().await?.error_for_status()?.json().await?;
    if entries.is_empty() {
        return Err(AppError::LoaderError(format!(
            "No Fabric loader versions available for Minecraft {mc_version}"
        )));
    }
    Ok(entries)
}

fn build_fabric_overlay_from_profile(
    profile: FabricProfileJson,
    loader_version: String,
    paths: &LauncherPaths,
) -> AppResult<ResolvedLoaderOverlay> {
    let mut artifacts = Vec::new();
    let mut classpath_entries = Vec::new();

    for lib in profile.libraries {
        let rel_path = maven_coords_to_relative_path(&lib.name)?;
        let rel_str = rel_path.to_string_lossy().replace('\\', "/");
        let base_url = lib
            .url
            .unwrap_or_else(|| "https://maven.fabricmc.net/".to_string());
        let url = format!("{}/{rel_str}", base_url.trim_end_matches('/'));
        let dest = paths.shared_libraries_dir().join(&rel_path);

        classpath_entries.push(dest.clone());
        artifacts.push(DownloadArtifact {
            relative_key: format!("libraries/{rel_str}"),
            url,
            destination: dest,
            expected_sha1: lib.sha1,
            expected_size: lib.size,
        });
    }

    let mut extra_jvm_args = Vec::new();
    let mut extra_game_args = Vec::new();
    if let Some(args) = profile.arguments {
        for val in args.jvm {
            if let Some(s) = val.as_str() {
                extra_jvm_args.push(s.to_string());
            }
        }
        for val in args.game {
            if let Some(s) = val.as_str() {
                extra_game_args.push(s.to_string());
            }
        }
    }

    Ok(ResolvedLoaderOverlay {
        loader_version,
        main_class: profile.main_class,
        extra_jvm_args,
        extra_game_args,
        artifacts,
        classpath_entries,
    })
}

pub async fn resolve_fabric_overlay(
    client: &reqwest::Client,
    mc_version: &str,
    loader_version: Option<&str>,
    paths: &LauncherPaths,
) -> AppResult<ResolvedLoaderOverlay> {
    let resolved_ver = match loader_version.map(str::trim).filter(|s| !s.is_empty()) {
        Some(v) => v.to_string(),
        None => {
            let versions = fetch_fabric_loader_versions(client, mc_version).await?;
            versions
                .iter()
                .find(|entry| entry.loader.stable)
                .or_else(|| versions.first())
                .map(|entry| entry.loader.version.clone())
                .ok_or_else(|| {
                    AppError::LoaderError(format!(
                        "Unable to select Fabric loader for {mc_version}"
                    ))
                })?
        }
    };

    let version_id = format!("fabric-loader-{resolved_ver}-{mc_version}");
    let cached_json = paths.version_json_path(&version_id);

    let raw = if tokio::fs::try_exists(&cached_json).await? {
        tokio::fs::read_to_string(&cached_json).await?
    } else {
        let url =
            format!("{FABRIC_META_BASE_URL}/versions/loader/{mc_version}/{resolved_ver}/profile/json");
        let text = client
            .get(&url)
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;

        let version_dir = paths.version_dir(&version_id);
        tokio::fs::create_dir_all(&version_dir).await?;
        tokio::fs::write(&cached_json, text.as_bytes()).await?;
        text
    };

    let profile: FabricProfileJson = serde_json::from_str(&raw)?;
    build_fabric_overlay_from_profile(profile, resolved_ver, paths)
}

pub fn merge_overlay_into_plan(
    base_plan: &mut DownloadPlan,
    overlay: ResolvedLoaderOverlay,
) -> (String, Vec<String>, Vec<String>) {
    let mut merged_classpath = overlay.classpath_entries;
    merged_classpath.append(&mut base_plan.classpath_entries);
    base_plan.classpath_entries = merged_classpath;

    let mut overlay_artifacts = overlay.artifacts;
    base_plan.artifacts.append(&mut overlay_artifacts);

    (
        overlay.main_class,
        overlay.extra_jvm_args,
        overlay.extra_game_args,
    )
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{
        build_fabric_overlay_from_profile, build_installer_maven_url, merge_overlay_into_plan,
        FabricProfileJson, FORGE_DESCRIPTOR, NEOFORGE_DESCRIPTOR,
    };
    use crate::core::manifest::DownloadPlan;
    use crate::core::paths::LauncherPaths;

    const SAMPLE_FABRIC_PROFILE_JSON: &str = r#"{
        "id": "fabric-loader-0.16.10-1.21.1",
        "inheritsFrom": "1.21.1",
        "mainClass": "net.fabricmc.loader.impl.launch.knot.KnotClient",
        "arguments": {
            "jvm": ["-DFabricMcEmu=net.minecraft.client.main.Main"],
            "game": []
        },
        "libraries": [
            {
                "name": "net.fabricmc:sponge-mixin:0.15.4+mixin.0.8.7",
                "url": "https://maven.fabricmc.net/"
            },
            {
                "name": "net.fabricmc:fabric-loader:0.16.10",
                "url": "https://maven.fabricmc.net/"
            }
        ]
    }"#;

    #[test]
    fn test_fabric_profile_overlay_and_plan_merge() -> Result<(), Box<dyn std::error::Error>> {
        let profile: FabricProfileJson = serde_json::from_str(SAMPLE_FABRIC_PROFILE_JSON)?;
        let paths = LauncherPaths::with_root(PathBuf::from("test-root"));
        let overlay =
            build_fabric_overlay_from_profile(profile, "0.16.10".to_string(), &paths)?;

        assert_eq!(
            overlay.main_class,
            "net.fabricmc.loader.impl.launch.knot.KnotClient"
        );
        assert_eq!(overlay.artifacts.len(), 2);
        assert_eq!(
            overlay.artifacts[0].url,
            "https://maven.fabricmc.net/net/fabricmc/sponge-mixin/0.15.4+mixin.0.8.7/sponge-mixin-0.15.4+mixin.0.8.7.jar"
        );

        let mut base_plan = DownloadPlan {
            artifacts: Vec::new(),
            classpath_entries: vec![PathBuf::from("vanilla-client.jar")],
            native_archives: Vec::new(),
            logging_jvm_arg: None,
        };

        let (main_class, extra_jvm, _) = merge_overlay_into_plan(&mut base_plan, overlay);
        assert_eq!(
            main_class,
            "net.fabricmc.loader.impl.launch.knot.KnotClient"
        );
        assert_eq!(
            extra_jvm,
            vec!["-DFabricMcEmu=net.minecraft.client.main.Main"]
        );
        assert_eq!(base_plan.classpath_entries.len(), 3);
        assert_eq!(base_plan.artifacts.len(), 2);
        Ok(())
    }

    #[test]
    fn test_forge_and_neoforge_maven_installer_urls() -> Result<(), Box<dyn std::error::Error>> {
        let forge_url = build_installer_maven_url(&FORGE_DESCRIPTOR, "1.20.1-47.3.0")?;
        assert_eq!(
            forge_url,
            "https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.3.0/forge-1.20.1-47.3.0-installer.jar"
        );

        let neoforge_url = build_installer_maven_url(&NEOFORGE_DESCRIPTOR, "21.1.77")?;
        assert_eq!(
            neoforge_url,
            "https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.77/neoforge-21.1.77-installer.jar"
        );
        Ok(())
    }
}
