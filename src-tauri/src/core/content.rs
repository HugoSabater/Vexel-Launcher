use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::core::downloader::{verify_and_download_all, DownloadArtifact, DownloadProgress};
use crate::core::instance::validate_profile_id;
use crate::core::paths::LauncherPaths;
use crate::error::{AppError, AppResult};

pub const PERFORMANCE_STACK_MODS: &[(&str, &str)] = &[
    ("sodium", "Sodium"),
    ("lithium", "Lithium"),
    ("ferrite-core", "FerriteCore"),
    ("immediatelyfast", "ImmediatelyFast"),
    ("c2me-fabric", "C2ME"),
    ("distanthorizons", "Distant Horizons"),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContentKind {
    Mod,
    ResourcePack,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentItem {
    pub file_name: String,
    pub display_name: String,
    pub enabled: bool,
    pub size_bytes: u64,
    pub kind: ContentKind,
}

#[derive(Debug, Clone, Deserialize)]
struct ModrinthVersion {
    #[serde(default)]
    project_id: String,
    files: Vec<ModrinthFile>,
    #[serde(default)]
    dependencies: Vec<ModrinthDependency>,
}

#[derive(Debug, Clone, Deserialize)]
struct ModrinthDependency {
    project_id: Option<String>,
    version_id: Option<String>,
    dependency_type: String,
}

#[derive(Debug, Clone, Deserialize)]
struct ModrinthFile {
    hashes: ModrinthHashes,
    url: String,
    filename: String,
    primary: bool,
    size: u64,
}

#[derive(Debug, Clone, Deserialize)]
struct ModrinthHashes {
    sha1: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum PendingModrinthTarget {
    Project(String, String),
    Version(String),
}

fn extract_required_dependencies(deps: &[ModrinthDependency]) -> Vec<PendingModrinthTarget> {
    let mut out = Vec::new();
    for dep in deps {
        if dep.dependency_type != "required" {
            continue;
        }
        if let Some(ver_id) = dep.version_id.as_deref().filter(|s| !s.is_empty()) {
            out.push(PendingModrinthTarget::Version(ver_id.to_string()));
        } else if let Some(proj_id) = dep.project_id.as_deref().filter(|s| !s.is_empty()) {
            out.push(PendingModrinthTarget::Project(
                proj_id.to_string(),
                format!("Dependency ({proj_id})"),
            ));
        }
    }
    out
}

fn validate_file_name(file_name: &str) -> AppResult<()> {
    if file_name.is_empty()
        || file_name.contains("..")
        || file_name.contains('/')
        || file_name.contains('\\')
    {
        return Err(AppError::ContentError(format!(
            "Invalid content filename: '{file_name}'"
        )));
    }
    Ok(())
}

fn content_dir(paths: &LauncherPaths, profile_id: &str, kind: ContentKind) -> PathBuf {
    match kind {
        ContentKind::Mod => paths.instance_mods_dir(profile_id),
        ContentKind::ResourcePack => paths.instance_resourcepacks_dir(profile_id),
    }
}

fn parse_content_entry(file_name: &str, kind: ContentKind, size_bytes: u64) -> Option<ContentItem> {
    let active_ext = match kind {
        ContentKind::Mod => ".jar",
        ContentKind::ResourcePack => ".zip",
    };
    let disabled_ext = match kind {
        ContentKind::Mod => ".jar.disabled",
        ContentKind::ResourcePack => ".zip.disabled",
    };

    if let Some(stem) = file_name.strip_suffix(active_ext) {
        return Some(ContentItem {
            file_name: file_name.to_string(),
            display_name: stem.to_string(),
            enabled: true,
            size_bytes,
            kind,
        });
    }

    if let Some(stem) = file_name.strip_suffix(disabled_ext) {
        return Some(ContentItem {
            file_name: file_name.to_string(),
            display_name: stem.to_string(),
            enabled: false,
            size_bytes,
            kind,
        });
    }

    None
}

pub async fn list_instance_content(
    paths: &LauncherPaths,
    profile_id: &str,
    kind: ContentKind,
) -> AppResult<Vec<ContentItem>> {
    validate_profile_id(profile_id)?;
    paths.ensure_instance_dirs(profile_id).await?;
    let dir = content_dir(paths, profile_id, kind);

    let mut entries = tokio::fs::read_dir(&dir).await?;
    let mut items = Vec::new();

    while let Some(entry) = entries.next_entry().await? {
        let meta = entry.metadata().await?;
        if !meta.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(item) = parse_content_entry(&name, kind, meta.len()) {
            items.push(item);
        }
    }

    items.sort_by_key(|a| a.display_name.to_lowercase());
    Ok(items)
}

pub async fn toggle_content_item(
    paths: &LauncherPaths,
    profile_id: &str,
    kind: ContentKind,
    file_name: &str,
    enable: bool,
) -> AppResult<ContentItem> {
    validate_profile_id(profile_id)?;
    validate_file_name(file_name)?;
    let dir = content_dir(paths, profile_id, kind);
    let src_path = dir.join(file_name);

    if !tokio::fs::try_exists(&src_path).await? {
        return Err(AppError::ContentError(format!(
            "Content file '{file_name}' not found"
        )));
    }

    let target_name = if enable {
        file_name
            .strip_suffix(".disabled")
            .unwrap_or(file_name)
            .to_string()
    } else if file_name.ends_with(".disabled") {
        file_name.to_string()
    } else {
        format!("{file_name}.disabled")
    };

    let dst_path = dir.join(&target_name);
    if src_path != dst_path {
        tokio::fs::rename(&src_path, &dst_path).await?;
    }

    let meta = tokio::fs::metadata(&dst_path).await?;
    parse_content_entry(&target_name, kind, meta.len()).ok_or_else(|| {
        AppError::ContentError(format!("Unsupported content extension for '{target_name}'"))
    })
}

pub async fn import_content_file(
    paths: &LauncherPaths,
    profile_id: &str,
    kind: ContentKind,
    source_path: &Path,
) -> AppResult<ContentItem> {
    validate_profile_id(profile_id)?;
    paths.ensure_instance_dirs(profile_id).await?;

    let file_name = source_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::ContentError("Invalid source file name".to_string()))?;
    validate_file_name(file_name)?;

    let valid_ext = match kind {
        ContentKind::Mod => file_name.ends_with(".jar") || file_name.ends_with(".jar.disabled"),
        ContentKind::ResourcePack => {
            file_name.ends_with(".zip") || file_name.ends_with(".zip.disabled")
        }
    };
    if !valid_ext {
        return Err(AppError::ContentError(format!(
            "File '{file_name}' has an incompatible extension"
        )));
    }

    let dst_path = content_dir(paths, profile_id, kind).join(file_name);
    tokio::fs::copy(source_path, &dst_path).await?;
    let meta = tokio::fs::metadata(&dst_path).await?;
    parse_content_entry(file_name, kind, meta.len()).ok_or_else(|| {
        AppError::ContentError(format!("Failed to parse imported item '{file_name}'"))
    })
}

pub async fn inject_modrinth_performance_stack<F>(
    client: &reqwest::Client,
    paths: &LauncherPaths,
    profile_id: &str,
    mc_version: &str,
    on_progress: F,
) -> AppResult<Vec<String>>
where
    F: Fn(DownloadProgress) + Send + Sync + 'static,
{
    validate_profile_id(profile_id)?;
    paths.ensure_instance_dirs(profile_id).await?;

    let mods_dir = paths.instance_mods_dir(profile_id);
    let mut artifacts = Vec::new();
    let mut installed_names = Vec::new();
    let mut queue: VecDeque<PendingModrinthTarget> = PERFORMANCE_STACK_MODS
        .iter()
        .map(|(slug, label)| PendingModrinthTarget::Project((*slug).to_string(), (*label).to_string()))
        .collect();

    let mut visited_projects: HashSet<String> = HashSet::new();
    let mut visited_versions: HashSet<String> = HashSet::new();
    let mut seen_filenames: HashSet<String> = HashSet::new();
    let mut resolved_count = 0_usize;

    while let Some(target) = queue.pop_front() {
        let (label, version_opt) = match target {
            PendingModrinthTarget::Project(slug_or_id, display_label) => {
                if !visited_projects.insert(slug_or_id.clone()) {
                    continue;
                }
                on_progress(DownloadProgress {
                    phase: "Resolviendo Modrinth + Dependencias".to_string(),
                    completed_files: resolved_count,
                    total_files: resolved_count + queue.len() + 1,
                    bytes_downloaded: 0,
                    current_file: display_label.clone(),
                    fast_path_hits: 0,
                });

                let url = format!(
                    "https://api.modrinth.com/v2/project/{slug_or_id}/version?loaders=%5B%22fabric%22%5D&game_versions=%5B%22{mc_version}%22%5D"
                );
                let resp = client.get(&url).send().await?;
                if !resp.status().is_success() {
                    continue;
                }
                let versions: Vec<ModrinthVersion> = resp.json().await?;
                (display_label, versions.into_iter().next())
            }
            PendingModrinthTarget::Version(ver_id) => {
                if !visited_versions.insert(ver_id.clone()) {
                    continue;
                }
                on_progress(DownloadProgress {
                    phase: "Resolviendo dependencia requerida".to_string(),
                    completed_files: resolved_count,
                    total_files: resolved_count + queue.len() + 1,
                    bytes_downloaded: 0,
                    current_file: format!("version/{ver_id}"),
                    fast_path_hits: 0,
                });

                let url = format!("https://api.modrinth.com/v2/version/{ver_id}");
                let resp = client.get(&url).send().await?;
                if !resp.status().is_success() {
                    continue;
                }
                let ver: ModrinthVersion = resp.json().await?;
                (format!("Required ({})", ver.project_id), Some(ver))
            }
        };

        let Some(version) = version_opt else {
            continue;
        };

        if !version.project_id.is_empty() {
            visited_projects.insert(version.project_id.clone());
        }

        // Enqueue required dependencies (e.g. fabric-api) before downloading
        for req_dep in extract_required_dependencies(&version.dependencies) {
            queue.push_back(req_dep);
        }

        let selected_file = version
            .files
            .iter()
            .find(|f| f.primary)
            .or_else(|| version.files.first());

        let Some(file) = selected_file else {
            continue;
        };

        if !seen_filenames.insert(file.filename.clone()) {
            continue;
        }

        resolved_count += 1;
        installed_names.push(format!("{label} ({})", file.filename));
        artifacts.push(DownloadArtifact {
            relative_key: format!("instances/{profile_id}/mods/{}", file.filename),
            url: file.url.clone(),
            destination: mods_dir.join(&file.filename),
            expected_sha1: Some(file.hashes.sha1.clone()),
            expected_size: Some(file.size),
        });
    }

    if artifacts.is_empty() {
        return Err(AppError::ContentError(format!(
            "No compatible Fabric performance mods found on Modrinth for Minecraft {mc_version}"
        )));
    }

    verify_and_download_all(client, artifacts, &paths.integrity_index_path(), on_progress).await?;
    Ok(installed_names)
}

#[cfg(test)]
mod tests {
    use super::{extract_required_dependencies, ModrinthDependency, PendingModrinthTarget};

    #[test]
    fn test_extract_required_modrinth_dependencies_filters_optional() {
        let deps = vec![
            ModrinthDependency {
                project_id: Some("P7dR8mSH".to_string()),
                version_id: None,
                dependency_type: "required".to_string(),
            },
            ModrinthDependency {
                project_id: Some("optional-mod".to_string()),
                version_id: None,
                dependency_type: "optional".to_string(),
            },
            ModrinthDependency {
                project_id: Some("pinned-dep".to_string()),
                version_id: Some("v12345".to_string()),
                dependency_type: "required".to_string(),
            },
            ModrinthDependency {
                project_id: Some("incompatible-mod".to_string()),
                version_id: None,
                dependency_type: "incompatible".to_string(),
            },
        ];

        let extracted = extract_required_dependencies(&deps);
        assert_eq!(extracted.len(), 2);
        assert_eq!(
            extracted[0],
            PendingModrinthTarget::Project(
                "P7dR8mSH".to_string(),
                "Dependency (P7dR8mSH)".to_string()
            )
        );
        assert_eq!(
            extracted[1],
            PendingModrinthTarget::Version("v12345".to_string())
        );
    }
}
