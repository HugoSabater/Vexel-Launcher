use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::File;
use std::io::Read;
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
    ("modernfix", "ModernFix"),
    ("entityculling", "Entity Culling"),
    ("moreculling", "MoreCulling"),
    ("dynamic-fps", "Dynamic FPS"),
    ("badoptimizations", "BadOptimizations"),
];

pub const DISTANT_HORIZONS_MOD: &[(&str, &str)] = &[("distanthorizons", "Distant Horizons")];
pub const C2ME_CHUNK_ACCEL_MOD: &[(&str, &str)] = &[("c2me-fabric", "C2ME")];
pub const BOBBY_MULTIPLAYER_MOD: &[(&str, &str)] = &[("bobby", "Bobby")];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PerformancePreset {
    FpsPure,
    DistantHorizons,
    C2meChunkAccel,
    BobbyMultiplayer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContentKind {
    Mod,
    ResourcePack,
    Shader,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentItem {
    pub file_name: String,
    pub display_name: String,
    pub enabled: bool,
    pub size_bytes: u64,
    pub kind: ContentKind,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub mod_id: Option<String>,
    #[serde(default)]
    pub slug: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct InstanceContentIndex {
    #[serde(default)]
    pub entries: Vec<ContentIndexEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentIndexEntry {
    pub kind: ContentKind,
    pub file_name: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub slug: Option<String>,
    #[serde(default)]
    pub mod_id: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub cached_size: u64,
}

impl InstanceContentIndex {
    pub async fn load(path: &Path) -> Self {
        let Ok(raw) = tokio::fs::read_to_string(path).await else {
            return Self::default();
        };
        serde_json::from_str(&raw).unwrap_or_default()
    }

    pub async fn save_atomic(&self, path: &Path) -> AppResult<()> {
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let tmp_path = path.with_extension("json.tmp");
        let serialized = serde_json::to_vec_pretty(self)?;
        tokio::fs::write(&tmp_path, serialized).await?;
        tokio::fs::rename(&tmp_path, path).await?;
        Ok(())
    }

    pub fn find_by_file(&self, kind: ContentKind, file_name: &str) -> Option<&ContentIndexEntry> {
        self.entries
            .iter()
            .find(|e| e.kind == kind && e.file_name == file_name)
    }

    pub fn upsert(&mut self, entry: ContentIndexEntry) {
        if let Some(existing) = self
            .entries
            .iter_mut()
            .find(|e| e.kind == entry.kind && e.file_name == entry.file_name)
        {
            if entry.project_id.is_some() {
                existing.project_id = entry.project_id;
            }
            if entry.slug.is_some() {
                existing.slug = entry.slug;
            }
            if entry.mod_id.is_some() {
                existing.mod_id = entry.mod_id;
            }
            if entry.display_name.is_some() {
                existing.display_name = entry.display_name;
            }
            if entry.version.is_some() {
                existing.version = entry.version;
            }
            if entry.cached_size > 0 {
                existing.cached_size = entry.cached_size;
            }
        } else {
            self.entries.push(entry);
        }
    }

    pub fn rename_file(&mut self, kind: ContentKind, old_name: &str, new_name: &str) -> bool {
        if let Some(existing) = self
            .entries
            .iter_mut()
            .find(|e| e.kind == kind && e.file_name == old_name)
        {
            existing.file_name = new_name.to_string();
            return true;
        }
        false
    }

    pub fn remove_file(&mut self, kind: ContentKind, file_name: &str) -> bool {
        let before = self.entries.len();
        self.entries
            .retain(|e| !(e.kind == kind && e.file_name == file_name));
        self.entries.len() != before
    }

    #[must_use]
    pub fn find_existing_files_for_project(
        &self,
        kind: ContentKind,
        project_id: Option<&str>,
        slug: Option<&str>,
    ) -> Vec<String> {
        let norm_slug = slug.map(normalize_identifier);
        self.entries
            .iter()
            .filter(|e| {
                if e.kind != kind {
                    return false;
                }
                let by_pid = project_id
                    .filter(|p| !p.is_empty())
                    .is_some_and(|p| e.project_id.as_deref() == Some(p));
                let by_slug = norm_slug.as_deref().filter(|s| !s.is_empty()).is_some_and(
                    |s| {
                        e.slug
                            .as_deref()
                            .is_some_and(|es| normalize_identifier(es) == s)
                    },
                );
                by_pid || by_slug
            })
            .map(|e| e.file_name.clone())
            .collect()
    }

    #[must_use]
    pub fn active_project_map(&self, kind: ContentKind) -> HashMap<String, String> {
        let mut map = HashMap::new();
        for entry in &self.entries {
            if entry.kind != kind || entry.file_name.ends_with(".disabled") {
                continue;
            }
            if let Some(pid) = entry.project_id.as_deref().filter(|s| !s.is_empty()) {
                let label = entry
                    .display_name
                    .clone()
                    .or_else(|| entry.slug.clone())
                    .unwrap_or_else(|| entry.file_name.clone());
                map.insert(pid.to_string(), label);
            }
        }
        map
    }
}

#[derive(Debug, Deserialize)]
struct FabricModJson {
    id: Option<String>,
    name: Option<String>,
    version: Option<String>,
}

#[derive(Debug, Clone)]
struct JarModMetadata {
    mod_id: Option<String>,
    display_name: Option<String>,
    version: Option<String>,
}

fn read_fabric_mod_meta_blocking(jar_path: &Path) -> Option<JarModMetadata> {
    let file = File::open(jar_path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;
    let mut entry = archive.by_name("fabric.mod.json").ok()?;
    let mut raw = String::new();
    entry.read_to_string(&mut raw).ok()?;
    let parsed: FabricModJson = serde_json::from_str(&raw).ok()?;
    Some(JarModMetadata {
        mod_id: parsed.id.filter(|s| !s.trim().is_empty()),
        display_name: parsed.name.filter(|s| !s.trim().is_empty()),
        version: parsed.version.filter(|s| !s.trim().is_empty()),
    })
}

struct CuratedLabelEntry {
    slug: &'static str,
    name: &'static str,
}

const CURATED_LABELS: &[CuratedLabelEntry] = &[
    CuratedLabelEntry { slug: "sodium", name: "Sodium" },
    CuratedLabelEntry { slug: "lithium", name: "Lithium" },
    CuratedLabelEntry { slug: "ferrite-core", name: "FerriteCore" },
    CuratedLabelEntry { slug: "immediatelyfast", name: "ImmediatelyFast" },
    CuratedLabelEntry { slug: "modernfix", name: "ModernFix" },
    CuratedLabelEntry { slug: "entityculling", name: "Entity Culling" },
    CuratedLabelEntry { slug: "moreculling", name: "MoreCulling" },
    CuratedLabelEntry { slug: "dynamic-fps", name: "Dynamic FPS" },
    CuratedLabelEntry { slug: "badoptimizations", name: "BadOptimizations" },
    CuratedLabelEntry { slug: "c2me-fabric", name: "C2ME" },
    CuratedLabelEntry { slug: "bobby", name: "Bobby" },
    CuratedLabelEntry { slug: "distanthorizons", name: "Distant Horizons" },
    CuratedLabelEntry { slug: "iris", name: "Iris Shaders" },
    CuratedLabelEntry { slug: "fresh-animations", name: "Fresh Animations" },
    CuratedLabelEntry { slug: "bare-bones", name: "Bare Bones" },
];

#[derive(Debug, Clone, Deserialize)]
struct ModrinthVersion {
    #[serde(default)]
    project_id: String,
    #[serde(default)]
    version_number: String,
    #[serde(default)]
    version_type: String,
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
    Project {
        slug_or_id: String,
        display_label: String,
        known_slug: Option<String>,
    },
    Version(String),
}

#[must_use]
pub fn preset_mod_list(preset: PerformancePreset) -> &'static [(&'static str, &'static str)] {
    match preset {
        PerformancePreset::FpsPure => FPS_PURE_STACK_MODS,
        PerformancePreset::DistantHorizons => DISTANT_HORIZONS_MOD,
        PerformancePreset::C2meChunkAccel => C2ME_CHUNK_ACCEL_MOD,
        PerformancePreset::BobbyMultiplayer => BOBBY_MULTIPLAYER_MOD,
    }
}

#[must_use]
fn normalize_identifier(raw: &str) -> String {
    raw.trim()
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect()
}

#[must_use]
fn strip_loader_suffix(slug: &str) -> &str {
    let lower_trimmed = slug.trim();
    for suffix in ["-fabric", "-forge", "-neoforge", "_fabric", "_forge"] {
        if let Some(stripped) = lower_trimmed.strip_suffix(suffix) {
            return stripped;
        }
    }
    lower_trimmed
}

#[must_use]
fn filename_matches_slug_strict(file_name: &str, slug: &str) -> bool {
    let lower = file_name.to_lowercase();
    let stem = lower
        .strip_suffix(".jar.disabled")
        .or_else(|| lower.strip_suffix(".jar"))
        .or_else(|| lower.strip_suffix(".zip.disabled"))
        .or_else(|| lower.strip_suffix(".zip"))
        .unwrap_or(&lower);

    let slug_low = slug.trim().to_lowercase();
    let slug_base = strip_loader_suffix(&slug_low).to_string();

    for candidate in [&slug_low, &slug_base] {
        if candidate.is_empty() {
            continue;
        }
        if stem == candidate {
            return true;
        }
        if let Some(rest) = stem.strip_prefix(candidate.as_str()) {
            // Accept only version/loader delimiters like "-fabric-0.6", "-mc1.21", "-1.2", "_v2", "+1.21"
            // Reject companion mods like "sodium-extra" where the next segment is an unrelated word.
            if let Some(after_sep) = rest
                .strip_prefix('-')
                .or_else(|| rest.strip_prefix('_'))
                .or_else(|| rest.strip_prefix('+'))
                .or_else(|| rest.strip_prefix('.'))
            {
                let starts_with_version_or_loader = after_sep
                    .chars()
                    .next()
                    .is_some_and(|c| c.is_ascii_digit())
                    || after_sep.starts_with("mc")
                    || after_sep.starts_with("fabric")
                    || after_sep.starts_with("forge")
                    || after_sep.starts_with("neoforge")
                    || after_sep.starts_with('v')
                        && after_sep.chars().nth(1).is_some_and(|c| c.is_ascii_digit());
                if starts_with_version_or_loader {
                    return true;
                }
            }
        }
    }

    false
}

#[must_use]
pub fn is_project_installed(
    project_id: Option<&str>,
    slug: &str,
    items: &[ContentItem],
) -> bool {
    let norm_slug = normalize_identifier(slug);
    let norm_base = normalize_identifier(strip_loader_suffix(&slug.to_lowercase()));

    items.iter().any(|item| {
        if let Some(pid) = project_id.filter(|p| !p.is_empty()) {
            if item.project_id.as_deref() == Some(pid) {
                return true;
            }
        }

        if let Some(item_slug) = item.slug.as_deref().filter(|s| !s.is_empty()) {
            let n = normalize_identifier(item_slug);
            if n == norm_slug || (!norm_base.is_empty() && n == norm_base) {
                return true;
            }
        }

        if let Some(mod_id) = item.mod_id.as_deref().filter(|s| !s.is_empty()) {
            let n = normalize_identifier(mod_id);
            if n == norm_slug || (!norm_base.is_empty() && n == norm_base) {
                return true;
            }
            // Item has an authoritative mod_id from fabric.mod.json and it did NOT match:
            // never fall back to filename substring heuristics (prevents sodium vs sodium-extra).
            return false;
        }

        if item.project_id.is_some() || item.slug.is_some() {
            return false;
        }

        filename_matches_slug_strict(&item.file_name, slug)
    })
}

#[must_use]
fn select_preferred_version(versions: Vec<ModrinthVersion>) -> Option<ModrinthVersion> {
    if versions.is_empty() {
        return None;
    }
    if let Some(pos) = versions
        .iter()
        .position(|v| v.version_type.eq_ignore_ascii_case("release"))
    {
        return versions.into_iter().nth(pos);
    }
    if let Some(pos) = versions
        .iter()
        .position(|v| v.version_type.eq_ignore_ascii_case("beta"))
    {
        return versions.into_iter().nth(pos);
    }
    versions.into_iter().next()
}

fn find_incompatible_conflict(
    deps: &[ModrinthDependency],
    active_installed: &HashMap<String, String>,
) -> Option<String> {
    for dep in deps {
        if dep.dependency_type != "incompatible" {
            continue;
        }
        if let Some(pid) = dep.project_id.as_deref().filter(|s| !s.is_empty()) {
            if let Some(conflict_name) = active_installed.get(pid) {
                return Some(conflict_name.clone());
            }
        }
    }
    None
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
            out.push(PendingModrinthTarget::Project {
                slug_or_id: proj_id.to_string(),
                display_label: format!("Dependency ({proj_id})"),
                known_slug: None,
            });
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
        ContentKind::Shader => paths.instance_shaderpacks_dir(profile_id),
    }
}

fn is_valid_extension_for_kind(file_name: &str, kind: ContentKind) -> bool {
    let lower = file_name.to_lowercase();
    match kind {
        ContentKind::Mod => lower.ends_with(".jar") || lower.ends_with(".jar.disabled"),
        ContentKind::ResourcePack | ContentKind::Shader => {
            lower.ends_with(".zip") || lower.ends_with(".zip.disabled")
        }
    }
}

fn parse_content_entry(
    file_name: &str,
    kind: ContentKind,
    size_bytes: u64,
    indexed: Option<&ContentIndexEntry>,
) -> Option<ContentItem> {
    let active_ext = match kind {
        ContentKind::Mod => ".jar",
        ContentKind::ResourcePack | ContentKind::Shader => ".zip",
    };
    let disabled_ext = match kind {
        ContentKind::Mod => ".jar.disabled",
        ContentKind::ResourcePack | ContentKind::Shader => ".zip.disabled",
    };

    let (stem, enabled) = if let Some(stem) = file_name.strip_suffix(active_ext) {
        (stem, true)
    } else if let Some(stem) = file_name.strip_suffix(disabled_ext) {
        (stem, false)
    } else {
        return None;
    };

    let display_name = indexed
        .and_then(|e| e.display_name.clone())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| stem.to_string());

    Some(ContentItem {
        file_name: file_name.to_string(),
        display_name,
        enabled,
        size_bytes,
        kind,
        version: indexed.and_then(|e| e.version.clone()),
        mod_id: indexed.and_then(|e| e.mod_id.clone()),
        slug: indexed.and_then(|e| e.slug.clone()),
        project_id: indexed.and_then(|e| e.project_id.clone()),
    })
}

pub async fn list_instance_content(
    paths: &LauncherPaths,
    profile_id: &str,
    kind: ContentKind,
) -> AppResult<Vec<ContentItem>> {
    validate_profile_id(profile_id)?;
    paths.ensure_instance_dirs(profile_id).await?;
    let dir = content_dir(paths, profile_id, kind);
    let index_path = paths.instance_content_index_path(profile_id);
    let mut index = InstanceContentIndex::load(&index_path).await;
    let mut index_dirty = false;

    let mut entries = tokio::fs::read_dir(&dir).await?;
    let mut raw_files: Vec<(String, u64)> = Vec::new();
    let mut present_names: HashSet<String> = HashSet::new();

    while let Some(entry) = entries.next_entry().await? {
        let meta = entry.metadata().await?;
        if !meta.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_valid_extension_for_kind(&name, kind) {
            present_names.insert(name.clone());
            raw_files.push((name, meta.len()));
        }
    }

    // Prune stale index entries for files deleted externally on disk
    let before_len = index.entries.len();
    index
        .entries
        .retain(|e| e.kind != kind || present_names.contains(&e.file_name));
    if index.entries.len() != before_len {
        index_dirty = true;
    }

    // Batch-read fabric.mod.json only for uncached or resized .jar files
    if kind == ContentKind::Mod {
        let to_inspect: Vec<(String, PathBuf, u64)> = raw_files
            .iter()
            .filter_map(|(name, size)| {
                let cached_ok = index
                    .find_by_file(kind, name)
                    .is_some_and(|e| e.cached_size == *size && (e.mod_id.is_some() || e.display_name.is_some()));
                if cached_ok {
                    None
                } else {
                    Some((name.clone(), dir.join(name), *size))
                }
            })
            .collect();

        if !to_inspect.is_empty() {
            let scanned = tokio::task::spawn_blocking(move || {
                to_inspect
                    .into_iter()
                    .map(|(name, path, size)| {
                        let meta = read_fabric_mod_meta_blocking(&path);
                        (name, size, meta)
                    })
                    .collect::<Vec<_>>()
            })
            .await
            .map_err(|err| AppError::ContentError(format!("JAR metadata scan failed: {err}")))?;

            for (name, size, meta_opt) in scanned {
                if let Some(meta) = meta_opt {
                    index.upsert(ContentIndexEntry {
                        kind: ContentKind::Mod,
                        file_name: name,
                        project_id: None,
                        slug: None,
                        mod_id: meta.mod_id,
                        display_name: meta.display_name,
                        version: meta.version,
                        cached_size: size,
                    });
                    index_dirty = true;
                }
            }
        }
    }

    if index_dirty {
        let _ = index.save_atomic(&index_path).await;
    }

    let mut items: Vec<ContentItem> = raw_files
        .into_iter()
        .filter_map(|(name, size)| {
            let indexed = index.find_by_file(kind, &name);
            parse_content_entry(&name, kind, size, indexed)
        })
        .collect();

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

    // Keep .content_index.json synchronized across .disabled renames
    let index_path = paths.instance_content_index_path(profile_id);
    let mut index = InstanceContentIndex::load(&index_path).await;
    if src_path != dst_path && index.rename_file(kind, file_name, &target_name) {
        let _ = index.save_atomic(&index_path).await;
    }

    let meta = tokio::fs::metadata(&dst_path).await?;
    let indexed = index.find_by_file(kind, &target_name);
    parse_content_entry(&target_name, kind, meta.len(), indexed).ok_or_else(|| {
        AppError::ContentError(format!("Unsupported content extension for '{target_name}'"))
    })
}

pub async fn delete_content_item(
    paths: &LauncherPaths,
    profile_id: &str,
    kind: ContentKind,
    file_name: &str,
) -> AppResult<()> {
    validate_profile_id(profile_id)?;
    validate_file_name(file_name)?;
    let dir = content_dir(paths, profile_id, kind);
    let target_path = dir.join(file_name);

    if !tokio::fs::try_exists(&target_path).await? {
        return Err(AppError::ContentError(format!(
            "Content file '{file_name}' not found"
        )));
    }

    tokio::fs::remove_file(&target_path).await?;

    let index_path = paths.instance_content_index_path(profile_id);
    let mut index = InstanceContentIndex::load(&index_path).await;
    if index.remove_file(kind, file_name) {
        let _ = index.save_atomic(&index_path).await;
    }

    Ok(())
}

async fn finalize_imported_item(
    paths: &LauncherPaths,
    profile_id: &str,
    kind: ContentKind,
    file_name: &str,
    dst_path: &Path,
) -> AppResult<ContentItem> {
    let meta = tokio::fs::metadata(dst_path).await?;
    let size = meta.len();
    let index_path = paths.instance_content_index_path(profile_id);
    let mut index = InstanceContentIndex::load(&index_path).await;

    if kind == ContentKind::Mod {
        let p_clone = dst_path.to_path_buf();
        let jar_meta = tokio::task::spawn_blocking(move || read_fabric_mod_meta_blocking(&p_clone))
            .await
            .ok()
            .flatten();
        if let Some(jm) = jar_meta {
            index.upsert(ContentIndexEntry {
                kind,
                file_name: file_name.to_string(),
                project_id: None,
                slug: None,
                mod_id: jm.mod_id,
                display_name: jm.display_name,
                version: jm.version,
                cached_size: size,
            });
            let _ = index.save_atomic(&index_path).await;
        }
    }

    let indexed = index.find_by_file(kind, file_name);
    parse_content_entry(file_name, kind, size, indexed).ok_or_else(|| {
        AppError::ContentError(format!("Failed to parse imported item '{file_name}'"))
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

    if !is_valid_extension_for_kind(file_name, kind) {
        return Err(AppError::ContentError(format!(
            "File '{file_name}' has an incompatible extension"
        )));
    }

    let dst_path = content_dir(paths, profile_id, kind).join(file_name);
    tokio::fs::copy(source_path, &dst_path).await?;
    finalize_imported_item(paths, profile_id, kind, file_name, &dst_path).await
}

pub async fn import_content_bytes(
    paths: &LauncherPaths,
    profile_id: &str,
    kind: ContentKind,
    file_name: &str,
    bytes: &[u8],
) -> AppResult<ContentItem> {
    validate_profile_id(profile_id)?;
    validate_file_name(file_name)?;
    paths.ensure_instance_dirs(profile_id).await?;

    if !is_valid_extension_for_kind(file_name, kind) {
        return Err(AppError::ContentError(format!(
            "File '{file_name}' has an incompatible extension"
        )));
    }

    let dst_path = content_dir(paths, profile_id, kind).join(file_name);
    tokio::fs::write(&dst_path, bytes).await?;
    finalize_imported_item(paths, profile_id, kind, file_name, &dst_path).await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthSearchResult {
    pub slug: String,
    pub title: String,
    pub description: String,
    pub icon_url: Option<String>,
    pub downloads: u64,
    pub categories: Vec<String>,
    pub compatible: bool,
    pub compatibility_note: Option<String>,
    pub installed: bool,
    pub kind: ContentKind,
    #[serde(default)]
    pub performance_warning: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ModrinthSearchResponse {
    hits: Vec<ModrinthSearchHit>,
}

#[derive(Debug, Deserialize)]
struct ModrinthSearchHit {
    #[serde(default)]
    project_id: String,
    slug: String,
    title: String,
    description: String,
    icon_url: Option<String>,
    downloads: u64,
    #[serde(default)]
    categories: Vec<String>,
}

#[must_use]
pub fn normalize_modrinth_query(raw: &str) -> String {
    raw.replace('&', " and ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[must_use]
fn normalize_modrinth_sort(sort: Option<&str>, default_sort: &'static str) -> &'static str {
    match sort.unwrap_or(default_sort) {
        "downloads" => "downloads",
        "relevance" => "relevance",
        "newest" => "newest",
        "updated" => "updated",
        _ => default_sort,
    }
}

#[must_use]
pub fn compute_performance_warning(
    kind: ContentKind,
    slug: &str,
    title: &str,
    categories: &[String],
) -> Option<String> {
    if kind == ContentKind::Shader || slug.eq_ignore_ascii_case("iris") {
        return Some("Alto impacto en GPU/iGPU (Shaders)".to_string());
    }

    if kind == ContentKind::ResourcePack {
        let high_res_tokens = ["128x", "256x", "512x", "1024x"];
        let title_low = title.to_lowercase();
        let slug_low = slug.to_lowercase();
        let has_high_res = high_res_tokens.iter().any(|tok| {
            title_low.contains(tok)
                || slug_low.contains(tok)
                || categories
                    .iter()
                    .any(|c| c.to_lowercase().contains(tok))
        });
        if has_high_res {
            return Some("Alta resolución (≥128x): mayor consumo de VRAM/iGPU".to_string());
        }
    }

    None
}

fn hit_to_result(
    hit: ModrinthSearchHit,
    kind: ContentKind,
    installed_items: &[ContentItem],
    compatible: bool,
    compatibility_note: Option<String>,
) -> ModrinthSearchResult {
    let pid_opt = (!hit.project_id.is_empty()).then_some(hit.project_id.as_str());
    let installed = is_project_installed(pid_opt, &hit.slug, installed_items);
    let performance_warning =
        compute_performance_warning(kind, &hit.slug, &hit.title, &hit.categories);
    ModrinthSearchResult {
        slug: hit.slug,
        title: hit.title,
        description: hit.description,
        icon_url: hit.icon_url.filter(|u| !u.trim().is_empty()),
        downloads: hit.downloads,
        categories: hit.categories,
        compatible,
        compatibility_note,
        installed,
        kind,
        performance_warning,
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn search_modrinth_catalog(
    client: &reqwest::Client,
    paths: &LauncherPaths,
    profile_id: &str,
    query: &str,
    mc_version: &str,
    loader: &str,
    kind: ContentKind,
    offset: u32,
    sort: Option<&str>,
) -> AppResult<Vec<ModrinthSearchResult>> {
    let installed_items = list_instance_content(paths, profile_id, kind).await?;
    let clean_query = normalize_modrinth_query(query);
    let sort_index = normalize_modrinth_sort(sort, "relevance");
    let offset_str = offset.to_string();

    let project_type = match kind {
        ContentKind::Mod => "mod",
        ContentKind::ResourcePack => "resourcepack",
        ContentKind::Shader => "shader",
    };

    let loader_norm = if loader == "neo_forge" {
        "neoforge"
    } else {
        loader
    };

    let mut strict_facets = vec![vec![format!("project_type:{project_type}")]];
    match kind {
        ContentKind::Mod => {
            strict_facets.push(vec![format!("versions:{mc_version}")]);
            if !loader_norm.is_empty() && loader_norm != "vanilla" {
                strict_facets.push(vec![format!("categories:{loader_norm}")]);
            }
        }
        ContentKind::ResourcePack => {
            strict_facets.push(vec![format!("versions:{mc_version}")]);
        }
        ContentKind::Shader => {
            strict_facets.push(vec!["categories:iris".to_string()]);
            strict_facets.push(vec![format!("versions:{mc_version}")]);
        }
    }

    let strict_facets_json = serde_json::to_string(&strict_facets)?;
    let strict_resp: ModrinthSearchResponse = client
        .get("https://api.modrinth.com/v2/search")
        .query(&[
            ("query", clean_query.as_str()),
            ("facets", strict_facets_json.as_str()),
            ("index", sort_index),
            ("limit", "12"),
            ("offset", offset_str.as_str()),
        ])
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let mut seen_slugs: HashSet<String> = HashSet::new();
    let mut results: Vec<ModrinthSearchResult> = strict_resp
        .hits
        .into_iter()
        .filter(|h| seen_slugs.insert(h.slug.clone()))
        .map(|h| hit_to_result(h, kind, &installed_items, true, None))
        .collect();

    // Intelligent fallback on first page if strict search returns < 3 hits
    if offset == 0 && results.len() < 3 && !clean_query.is_empty() {
        let relaxed_facets_vec = if kind == ContentKind::Shader {
            vec![
                vec!["project_type:shader".to_string()],
                vec!["categories:iris".to_string()],
            ]
        } else {
            vec![vec![format!("project_type:{project_type}")]]
        };
        let relaxed_facets = serde_json::to_string(&relaxed_facets_vec)?;
        let relaxed_resp: ModrinthSearchResponse = client
            .get("https://api.modrinth.com/v2/search")
            .query(&[
                ("query", clean_query.as_str()),
                ("facets", relaxed_facets.as_str()),
                ("index", sort_index),
                ("limit", "12"),
            ])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        let loader_display = match loader_norm {
            "fabric" => "Fabric",
            "forge" => "Forge",
            "neoforge" => "NeoForge",
            _ => "Vanilla",
        };
        let (fallback_compat, note) = match kind {
            ContentKind::Mod => (
                false,
                Some(format!("Incompatible con {loader_display} {mc_version}")),
            ),
            ContentKind::ResourcePack => (
                false,
                Some(format!("Sin versión oficial para MC {mc_version}")),
            ),
            // Iris shaders are generally version-agnostic across MC releases
            ContentKind::Shader => (true, None),
        };

        for hit in relaxed_resp.hits {
            if seen_slugs.insert(hit.slug.clone()) {
                results.push(hit_to_result(
                    hit,
                    kind,
                    &installed_items,
                    fallback_compat,
                    note.clone(),
                ));
            }
            if results.len() >= 12 {
                break;
            }
        }
    }

    Ok(results)
}

#[allow(clippy::too_many_arguments)]
pub async fn get_dynamic_recommendations(
    client: &reqwest::Client,
    paths: &LauncherPaths,
    profile_id: &str,
    mc_version: &str,
    loader: &str,
    category: &str,
    kind: ContentKind,
    offset: u32,
    sort: Option<&str>,
) -> AppResult<Vec<ModrinthSearchResult>> {
    let installed_items = list_instance_content(paths, profile_id, kind).await?;
    let sort_index = normalize_modrinth_sort(sort, "downloads");
    let offset_str = offset.to_string();

    let project_type = match kind {
        ContentKind::Mod => "mod",
        ContentKind::ResourcePack => "resourcepack",
        ContentKind::Shader => "shader",
    };

    let loader_norm = if loader == "neo_forge" {
        "neoforge"
    } else {
        loader
    };

    let mut facets = vec![vec![format!("project_type:{project_type}")]];
    match kind {
        ContentKind::Mod => {
            facets.push(vec![format!("versions:{mc_version}")]);
            if !loader_norm.is_empty() && loader_norm != "vanilla" {
                facets.push(vec![format!("categories:{loader_norm}")]);
            }
        }
        ContentKind::ResourcePack => {
            facets.push(vec![format!("versions:{mc_version}")]);
        }
        ContentKind::Shader => {
            facets.push(vec!["categories:iris".to_string()]);
        }
    }

    let category_facets: Option<Vec<String>> = match category {
        "performance" => Some(vec!["categories:optimization".to_string()]),
        "visual" => Some(vec![
            "categories:decoration".to_string(),
            "categories:atmosphere".to_string(),
        ]),
        "qol" => Some(vec!["categories:utility".to_string()]),
        "world" => Some(vec![
            "categories:worldgen".to_string(),
            "categories:adventure".to_string(),
        ]),
        _ => None,
    };

    if kind == ContentKind::Mod {
        if let Some(cat_facet) = category_facets {
            facets.push(cat_facet);
        }
    }

    let facets_json = serde_json::to_string(&facets)?;
    let resp: ModrinthSearchResponse = client
        .get("https://api.modrinth.com/v2/search")
        .query(&[
            ("facets", facets_json.as_str()),
            ("index", sort_index),
            ("limit", "20"),
            ("offset", offset_str.as_str()),
        ])
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let filtered: Vec<ModrinthSearchResult> = resp
        .hits
        .into_iter()
        .filter(|hit| {
            let pid_opt = (!hit.project_id.is_empty()).then_some(hit.project_id.as_str());
            !is_project_installed(pid_opt, &hit.slug, &installed_items)
        })
        .take(10)
        .map(|hit| hit_to_result(hit, kind, &installed_items, true, None))
        .collect();

    Ok(filtered)
}

async fn fetch_modrinth_project_versions(
    client: &reqwest::Client,
    slug_or_id: &str,
    mc_version: &str,
    loader_norm: &str,
    kind: ContentKind,
) -> AppResult<Vec<ModrinthVersion>> {
    let urls: Vec<String> = match kind {
        ContentKind::Mod => {
            if !loader_norm.is_empty() && loader_norm != "vanilla" {
                vec![format!(
                    "https://api.modrinth.com/v2/project/{slug_or_id}/version?loaders=%5B%22{loader_norm}%22%5D&game_versions=%5B%22{mc_version}%22%5D"
                )]
            } else {
                vec![format!(
                    "https://api.modrinth.com/v2/project/{slug_or_id}/version?game_versions=%5B%22{mc_version}%22%5D"
                )]
            }
        }
        ContentKind::ResourcePack => vec![format!(
            "https://api.modrinth.com/v2/project/{slug_or_id}/version?game_versions=%5B%22{mc_version}%22%5D"
        )],
        ContentKind::Shader => vec![
            format!(
                "https://api.modrinth.com/v2/project/{slug_or_id}/version?loaders=%5B%22iris%22%5D&game_versions=%5B%22{mc_version}%22%5D"
            ),
            format!(
                "https://api.modrinth.com/v2/project/{slug_or_id}/version?loaders=%5B%22iris%22%5D"
            ),
            format!("https://api.modrinth.com/v2/project/{slug_or_id}/version"),
        ],
    };

    for url in urls {
        let resp = client.get(&url).send().await?;
        if !resp.status().is_success() {
            continue;
        }
        let versions: Vec<ModrinthVersion> = resp.json().await?;
        if !versions.is_empty() {
            return Ok(versions);
        }
    }

    Ok(Vec::new())
}

#[allow(clippy::too_many_arguments)]
async fn install_modrinth_targets<F>(
    client: &reqwest::Client,
    paths: &LauncherPaths,
    profile_id: &str,
    mc_version: &str,
    loader: &str,
    kind: ContentKind,
    initial_targets: Vec<(String, String)>,
    on_progress: F,
) -> AppResult<Vec<String>>
where
    F: Fn(DownloadProgress) + Send + Sync + 'static,
{
    validate_profile_id(profile_id)?;
    paths.ensure_instance_dirs(profile_id).await?;

    let loader_norm = if loader == "neo_forge" {
        "neoforge"
    } else {
        loader
    };

    let target_dir = content_dir(paths, profile_id, kind);
    let rel_prefix = match kind {
        ContentKind::Mod => format!("instances/{profile_id}/mods"),
        ContentKind::ResourcePack => format!("instances/{profile_id}/resourcepacks"),
        ContentKind::Shader => format!("instances/{profile_id}/shaderpacks"),
    };

    let index_path = paths.instance_content_index_path(profile_id);
    let mut index = InstanceContentIndex::load(&index_path).await;
    let active_installed_projects = index.active_project_map(kind);

    let mut artifacts = Vec::new();
    let mut installed_names = Vec::new();
    let mut pending_updates: Vec<(ContentIndexEntry, Vec<String>)> = Vec::new();
    let mut queue: VecDeque<PendingModrinthTarget> = initial_targets
        .into_iter()
        .map(|(slug, label)| PendingModrinthTarget::Project {
            slug_or_id: slug.clone(),
            display_label: label,
            known_slug: Some(slug),
        })
        .collect();

    let mut visited_projects: HashSet<String> = HashSet::new();
    let mut visited_versions: HashSet<String> = HashSet::new();
    let mut seen_filenames: HashSet<String> = HashSet::new();
    let mut resolved_count = 0_usize;

    while let Some(target) = queue.pop_front() {
        let (label, known_slug, version_opt) = match target {
            PendingModrinthTarget::Project {
                slug_or_id,
                display_label,
                known_slug,
            } => {
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

                let versions = fetch_modrinth_project_versions(
                    client,
                    &slug_or_id,
                    mc_version,
                    loader_norm,
                    kind,
                )
                .await?;
                (display_label, known_slug, select_preferred_version(versions))
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
                (format!("Required ({})", ver.project_id), None, Some(ver))
            }
        };

        let Some(version) = version_opt else {
            continue;
        };

        if !version.project_id.is_empty() {
            visited_projects.insert(version.project_id.clone());
        }

        if kind == ContentKind::Mod {
            if let Some(conflict_name) =
                find_incompatible_conflict(&version.dependencies, &active_installed_projects)
            {
                return Err(AppError::ContentError(format!(
                    "Conflicto de incompatibilidad: '{label}' es incompatible con el mod activo '{conflict_name}'."
                )));
            }
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

        let pid_opt = (!version.project_id.is_empty()).then_some(version.project_id.as_str());
        let old_files = index.find_existing_files_for_project(kind, pid_opt, known_slug.as_deref());

        pending_updates.push((
            ContentIndexEntry {
                kind,
                file_name: file.filename.clone(),
                project_id: pid_opt.map(str::to_string),
                slug: known_slug,
                mod_id: None,
                display_name: Some(label.clone()),
                version: (!version.version_number.is_empty())
                    .then_some(version.version_number.clone()),
                cached_size: file.size,
            },
            old_files,
        ));

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

    // Download & verify first — only delete older versions AFTER download succeeds
    verify_and_download_all(client, artifacts, &paths.integrity_index_path(), on_progress).await?;

    for (entry, old_files) in pending_updates {
        for old_name in old_files {
            if old_name != entry.file_name {
                let old_path = target_dir.join(&old_name);
                if tokio::fs::try_exists(&old_path).await.unwrap_or(false) {
                    let _ = tokio::fs::remove_file(&old_path).await;
                }
                index.remove_file(kind, &old_name);
            }
        }
        index.upsert(entry);
    }

    let _ = index.save_atomic(&index_path).await;
    Ok(installed_names)
}

pub async fn inject_modrinth_preset<F>(
    client: &reqwest::Client,
    paths: &LauncherPaths,
    profile_id: &str,
    mc_version: &str,
    loader: &str,
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
        loader,
        ContentKind::Mod,
        targets,
        on_progress,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn install_single_modrinth_item<F>(
    client: &reqwest::Client,
    paths: &LauncherPaths,
    profile_id: &str,
    mc_version: &str,
    loader: &str,
    slug: &str,
    kind: ContentKind,
    on_progress: F,
) -> AppResult<Vec<String>>
where
    F: Fn(DownloadProgress) + Send + Sync + 'static,
{
    let label = CURATED_LABELS
        .iter()
        .find(|e| e.slug == slug)
        .map_or_else(|| slug.to_string(), |e| e.name.to_string());

    install_modrinth_targets(
        client,
        paths,
        profile_id,
        mc_version,
        loader,
        kind,
        vec![(slug.to_string(), label)],
        on_progress,
    )
    .await
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{
        compute_performance_warning, delete_content_item, extract_required_dependencies,
        find_incompatible_conflict, is_project_installed, normalize_modrinth_query,
        preset_mod_list, select_preferred_version, toggle_content_item, ContentIndexEntry,
        ContentItem, ContentKind, InstanceContentIndex, ModrinthDependency, ModrinthVersion,
        PendingModrinthTarget, PerformancePreset,
    };
    use crate::core::paths::LauncherPaths;

    #[test]
    fn test_normalize_modrinth_query() {
        assert_eq!(
            normalize_modrinth_query("  Farmers & Delight   Plus  "),
            "Farmers and Delight Plus"
        );
        assert_eq!(normalize_modrinth_query("sodium"), "sodium");
    }

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
            PendingModrinthTarget::Project {
                slug_or_id: "P7dR8mSH".to_string(),
                display_label: "Dependency (P7dR8mSH)".to_string(),
                known_slug: None,
            }
        );
        assert_eq!(
            extracted[1],
            PendingModrinthTarget::Version("v12345".to_string())
        );
    }

    #[test]
    fn test_performance_presets_split_fps_pure_and_distant_horizons() {
        let fps = preset_mod_list(PerformancePreset::FpsPure);
        assert_eq!(fps.len(), 9);
        assert!(fps.iter().any(|(slug, _)| *slug == "sodium"));
        assert!(fps.iter().any(|(slug, _)| *slug == "modernfix"));
        assert!(fps.iter().any(|(slug, _)| *slug == "entityculling"));
        assert!(fps.iter().any(|(slug, _)| *slug == "moreculling"));
        assert!(fps.iter().any(|(slug, _)| *slug == "dynamic-fps"));
        assert!(fps.iter().any(|(slug, _)| *slug == "badoptimizations"));
        assert!(!fps.iter().any(|(slug, _)| *slug == "c2me-fabric"));
        assert!(!fps.iter().any(|(slug, _)| *slug == "distanthorizons"));

        let dh = preset_mod_list(PerformancePreset::DistantHorizons);
        assert_eq!(dh.len(), 1);
        assert_eq!(dh[0].0, "distanthorizons");

        let c2me = preset_mod_list(PerformancePreset::C2meChunkAccel);
        assert_eq!(c2me.len(), 1);
        assert_eq!(c2me[0].0, "c2me-fabric");

        let bobby = preset_mod_list(PerformancePreset::BobbyMultiplayer);
        assert_eq!(bobby.len(), 1);
        assert_eq!(bobby[0].0, "bobby");
    }

    #[test]
    fn test_exact_installation_detection_prevents_sodium_extra_false_positive() {
        let items = vec![
            ContentItem {
                file_name: "sodium-extra-0.6.0+mc1.21.4.jar".to_string(),
                display_name: "Sodium Extra".to_string(),
                enabled: true,
                size_bytes: 1000,
                kind: ContentKind::Mod,
                version: Some("0.6.0".to_string()),
                mod_id: Some("sodium-extra".to_string()),
                slug: Some("sodium-extra".to_string()),
                project_id: Some("PtjYWJkn".to_string()),
            },
            ContentItem {
                file_name: "c2me-0.3.0-alpha.jar".to_string(),
                display_name: "C2ME".to_string(),
                enabled: true,
                size_bytes: 2000,
                kind: ContentKind::Mod,
                version: Some("0.3.0".to_string()),
                mod_id: Some("c2me".to_string()),
                slug: None,
                project_id: None,
            },
        ];

        assert!(!is_project_installed(Some("AANobbMI"), "sodium", &items));
        assert!(is_project_installed(
            Some("PtjYWJkn"),
            "sodium-extra",
            &items
        ));
        assert!(is_project_installed(None, "c2me-fabric", &items));
    }

    #[test]
    fn test_select_preferred_version_prioritizes_release_over_beta_and_alpha() {
        let versions = vec![
            ModrinthVersion {
                project_id: "p1".to_string(),
                version_number: "2.0.0-alpha.1".to_string(),
                version_type: "alpha".to_string(),
                files: Vec::new(),
                dependencies: Vec::new(),
            },
            ModrinthVersion {
                project_id: "p1".to_string(),
                version_number: "1.9.0-beta.2".to_string(),
                version_type: "beta".to_string(),
                files: Vec::new(),
                dependencies: Vec::new(),
            },
            ModrinthVersion {
                project_id: "p1".to_string(),
                version_number: "1.8.4".to_string(),
                version_type: "release".to_string(),
                files: Vec::new(),
                dependencies: Vec::new(),
            },
        ];

        let chosen = select_preferred_version(versions);
        assert_eq!(chosen.map(|v| v.version_number).as_deref(), Some("1.8.4"));
    }

    #[test]
    fn test_incompatible_dependency_ignores_disabled_mods() {
        let mut idx = InstanceContentIndex::default();
        idx.upsert(ContentIndexEntry {
            kind: ContentKind::Mod,
            file_name: "optifine.jar.disabled".to_string(),
            project_id: Some("proj-disabled".to_string()),
            slug: Some("optifine".to_string()),
            mod_id: None,
            display_name: Some("OptiFine".to_string()),
            version: None,
            cached_size: 100,
        });
        idx.upsert(ContentIndexEntry {
            kind: ContentKind::Mod,
            file_name: "active-conflict.jar".to_string(),
            project_id: Some("proj-active".to_string()),
            slug: Some("active-conflict".to_string()),
            mod_id: None,
            display_name: Some("Active Conflict".to_string()),
            version: None,
            cached_size: 100,
        });

        let active_map: HashMap<String, String> = idx.active_project_map(ContentKind::Mod);
        assert!(!active_map.contains_key("proj-disabled"));
        assert!(active_map.contains_key("proj-active"));

        let deps_disabled = vec![ModrinthDependency {
            project_id: Some("proj-disabled".to_string()),
            version_id: None,
            dependency_type: "incompatible".to_string(),
        }];
        assert!(find_incompatible_conflict(&deps_disabled, &active_map).is_none());

        let deps_active = vec![ModrinthDependency {
            project_id: Some("proj-active".to_string()),
            version_id: None,
            dependency_type: "incompatible".to_string(),
        }];
        assert_eq!(
            find_incompatible_conflict(&deps_active, &active_map).as_deref(),
            Some("Active Conflict")
        );
    }

    #[test]
    fn test_performance_warnings_for_shaders_and_high_res_packs() {
        assert!(compute_performance_warning(ContentKind::Shader, "bsl", "BSL Shaders", &[]).is_some());
        assert!(compute_performance_warning(ContentKind::Mod, "iris", "Iris Shaders", &[]).is_some());
        assert!(compute_performance_warning(ContentKind::Mod, "sodium", "Sodium", &[]).is_none());
        assert!(compute_performance_warning(
            ContentKind::ResourcePack,
            "patrix",
            "Patrix 256x",
            &[]
        )
        .is_some());
        assert!(compute_performance_warning(
            ContentKind::ResourcePack,
            "faithful",
            "Faithful 32x",
            &["32x".to_string()]
        )
        .is_none());
    }

    #[tokio::test]
    async fn test_toggle_and_delete_preserve_and_clean_content_index() -> Result<(), Box<dyn std::error::Error>> {
        let tmp = std::env::temp_dir().join(format!(
            "mc-launcher-content-idx-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let paths = LauncherPaths::with_root(tmp.clone());
        paths.ensure_instance_dirs("test-prof").await?;

        let shader_file = paths.instance_shaderpacks_dir("test-prof").join("bsl.zip");
        tokio::fs::write(&shader_file, b"zipbytes").await?;

        let index_path = paths.instance_content_index_path("test-prof");
        let mut idx = InstanceContentIndex::default();
        idx.upsert(ContentIndexEntry {
            kind: ContentKind::Shader,
            file_name: "bsl.zip".to_string(),
            project_id: Some("Q1vvjJYV".to_string()),
            slug: Some("bsl-shaders".to_string()),
            mod_id: None,
            display_name: Some("BSL Shaders".to_string()),
            version: Some("8.2".to_string()),
            cached_size: 8,
        });
        idx.save_atomic(&index_path).await?;

        let disabled = toggle_content_item(&paths, "test-prof", ContentKind::Shader, "bsl.zip", false).await?;
        assert!(!disabled.enabled);
        assert_eq!(disabled.file_name, "bsl.zip.disabled");
        assert_eq!(disabled.project_id.as_deref(), Some("Q1vvjJYV"));
        assert_eq!(disabled.slug.as_deref(), Some("bsl-shaders"));

        delete_content_item(&paths, "test-prof", ContentKind::Shader, "bsl.zip.disabled").await?;
        let reloaded = InstanceContentIndex::load(&index_path).await;
        assert!(reloaded.entries.is_empty());

        let _ = tokio::fs::remove_dir_all(&tmp).await;
        Ok(())
    }

    #[tokio::test]
    async fn test_list_instance_content_reads_and_caches_fabric_mod_json() -> Result<(), Box<dyn std::error::Error>> {
        use std::io::Write;
        use zip::write::SimpleFileOptions;

        let tmp = std::env::temp_dir().join(format!(
            "mc-launcher-jar-meta-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let paths = LauncherPaths::with_root(tmp.clone());
        paths.ensure_instance_dirs("fabric-test").await?;

        let jar_path = paths
            .instance_mods_dir("fabric-test")
            .join("sodium-fabric-0.6.5.jar");
        {
            let file = std::fs::File::create(&jar_path)?;
            let mut writer = zip::ZipWriter::new(file);
            writer.start_file("fabric.mod.json", SimpleFileOptions::default())?;
            writer.write_all(
                br#"{"schemaVersion":1,"id":"sodium","version":"0.6.5+mc1.21.4","name":"Sodium"}"#,
            )?;
            writer.finish()?;
        }

        let items = super::list_instance_content(&paths, "fabric-test", ContentKind::Mod).await?;
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].display_name, "Sodium");
        assert_eq!(items[0].mod_id.as_deref(), Some("sodium"));
        assert_eq!(items[0].version.as_deref(), Some("0.6.5+mc1.21.4"));

        let cached_idx =
            InstanceContentIndex::load(&paths.instance_content_index_path("fabric-test")).await;
        assert_eq!(cached_idx.entries.len(), 1);
        assert_eq!(cached_idx.entries[0].mod_id.as_deref(), Some("sodium"));

        let _ = tokio::fs::remove_dir_all(&tmp).await;
        Ok(())
    }
}
