use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::core::downloader::{verify_and_download_all, DownloadArtifact, DownloadProgress};
use crate::core::instance::validate_profile_id;
use crate::core::paths::LauncherPaths;
use crate::error::{AppError, AppResult};

pub const FPS_PURE_STACK_MODS: &[(&str, &str)] = &[
    ("sodium", "Sodium"),
    ("lithium", "Lithium"),
    ("ferrite-core", "FerriteCore"),
    ("immediatelyfast", "ImmediatelyFast"),
    ("c2me-fabric", "C2ME"),
];

pub const DISTANT_HORIZONS_MOD: &[(&str, &str)] = &[("distanthorizons", "Distant Horizons")];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PerformancePreset {
    FpsPure,
    DistantHorizons,
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CuratedRecommendation {
    pub slug: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub badge: String,
    pub kind: ContentKind,
    pub installed: bool,
}

struct CuratedCatalogEntry {
    slug: &'static str,
    name: &'static str,
    description: &'static str,
    category: &'static str,
    badge: &'static str,
    kind: ContentKind,
    match_tokens: &'static [&'static str],
}

const CURATED_CATALOG: &[CuratedCatalogEntry] = &[
    CuratedCatalogEntry {
        slug: "sodium",
        name: "Sodium",
        description: "Motor de renderizado moderno para OpenGL con ganancias masivas de FPS.",
        category: "FPS Puros",
        badge: "Core Render",
        kind: ContentKind::Mod,
        match_tokens: &["sodium"],
    },
    CuratedCatalogEntry {
        slug: "lithium",
        name: "Lithium",
        description: "Optimiza física, IA de mobs y ticks de chunks sin alterar mecánicas vanilla.",
        category: "FPS Puros",
        badge: "Server/Tick",
        kind: ContentKind::Mod,
        match_tokens: &["lithium"],
    },
    CuratedCatalogEntry {
        slug: "ferrite-core",
        name: "FerriteCore",
        description: "Reduce drásticamente el consumo de memoria RAM en modelos y BlockStates.",
        category: "FPS Puros",
        badge: "RAM -40%",
        kind: ContentKind::Mod,
        match_tokens: &["ferritecore", "ferrite-core"],
    },
    CuratedCatalogEntry {
        slug: "immediatelyfast",
        name: "ImmediatelyFast",
        description: "Acelera el renderizado de entidades, UI, texto y partículas en tiempo real.",
        category: "FPS Puros",
        badge: "HUD & Entities",
        kind: ContentKind::Mod,
        match_tokens: &["immediatelyfast"],
    },
    CuratedCatalogEntry {
        slug: "c2me-fabric",
        name: "C2ME",
        description: "Generación y carga multihilo de chunks aprovechando todos los núcleos de CPU.",
        category: "FPS Puros",
        badge: "Multithread",
        kind: ContentKind::Mod,
        match_tokens: &["c2me"],
    },
    CuratedCatalogEntry {
        slug: "distanthorizons",
        name: "Distant Horizons",
        description: "LODs de distancia extrema (64+ chunks) con coste controlado de GPU.",
        category: "Horizonte",
        badge: "Opcional · LOD",
        kind: ContentKind::Mod,
        match_tokens: &["distanthorizons", "distant-horizons"],
    },
    CuratedCatalogEntry {
        slug: "iris",
        name: "Iris Shaders",
        description: "Soporte de shaders modernos totalmente compatible con Sodium.",
        category: "Visual",
        badge: "Shaders",
        kind: ContentKind::Mod,
        match_tokens: &["iris"],
    },
    CuratedCatalogEntry {
        slug: "entityculling",
        name: "Entity Culling",
        description: "Evita renderizar entidades y bloques ocultos detrás de muros usando ray-tracing asíncrono.",
        category: "Optimización",
        badge: "GPU Culling",
        kind: ContentKind::Mod,
        match_tokens: &["entityculling"],
    },
    CuratedCatalogEntry {
        slug: "fresh-animations",
        name: "Fresh Animations",
        description: "Animaciones fluidas y expresivas para todos los mobs manteniendo estética vanilla.",
        category: "Resource Pack",
        badge: "Animaciones",
        kind: ContentKind::ResourcePack,
        match_tokens: &["freshanimations", "fresh-animations", "fresh_animations"],
    },
    CuratedCatalogEntry {
        slug: "bare-bones",
        name: "Bare Bones",
        description: "Texturas limpias estilo tráiler oficial de Minecraft con gran claridad visual.",
        category: "Resource Pack",
        badge: "Minimal",
        kind: ContentKind::ResourcePack,
        match_tokens: &["barebones", "bare-bones", "bare_bones"],
    },
];

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

#[must_use]
pub fn preset_mod_list(preset: PerformancePreset) -> &'static [(&'static str, &'static str)] {
    match preset {
        PerformancePreset::FpsPure => FPS_PURE_STACK_MODS,
        PerformancePreset::DistantHorizons => DISTANT_HORIZONS_MOD,
    }
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

pub async fn list_curated_recommendations(
    paths: &LauncherPaths,
    profile_id: &str,
) -> AppResult<Vec<CuratedRecommendation>> {
    let installed_mods = list_instance_content(paths, profile_id, ContentKind::Mod).await?;
    let installed_packs =
        list_instance_content(paths, profile_id, ContentKind::ResourcePack).await?;

    let mod_names: Vec<String> = installed_mods
        .iter()
        .map(|m| m.file_name.to_lowercase())
        .collect();
    let pack_names: Vec<String> = installed_packs
        .iter()
        .map(|p| p.file_name.to_lowercase())
        .collect();

    let results = CURATED_CATALOG
        .iter()
        .map(|entry| {
            let pool = match entry.kind {
                ContentKind::Mod => &mod_names,
                ContentKind::ResourcePack => &pack_names,
            };
            let installed = pool.iter().any(|name| {
                entry
                    .match_tokens
                    .iter()
                    .any(|token| name.contains(token))
            });
            CuratedRecommendation {
                slug: entry.slug.to_string(),
                name: entry.name.to_string(),
                description: entry.description.to_string(),
                category: entry.category.to_string(),
                badge: entry.badge.to_string(),
                kind: entry.kind,
                installed,
            }
        })
        .collect();

    Ok(results)
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

async fn install_modrinth_targets<F>(
    client: &reqwest::Client,
    paths: &LauncherPaths,
    profile_id: &str,
    mc_version: &str,
    kind: ContentKind,
    initial_targets: Vec<(String, String)>,
    on_progress: F,
) -> AppResult<Vec<String>>
where
    F: Fn(DownloadProgress) + Send + Sync + 'static,
{
    validate_profile_id(profile_id)?;
    paths.ensure_instance_dirs(profile_id).await?;

    let target_dir = content_dir(paths, profile_id, kind);
    let rel_prefix = match kind {
        ContentKind::Mod => format!("instances/{profile_id}/mods"),
        ContentKind::ResourcePack => format!("instances/{profile_id}/resourcepacks"),
    };

    let mut artifacts = Vec::new();
    let mut installed_names = Vec::new();
    let mut queue: VecDeque<PendingModrinthTarget> = initial_targets
        .into_iter()
        .map(|(slug, label)| PendingModrinthTarget::Project(slug, label))
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

                let url = match kind {
                    ContentKind::Mod => format!(
                        "https://api.modrinth.com/v2/project/{slug_or_id}/version?loaders=%5B%22fabric%22%5D&game_versions=%5B%22{mc_version}%22%5D"
                    ),
                    ContentKind::ResourcePack => format!(
                        "https://api.modrinth.com/v2/project/{slug_or_id}/version?game_versions=%5B%22{mc_version}%22%5D"
                    ),
                };

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

        if kind == ContentKind::Mod {
            for req_dep in extract_required_dependencies(&version.dependencies) {
                queue.push_back(req_dep);
            }
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
            relative_key: format!("{rel_prefix}/{}", file.filename),
            url: file.url.clone(),
            destination: target_dir.join(&file.filename),
            expected_sha1: Some(file.hashes.sha1.clone()),
            expected_size: Some(file.size),
        });
    }

    if artifacts.is_empty() {
        return Err(AppError::ContentError(format!(
            "No se encontraron archivos compatibles en Modrinth para Minecraft {mc_version}"
        )));
    }

    verify_and_download_all(client, artifacts, &paths.integrity_index_path(), on_progress).await?;
    Ok(installed_names)
}

pub async fn inject_modrinth_preset<F>(
    client: &reqwest::Client,
    paths: &LauncherPaths,
    profile_id: &str,
    mc_version: &str,
    preset: PerformancePreset,
    on_progress: F,
) -> AppResult<Vec<String>>
where
    F: Fn(DownloadProgress) + Send + Sync + 'static,
{
    let targets = preset_mod_list(preset)
        .iter()
        .map(|(slug, label)| ((*slug).to_string(), (*label).to_string()))
        .collect();
    install_modrinth_targets(
        client,
        paths,
        profile_id,
        mc_version,
        ContentKind::Mod,
        targets,
        on_progress,
    )
    .await
}

pub async fn install_single_modrinth_item<F>(
    client: &reqwest::Client,
    paths: &LauncherPaths,
    profile_id: &str,
    mc_version: &str,
    slug: &str,
    kind: ContentKind,
    on_progress: F,
) -> AppResult<Vec<String>>
where
    F: Fn(DownloadProgress) + Send + Sync + 'static,
{
    let label = CURATED_CATALOG
        .iter()
        .find(|e| e.slug == slug)
        .map_or_else(|| slug.to_string(), |e| e.name.to_string());

    install_modrinth_targets(
        client,
        paths,
        profile_id,
        mc_version,
        kind,
        vec![(slug.to_string(), label)],
        on_progress,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::{
        extract_required_dependencies, preset_mod_list, ModrinthDependency, PendingModrinthTarget,
        PerformancePreset,
    };

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

    #[test]
    fn test_performance_presets_split_fps_pure_and_distant_horizons() {
        let fps = preset_mod_list(PerformancePreset::FpsPure);
        assert_eq!(fps.len(), 5);
        assert!(fps.iter().any(|(slug, _)| *slug == "sodium"));
        assert!(!fps.iter().any(|(slug, _)| *slug == "distanthorizons"));

        let dh = preset_mod_list(PerformancePreset::DistantHorizons);
        assert_eq!(dh.len(), 1);
        assert_eq!(dh[0].0, "distanthorizons");
    }
}
