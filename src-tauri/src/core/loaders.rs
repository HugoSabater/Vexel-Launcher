use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use tokio::io::AsyncReadExt;

use crate::core::downloader::{verify_and_download_all, DownloadArtifact, DownloadProgress};
use crate::core::instance::ModLoaderKind;
use crate::core::manifest::{
    extract_argument_values_for_windows, maven_coords_to_relative_path, ArgumentsBlock,
    DownloadPlan,
};
use crate::core::paths::LauncherPaths;
use crate::error::{AppError, AppResult};

pub const FABRIC_META_BASE_URL: &str = "https://meta.fabricmc.net/v2";
pub const FORGE_PROMOTIONS_URL: &str =
    "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";
pub const FORGE_MAVEN_METADATA_URL: &str =
    "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml";
pub const NEOFORGE_MAVEN_METADATA_URL: &str =
    "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml";
const FORGE_PROMOTIONS_TTL_SECS: u64 = 6 * 3600;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

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

#[derive(Debug, Clone, Deserialize)]
struct ForgePromotionsSlim {
    #[serde(default)]
    promos: HashMap<String, String>,
}

#[derive(Debug, Clone, Deserialize)]
struct ForgeInstallProfile {
    #[serde(default)]
    data: HashMap<String, ForgeDataEntry>,
    #[serde(default)]
    processors: Vec<ForgeProcessor>,
    #[serde(default)]
    libraries: Vec<ForgeLibrary>,
}

#[derive(Debug, Clone, Deserialize)]
struct ForgeDataEntry {
    #[serde(default)]
    client: String,
}

#[derive(Debug, Clone, Deserialize)]
struct ForgeProcessor {
    #[serde(default)]
    sides: Vec<String>,
    jar: String,
    #[serde(default)]
    classpath: Vec<String>,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    outputs: HashMap<String, String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForgeVersionJson {
    #[allow(dead_code)]
    id: String,
    main_class: String,
    arguments: Option<ArgumentsBlock>,
    #[serde(default)]
    libraries: Vec<ForgeLibrary>,
}

#[derive(Debug, Clone, Deserialize)]
struct ForgeLibrary {
    name: String,
    url: Option<String>,
    downloads: Option<ForgeLibraryDownloads>,
}

#[derive(Debug, Clone, Deserialize)]
struct ForgeLibraryDownloads {
    artifact: Option<ForgeArtifactDownload>,
}

#[derive(Debug, Clone, Deserialize)]
struct ForgeArtifactDownload {
    path: Option<String>,
    url: Option<String>,
    sha1: Option<String>,
    size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ForgeReadyStamp {
    full_version: String,
    #[serde(default)]
    outputs: Vec<String>,
}

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

    let (extra_jvm_args, extra_game_args) = match profile.arguments {
        Some(args) => (
            extract_argument_values_for_windows(&args.jvm),
            extract_argument_values_for_windows(&args.game),
        ),
        None => (Vec::new(), Vec::new()),
    };

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

fn parse_version_numeric_key(ver: &str) -> Vec<u64> {
    ver.split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse::<u64>().ok())
        .collect()
}

fn resolve_forge_version_from_promotions(
    promos: &HashMap<String, String>,
    mc_version: &str,
) -> Option<String> {
    let rec_key = format!("{mc_version}-recommended");
    if let Some(v) = promos.get(&rec_key).map(String::as_str).map(str::trim) {
        if !v.is_empty() {
            return Some(v.to_string());
        }
    }
    let latest_key = format!("{mc_version}-latest");
    if let Some(v) = promos.get(&latest_key).map(String::as_str).map(str::trim) {
        if !v.is_empty() {
            return Some(v.to_string());
        }
    }
    None
}

fn resolve_forge_version_from_maven_metadata_xml(xml: &str, mc_version: &str) -> Option<String> {
    let prefix = format!("{mc_version}-");
    let mut best: Option<(Vec<u64>, String)> = None;
    let mut rest = xml;

    while let Some(open_idx) = rest.find("<version>") {
        let after_open = &rest[open_idx + "<version>".len()..];
        let Some(close_idx) = after_open.find("</version>") else {
            break;
        };
        let raw_ver = after_open[..close_idx].trim();
        rest = &after_open[close_idx + "</version>".len()..];

        if let Some(forge_ver) = raw_ver.strip_prefix(&prefix) {
            if forge_ver.is_empty() || forge_ver.contains('-') {
                continue;
            }
            let key = parse_version_numeric_key(forge_ver);
            if best.as_ref().is_none_or(|(best_key, _)| key > *best_key) {
                best = Some((key, forge_ver.to_string()));
            }
        }
    }

    best.map(|(_, v)| v)
}

async fn resolve_forge_version_number(
    client: &reqwest::Client,
    mc_version: &str,
    requested_version: Option<&str>,
    paths: &LauncherPaths,
) -> AppResult<String> {
    if let Some(raw) = requested_version.map(str::trim).filter(|s| !s.is_empty()) {
        let prefix = format!("{mc_version}-");
        let stripped = raw.strip_prefix(&prefix).unwrap_or(raw);
        return Ok(stripped.to_string());
    }

    let cache_dir = paths.shared_forge_cache_dir();
    let cache_file = cache_dir.join("promotions_slim.json");
    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());

    let cache_is_fresh = match tokio::fs::metadata(&cache_file).await {
        Ok(meta) if meta.is_file() => {
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_secs());
            now_secs.saturating_sub(mtime) < FORGE_PROMOTIONS_TTL_SECS
        }
        _ => false,
    };

    let promos_raw = if cache_is_fresh {
        tokio::fs::read_to_string(&cache_file).await.ok()
    } else {
        match client.get(FORGE_PROMOTIONS_URL).send().await {
            Ok(resp) if resp.status().is_success() => match resp.text().await {
                Ok(text) => {
                    let _ = tokio::fs::create_dir_all(&cache_dir).await;
                    let _ = tokio::fs::write(&cache_file, text.as_bytes()).await;
                    Some(text)
                }
                Err(_) => tokio::fs::read_to_string(&cache_file).await.ok(),
            },
            _ => tokio::fs::read_to_string(&cache_file).await.ok(),
        }
    };

    if let Some(raw) = promos_raw {
        if let Ok(parsed) = serde_json::from_str::<ForgePromotionsSlim>(&raw) {
            if let Some(ver) = resolve_forge_version_from_promotions(&parsed.promos, mc_version) {
                return Ok(ver);
            }
        }
    }

    // Fallback to Forge maven-metadata.xml when promotions_slim.json lacks this exact MC version
    let xml = client
        .get(FORGE_MAVEN_METADATA_URL)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;

    resolve_forge_version_from_maven_metadata_xml(&xml, mc_version).ok_or_else(|| {
        AppError::LoaderError(format!(
            "No se encontró una versión de Forge compatible con Minecraft {mc_version}"
        ))
    })
}

fn mc_version_to_neoforge_prefix(mc_version: &str) -> Option<String> {
    let clean = mc_version.trim().split('-').next()?;
    let mut parts = clean.split('.');
    let major = parts.next()?.parse::<u32>().ok()?;
    let minor = parts.next()?.parse::<u32>().ok()?;
    if major != 1 || minor < 20 {
        return None;
    }
    let patch = parts
        .next()
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0);
    Some(format!("{minor}.{patch}."))
}

fn resolve_neoforge_version_from_maven_metadata_xml(xml: &str, mc_version: &str) -> Option<String> {
    let prefix = mc_version_to_neoforge_prefix(mc_version)?;
    let mut best_stable: Option<(Vec<u64>, String)> = None;
    let mut best_pre: Option<(Vec<u64>, String)> = None;
    let mut rest = xml;

    while let Some(open_idx) = rest.find("<version>") {
        let after_open = &rest[open_idx + "<version>".len()..];
        let Some(close_idx) = after_open.find("</version>") else {
            break;
        };
        let raw_ver = after_open[..close_idx].trim();
        rest = &after_open[close_idx + "</version>".len()..];

        if !raw_ver.starts_with(&prefix) {
            continue;
        }
        let is_pre = raw_ver.contains('-');
        let numeric_base = raw_ver.split('-').next().unwrap_or(raw_ver);
        let key = parse_version_numeric_key(numeric_base);
        if is_pre {
            if best_pre.as_ref().is_none_or(|(k, _)| key > *k) {
                best_pre = Some((key, raw_ver.to_string()));
            }
        } else if best_stable.as_ref().is_none_or(|(k, _)| key > *k) {
            best_stable = Some((key, raw_ver.to_string()));
        }
    }

    best_stable.or(best_pre).map(|(_, v)| v)
}

async fn resolve_neoforge_version_number(
    client: &reqwest::Client,
    mc_version: &str,
    requested_version: Option<&str>,
    paths: &LauncherPaths,
) -> AppResult<String> {
    if let Some(raw) = requested_version.map(str::trim).filter(|s| !s.is_empty()) {
        return Ok(raw.to_string());
    }

    let cache_dir = paths.shared_neoforge_cache_dir();
    let cache_file = cache_dir.join("maven-metadata.xml");
    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());

    let cache_is_fresh = match tokio::fs::metadata(&cache_file).await {
        Ok(meta) if meta.is_file() => {
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_secs());
            now_secs.saturating_sub(mtime) < FORGE_PROMOTIONS_TTL_SECS
        }
        _ => false,
    };

    let xml_raw = if cache_is_fresh {
        tokio::fs::read_to_string(&cache_file).await.ok()
    } else {
        match client.get(NEOFORGE_MAVEN_METADATA_URL).send().await {
            Ok(resp) if resp.status().is_success() => match resp.text().await {
                Ok(text) => {
                    let _ = tokio::fs::create_dir_all(&cache_dir).await;
                    let _ = tokio::fs::write(&cache_file, text.as_bytes()).await;
                    Some(text)
                }
                Err(_) => tokio::fs::read_to_string(&cache_file).await.ok(),
            },
            _ => tokio::fs::read_to_string(&cache_file).await.ok(),
        }
    };

    let xml = xml_raw.ok_or_else(|| {
        AppError::LoaderError(format!(
            "No se pudo consultar maven-metadata.xml de NeoForge para Minecraft {mc_version}"
        ))
    })?;

    resolve_neoforge_version_from_maven_metadata_xml(&xml, mc_version).ok_or_else(|| {
        AppError::LoaderError(format!(
            "No se encontró una versión de NeoForge compatible con Minecraft {mc_version}"
        ))
    })
}

fn sanitize_archive_relative_path(raw: &str) -> Option<PathBuf> {
    let normalized = raw.trim().replace('\\', "/");
    let stripped = normalized.trim_start_matches('/');
    if stripped.is_empty() {
        return None;
    }
    let mut rel = PathBuf::new();
    for segment in stripped.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." || segment.contains(':') {
            return None;
        }
        rel.push(segment);
    }
    if rel.as_os_str().is_empty() {
        None
    } else {
        Some(rel)
    }
}

struct ExtractedForgeInstaller {
    install_profile_raw: String,
    version_json_raw: String,
}

fn extract_forge_installer_blocking(
    installer_jar: &Path,
    data_extract_root: &Path,
    libraries_dir: &Path,
) -> AppResult<ExtractedForgeInstaller> {
    let file = File::open(installer_jar).map_err(|err| {
        AppError::LoaderError(format!(
            "No se pudo abrir el instalador de Forge '{}': {err}",
            installer_jar.display()
        ))
    })?;
    let mut archive = zip::ZipArchive::new(file).map_err(|err| {
        AppError::LoaderError(format!(
            "Instalador de Forge corrupto o ZIP inválido: {err}"
        ))
    })?;

    let mut install_profile_raw: Option<String> = None;
    let mut version_json_raw: Option<String> = None;

    for idx in 0..archive.len() {
        let mut entry = archive.by_index(idx).map_err(|err| {
            AppError::LoaderError(format!("Error leyendo entrada del instalador de Forge: {err}"))
        })?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().replace('\\', "/");

        if name == "install_profile.json" {
            let mut buf = String::new();
            entry.read_to_string(&mut buf)?;
            install_profile_raw = Some(buf);
            continue;
        }
        if name == "version.json" {
            let mut buf = String::new();
            entry.read_to_string(&mut buf)?;
            version_json_raw = Some(buf);
            continue;
        }

        if let Some(data_rel) = name.strip_prefix("data/") {
            let Some(clean_rel) = sanitize_archive_relative_path(data_rel) else {
                continue;
            };
            let dest = data_extract_root.join("data").join(clean_rel);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut out = File::create(&dest)?;
            std::io::copy(&mut entry, &mut out)?;
            continue;
        }

        if let Some(maven_rel) = name.strip_prefix("maven/") {
            let Some(clean_rel) = sanitize_archive_relative_path(maven_rel) else {
                continue;
            };
            let dest = libraries_dir.join(clean_rel);
            if dest.exists() {
                continue;
            }
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut out = File::create(&dest)?;
            std::io::copy(&mut entry, &mut out)?;
        }
    }

    let install_profile_raw = install_profile_raw.ok_or_else(|| {
        AppError::LoaderError(
            "El instalador de Forge no contiene install_profile.json".to_string(),
        )
    })?;
    let version_json_raw = version_json_raw.ok_or_else(|| {
        AppError::LoaderError("El instalador de Forge no contiene version.json".to_string())
    })?;

    Ok(ExtractedForgeInstaller {
        install_profile_raw,
        version_json_raw,
    })
}

fn parse_manifest_main_class(manifest_text: &str) -> Option<String> {
    let mut unfolded_lines: Vec<String> = Vec::new();
    for raw_line in manifest_text.lines() {
        let line = raw_line.trim_end_matches('\r');
        if let Some(cont) = line.strip_prefix(' ') {
            if let Some(last) = unfolded_lines.last_mut() {
                last.push_str(cont);
            }
        } else {
            unfolded_lines.push(line.to_string());
        }
    }

    for line in unfolded_lines {
        if let Some((key, value)) = line.split_once(':') {
            if key.trim().eq_ignore_ascii_case("Main-Class") {
                let main_cls = value.trim();
                if !main_cls.is_empty() {
                    return Some(main_cls.to_string());
                }
            }
        }
    }
    None
}

fn read_jar_main_class_blocking(jar_path: &Path) -> AppResult<String> {
    let file = File::open(jar_path).map_err(|err| {
        AppError::LoaderError(format!(
            "No se pudo abrir el processor JAR '{}': {err}",
            jar_path.display()
        ))
    })?;
    let mut archive = zip::ZipArchive::new(file).map_err(|err| {
        AppError::LoaderError(format!(
            "Processor JAR inválido '{}': {err}",
            jar_path.display()
        ))
    })?;
    let mut entry = archive.by_name("META-INF/MANIFEST.MF").map_err(|err| {
        AppError::LoaderError(format!(
            "Falta META-INF/MANIFEST.MF en '{}': {err}",
            jar_path.display()
        ))
    })?;
    let mut raw = String::new();
    entry.read_to_string(&mut raw)?;

    parse_manifest_main_class(&raw).ok_or_else(|| {
        AppError::LoaderError(format!(
            "No se encontró Main-Class en META-INF/MANIFEST.MF de '{}'",
            jar_path.display()
        ))
    })
}

fn resolve_forge_data_value(
    raw: &str,
    libraries_dir: &Path,
    data_extract_root: &Path,
) -> AppResult<String> {
    let trimmed = raw.trim();
    if trimmed.starts_with('[') && trimmed.ends_with(']') && trimmed.len() >= 2 {
        let coords = &trimmed[1..trimmed.len() - 1];
        let rel = maven_coords_to_relative_path(coords)?;
        return Ok(libraries_dir.join(rel).to_string_lossy().into_owned());
    }
    if trimmed.starts_with('\'') && trimmed.ends_with('\'') && trimmed.len() >= 2 {
        let inner = &trimmed[1..trimmed.len() - 1];
        if inner.starts_with("/data/") {
            if let Some(rel) = sanitize_archive_relative_path(inner) {
                return Ok(data_extract_root.join(rel).to_string_lossy().into_owned());
            }
        }
        return Ok(inner.to_string());
    }
    if trimmed.starts_with('/') {
        if let Some(rel) = sanitize_archive_relative_path(trimmed) {
            return Ok(data_extract_root.join(rel).to_string_lossy().into_owned());
        }
    }
    Ok(trimmed.to_string())
}

fn resolve_forge_processor_token(
    token: &str,
    vars: &HashMap<String, String>,
    libraries_dir: &Path,
) -> AppResult<String> {
    let mut substituted = token.to_string();
    for (k, v) in vars {
        let placeholder = format!("{{{k}}}");
        if substituted.contains(&placeholder) {
            substituted = substituted.replace(&placeholder, v);
        }
    }
    let trimmed = substituted.trim();
    if trimmed.starts_with('[') && trimmed.ends_with(']') && trimmed.len() >= 2 {
        let coords = &trimmed[1..trimmed.len() - 1];
        let rel = maven_coords_to_relative_path(coords)?;
        return Ok(libraries_dir.join(rel).to_string_lossy().into_owned());
    }
    Ok(substituted)
}

async fn compute_file_sha1_hex(path: &Path) -> AppResult<String> {
    let mut file = tokio::fs::File::open(path).await?;
    let mut hasher = Sha1::new();
    let mut buf = vec![0_u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn resolve_processor_java_binary(javaw_path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        if javaw_path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.eq_ignore_ascii_case("javaw.exe"))
        {
            let sibling_java = javaw_path.with_file_name("java.exe");
            if sibling_java.exists() {
                return sibling_java;
            }
        }
    }
    javaw_path.to_path_buf()
}

fn collect_forge_library_artifacts(
    libraries: &[ForgeLibrary],
    paths: &LauncherPaths,
) -> AppResult<(Vec<DownloadArtifact>, Vec<PathBuf>)> {
    let mut artifacts = Vec::new();
    let mut classpath_entries = Vec::new();

    for lib in libraries {
        let artifact_meta = lib.downloads.as_ref().and_then(|d| d.artifact.as_ref());
        let rel_path = match artifact_meta
            .and_then(|a| a.path.as_deref())
            .filter(|p| !p.trim().is_empty())
        {
            Some(p) => PathBuf::from(p),
            None => maven_coords_to_relative_path(&lib.name)?,
        };
        let rel_str = rel_path.to_string_lossy().replace('\\', "/");
        let dest = paths.shared_libraries_dir().join(&rel_path);
        classpath_entries.push(dest.clone());

        let url_opt = artifact_meta
            .and_then(|a| a.url.as_deref())
            .map(str::trim)
            .filter(|u| !u.is_empty())
            .map(str::to_string)
            .or_else(|| {
                lib.url
                    .as_deref()
                    .map(str::trim)
                    .filter(|u| !u.is_empty())
                    .map(|base| format!("{}/{rel_str}", base.trim_end_matches('/')))
            });

        if let Some(url) = url_opt {
            artifacts.push(DownloadArtifact {
                relative_key: format!("libraries/{rel_str}"),
                url,
                destination: dest,
                expected_sha1: artifact_meta.and_then(|a| a.sha1.clone()),
                expected_size: artifact_meta.and_then(|a| a.size),
            });
        }
    }

    Ok((artifacts, classpath_entries))
}

fn build_forge_overlay_from_version_json(
    version: ForgeVersionJson,
    forge_ver: String,
    paths: &LauncherPaths,
) -> AppResult<ResolvedLoaderOverlay> {
    let (artifacts, classpath_entries) =
        collect_forge_library_artifacts(&version.libraries, paths)?;

    let (extra_jvm_args, extra_game_args) = match version.arguments {
        Some(args) => (
            extract_argument_values_for_windows(&args.jvm),
            extract_argument_values_for_windows(&args.game),
        ),
        None => (Vec::new(), Vec::new()),
    };

    Ok(ResolvedLoaderOverlay {
        loader_version: forge_ver,
        main_class: version.main_class,
        extra_jvm_args,
        extra_game_args,
        artifacts,
        classpath_entries,
    })
}

struct MavenInstallerParams {
    loader_label: &'static str,
    cache_dir: PathBuf,
    cache_key_prefix: &'static str,
    full_version: String,
    loader_version: String,
    version_id: String,
    stamp_path: PathBuf,
    installer_url: String,
    installer_filename: String,
}

async fn run_maven_installer_overlay<F>(
    client: &reqwest::Client,
    mc_version: &str,
    javaw_path: &Path,
    paths: &LauncherPaths,
    params: MavenInstallerParams,
    on_progress: F,
) -> AppResult<ResolvedLoaderOverlay>
where
    F: Fn(&str, usize, usize, &str) + Send + Sync + 'static,
{
    let version_json_path = paths.version_json_path(&params.version_id);
    let label = params.loader_label;

    // Fast-path: if ready stamp, version.json and all recorded processor outputs exist, skip installer!
    if tokio::fs::try_exists(&params.stamp_path)
        .await
        .unwrap_or(false)
        && tokio::fs::try_exists(&version_json_path)
            .await
            .unwrap_or(false)
    {
        if let Ok(stamp_raw) = tokio::fs::read_to_string(&params.stamp_path).await {
            if let Ok(stamp) = serde_json::from_str::<ForgeReadyStamp>(&stamp_raw) {
                let mut outputs_ok = stamp.full_version == params.full_version;
                if outputs_ok {
                    for out in &stamp.outputs {
                        if !tokio::fs::try_exists(Path::new(out))
                            .await
                            .unwrap_or(false)
                        {
                            outputs_ok = false;
                            break;
                        }
                    }
                }
                if outputs_ok {
                    if let Ok(ver_raw) = tokio::fs::read_to_string(&version_json_path).await {
                        if let Ok(parsed) = serde_json::from_str::<ForgeVersionJson>(&ver_raw) {
                            return build_forge_overlay_from_version_json(
                                parsed,
                                params.loader_version,
                                paths,
                            );
                        }
                    }
                }
            }
        }
    }

    let phase_prepare = format!("Preparando {label}...");
    let phase_install = format!("Instalando {label}...");

    on_progress(
        &phase_prepare,
        0,
        4,
        &format!("Descargando instalador de {label} {}...", params.full_version),
    );

    tokio::fs::create_dir_all(&params.cache_dir).await?;
    let installer_jar = params.cache_dir.join(&params.installer_filename);

    verify_and_download_all(
        client,
        vec![DownloadArtifact {
            relative_key: format!("{}/{}", params.cache_key_prefix, params.installer_filename),
            url: params.installer_url,
            destination: installer_jar.clone(),
            expected_sha1: None,
            expected_size: None,
        }],
        &paths.integrity_index_path(),
        |_: DownloadProgress| {},
    )
    .await?;

    on_progress(
        &phase_prepare,
        1,
        4,
        &format!("Extrayendo metadatos de {label} {}...", params.full_version),
    );

    let data_extract_root = params.cache_dir.join(&params.full_version);
    let installer_clone = installer_jar.clone();
    let data_root_clone = data_extract_root.clone();
    let libs_dir_clone = paths.shared_libraries_dir();

    let extracted = tokio::task::spawn_blocking(move || {
        extract_forge_installer_blocking(&installer_clone, &data_root_clone, &libs_dir_clone)
    })
    .await
    .map_err(|err| {
        AppError::LoaderError(format!("Error al extraer instalador de {label}: {err}"))
    })??;

    let version_dir = paths.version_dir(&params.version_id);
    tokio::fs::create_dir_all(&version_dir).await?;
    tokio::fs::write(&version_json_path, extracted.version_json_raw.as_bytes()).await?;

    let install_profile: ForgeInstallProfile = serde_json::from_str(&extracted.install_profile_raw)
        .map_err(|err| {
            AppError::LoaderError(format!(
                "No se pudo parsear install_profile.json de {label}: {err}"
            ))
        })?;
    let version_json: ForgeVersionJson = serde_json::from_str(&extracted.version_json_raw)
        .map_err(|err| {
            AppError::LoaderError(format!("No se pudo parsear version.json de {label}: {err}"))
        })?;

    // Download installer-only libraries required by processors
    let (installer_artifacts, _) =
        collect_forge_library_artifacts(&install_profile.libraries, paths)?;
    if !installer_artifacts.is_empty() {
        on_progress(
            &phase_prepare,
            2,
            4,
            &format!(
                "Descargando {} librerías del instalador de {label}...",
                installer_artifacts.len()
            ),
        );
        verify_and_download_all(
            client,
            installer_artifacts,
            &paths.integrity_index_path(),
            |_: DownloadProgress| {},
        )
        .await?;
    }

    // Build processor variable dictionary
    let libraries_dir = paths.shared_libraries_dir();
    let mut vars: HashMap<String, String> = HashMap::new();
    vars.insert(
        "MINECRAFT_JAR".to_string(),
        paths.version_jar_path(mc_version).to_string_lossy().into_owned(),
    );
    vars.insert("SIDE".to_string(), "client".to_string());
    vars.insert("ROOT".to_string(), paths.root().to_string_lossy().into_owned());
    vars.insert(
        "INSTALLER".to_string(),
        installer_jar.to_string_lossy().into_owned(),
    );
    vars.insert(
        "LIBRARY_DIR".to_string(),
        libraries_dir.to_string_lossy().into_owned(),
    );

    for (key, entry) in &install_profile.data {
        if !entry.client.trim().is_empty() {
            let resolved =
                resolve_forge_data_value(&entry.client, &libraries_dir, &data_extract_root)?;
            vars.insert(key.clone(), resolved);
        }
    }

    let client_processors: Vec<&ForgeProcessor> = install_profile
        .processors
        .iter()
        .filter(|p| p.sides.is_empty() || p.sides.iter().any(|s| s.eq_ignore_ascii_case("client")))
        .collect();

    let total_procs = client_processors.len();
    let java_bin = resolve_processor_java_binary(javaw_path);
    let cp_sep = if cfg!(windows) { ";" } else { ":" };
    let mut recorded_outputs: Vec<String> = Vec::new();

    for (idx, proc) in client_processors.iter().enumerate() {
        let mut expected_outputs: Vec<(PathBuf, String)> = Vec::new();
        for (out_key, out_sha) in &proc.outputs {
            let out_path_str = resolve_forge_processor_token(out_key, &vars, &libraries_dir)?;
            let expected_sha = resolve_forge_processor_token(out_sha, &vars, &libraries_dir)?
                .trim_matches('\'')
                .to_string();
            recorded_outputs.push(out_path_str.clone());
            expected_outputs.push((PathBuf::from(out_path_str), expected_sha));
        }

        // Skip processor if all declared outputs already exist and match SHA-1
        if !expected_outputs.is_empty() {
            let mut all_valid = true;
            for (out_path, expected_sha) in &expected_outputs {
                if !tokio::fs::try_exists(out_path).await.unwrap_or(false) {
                    all_valid = false;
                    break;
                }
                if !expected_sha.is_empty() {
                    match compute_file_sha1_hex(out_path).await {
                        Ok(actual) if actual.eq_ignore_ascii_case(expected_sha) => {}
                        _ => {
                            all_valid = false;
                            break;
                        }
                    }
                }
            }
            if all_valid {
                continue;
            }
        }

        on_progress(
            &phase_install,
            idx + 1,
            total_procs.max(1),
            &format!(
                "Aplicando parches de {label} ({}/{})...",
                idx + 1,
                total_procs.max(1)
            ),
        );

        let proc_jar_rel = maven_coords_to_relative_path(&proc.jar)?;
        let proc_jar_path = libraries_dir.join(proc_jar_rel);
        if !tokio::fs::try_exists(&proc_jar_path).await.unwrap_or(false) {
            return Err(AppError::LoaderError(format!(
                "Falta el processor JAR de {label}: {}",
                proc_jar_path.display()
            )));
        }

        let jar_for_manifest = proc_jar_path.clone();
        let main_class =
            tokio::task::spawn_blocking(move || read_jar_main_class_blocking(&jar_for_manifest))
                .await
                .map_err(|err| {
                    AppError::LoaderError(format!("Error leyendo MANIFEST.MF de {label}: {err}"))
                })??;

        // Include BOTH proc.jar AND every entry in proc.classpath in -cp
        let mut cp_parts: Vec<String> = Vec::with_capacity(proc.classpath.len() + 1);
        cp_parts.push(proc_jar_path.to_string_lossy().into_owned());
        for cp_coords in &proc.classpath {
            let rel = maven_coords_to_relative_path(cp_coords)?;
            cp_parts.push(libraries_dir.join(rel).to_string_lossy().into_owned());
        }
        let classpath_str = cp_parts.join(cp_sep);

        let mut resolved_args = Vec::with_capacity(proc.args.len());
        for arg in &proc.args {
            resolved_args.push(resolve_forge_processor_token(arg, &vars, &libraries_dir)?);
        }

        let mut cmd = tokio::process::Command::new(&java_bin);
        cmd.arg("-cp")
            .arg(&classpath_str)
            .arg(&main_class)
            .args(&resolved_args);

        #[cfg(windows)]
        {
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let output = cmd.output().await.map_err(|err| {
            AppError::LoaderError(format!(
                "No se pudo ejecutar el processor de {label} '{}': {err}",
                proc.jar
            ))
        })?;

        if !output.status.success() {
            let stderr_txt = String::from_utf8_lossy(&output.stderr);
            let stdout_txt = String::from_utf8_lossy(&output.stdout);
            let snippet = if !stderr_txt.trim().is_empty() {
                stderr_txt.trim()
            } else {
                stdout_txt.trim()
            };
            let truncated: String = snippet.chars().take(400).collect();
            return Err(AppError::LoaderError(format!(
                "Processor de {label} '{}' falló (código {:?}): {truncated}",
                proc.jar,
                output.status.code()
            )));
        }
    }

    // Write ready stamp atomically
    let stamp = ForgeReadyStamp {
        full_version: params.full_version,
        outputs: recorded_outputs,
    };
    let stamp_tmp = params.stamp_path.with_extension("tmp");
    let serialized = serde_json::to_vec_pretty(&stamp)?;
    tokio::fs::write(&stamp_tmp, &serialized).await?;
    if tokio::fs::rename(&stamp_tmp, &params.stamp_path)
        .await
        .is_err()
    {
        let _ = tokio::fs::remove_file(&stamp_tmp).await;
        tokio::fs::write(&params.stamp_path, &serialized).await?;
    }

    build_forge_overlay_from_version_json(version_json, params.loader_version, paths)
}

pub async fn resolve_forge_overlay<F>(
    client: &reqwest::Client,
    mc_version: &str,
    loader_version: Option<&str>,
    javaw_path: &Path,
    paths: &LauncherPaths,
    on_progress: F,
) -> AppResult<ResolvedLoaderOverlay>
where
    F: Fn(&str, usize, usize, &str) + Send + Sync + 'static,
{
    let forge_ver = resolve_forge_version_number(client, mc_version, loader_version, paths).await?;
    let full_version = format!("{mc_version}-{forge_ver}");
    let forge_version_id = format!("{mc_version}-forge-{forge_ver}");
    let installer_url = build_installer_maven_url(&FORGE_DESCRIPTOR, &full_version)?;

    run_maven_installer_overlay(
        client,
        mc_version,
        javaw_path,
        paths,
        MavenInstallerParams {
            loader_label: "Forge",
            cache_dir: paths.shared_forge_cache_dir(),
            cache_key_prefix: "cache/forge",
            installer_filename: format!("forge-{full_version}-installer.jar"),
            full_version,
            loader_version: forge_ver,
            stamp_path: paths.forge_ready_stamp_path(&forge_version_id),
            version_id: forge_version_id,
            installer_url,
        },
        on_progress,
    )
    .await
}

pub async fn resolve_neoforge_overlay<F>(
    client: &reqwest::Client,
    mc_version: &str,
    loader_version: Option<&str>,
    javaw_path: &Path,
    paths: &LauncherPaths,
    on_progress: F,
) -> AppResult<ResolvedLoaderOverlay>
where
    F: Fn(&str, usize, usize, &str) + Send + Sync + 'static,
{
    let nf_ver = resolve_neoforge_version_number(client, mc_version, loader_version, paths).await?;
    let nf_version_id = format!("neoforge-{nf_ver}");
    let installer_url = build_installer_maven_url(&NEOFORGE_DESCRIPTOR, &nf_ver)?;

    run_maven_installer_overlay(
        client,
        mc_version,
        javaw_path,
        paths,
        MavenInstallerParams {
            loader_label: "NeoForge",
            cache_dir: paths.shared_neoforge_cache_dir(),
            cache_key_prefix: "cache/neoforge",
            installer_filename: format!("neoforge-{nf_ver}-installer.jar"),
            full_version: nf_ver.clone(),
            loader_version: nf_ver,
            stamp_path: paths.neoforge_ready_stamp_path(&nf_version_id),
            version_id: nf_version_id,
            installer_url,
        },
        on_progress,
    )
    .await
}

fn classpath_dedup_key(path: &Path, libraries_dir: &Path) -> String {
    if let Ok(rel) = path.strip_prefix(libraries_dir) {
        let comps: Vec<String> = rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect();
        if comps.len() >= 4 {
            let group = comps[..comps.len() - 3].join(".");
            let artifact = &comps[comps.len() - 3];
            let version = &comps[comps.len() - 2];
            let file_name = &comps[comps.len() - 1];
            let stem = Path::new(file_name)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(file_name);
            let prefix = format!("{artifact}-{version}-");
            if let Some(classifier) = stem.strip_prefix(&prefix) {
                if !classifier.is_empty() {
                    return format!("maven:{group}:{artifact}:{classifier}");
                }
            }
            return format!("maven:{group}:{artifact}");
        }
    }
    format!("path:{}", path.to_string_lossy().to_lowercase())
}

pub fn merge_overlay_into_plan_dedup(
    base_plan: &mut DownloadPlan,
    overlay: ResolvedLoaderOverlay,
    libraries_dir: &Path,
) -> (String, Vec<String>, Vec<String>) {
    let mut seen_keys: HashSet<String> = HashSet::new();
    let mut merged_classpath: Vec<PathBuf> =
        Vec::with_capacity(overlay.classpath_entries.len() + base_plan.classpath_entries.len());

    for entry in overlay
        .classpath_entries
        .into_iter()
        .chain(base_plan.classpath_entries.drain(..))
    {
        let key = classpath_dedup_key(&entry, libraries_dir);
        if seen_keys.insert(key) {
            merged_classpath.push(entry);
        }
    }

    base_plan.classpath_entries = merged_classpath;

    let mut overlay_artifacts = overlay.artifacts;
    base_plan.artifacts.append(&mut overlay_artifacts);

    (
        overlay.main_class,
        overlay.extra_jvm_args,
        overlay.extra_game_args,
    )
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
    use std::collections::HashMap;
    use std::path::PathBuf;

    use super::{
        build_fabric_overlay_from_profile, build_installer_maven_url, merge_overlay_into_plan,
        merge_overlay_into_plan_dedup, parse_manifest_main_class, resolve_forge_data_value,
        resolve_forge_processor_token, resolve_forge_version_from_maven_metadata_xml,
        resolve_forge_version_from_promotions, FabricProfileJson, ResolvedLoaderOverlay,
        FORGE_DESCRIPTOR, NEOFORGE_DESCRIPTOR,
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

    #[test]
    fn test_forge_promotions_resolution_and_maven_metadata_fallback() {
        let mut promos = HashMap::new();
        promos.insert("1.20.1-recommended".to_string(), "47.4.28".to_string());
        promos.insert("1.20.1-latest".to_string(), "47.4.29".to_string());
        promos.insert("1.21.4-latest".to_string(), "54.1.0".to_string());

        assert_eq!(
            resolve_forge_version_from_promotions(&promos, "1.20.1").as_deref(),
            Some("47.4.28")
        );
        assert_eq!(
            resolve_forge_version_from_promotions(&promos, "1.21.4").as_deref(),
            Some("54.1.0")
        );
        assert!(resolve_forge_version_from_promotions(&promos, "1.19.4").is_none());

        let xml = r#"
            <metadata>
              <versioning>
                <versions>
                  <version>1.19.4-45.1.0</version>
                  <version>1.19.4-45.2.0</version>
                  <version>1.19.4-45.3.11</version>
                  <version>1.20.1-47.4.29</version>
                </versions>
              </versioning>
            </metadata>
        "#;
        assert_eq!(
            resolve_forge_version_from_maven_metadata_xml(xml, "1.19.4").as_deref(),
            Some("45.3.11")
        );
    }

    #[test]
    fn test_forge_processor_arg_and_data_resolution() -> Result<(), Box<dyn std::error::Error>> {
        let libs = PathBuf::from("C:/vexel/shared/libraries");
        let data_root = PathBuf::from("C:/vexel/shared/cache/forge/1.20.1-47.4.28");

        let patched = resolve_forge_data_value(
            "[net.minecraft:client:1.20.1-20230612.114412:srg@jar]",
            &libs,
            &data_root,
        )?;
        assert!(patched.ends_with("client-1.20.1-20230612.114412-srg.jar"));

        let binpatch = resolve_forge_data_value("/data/client.lzma", &libs, &data_root)?;
        assert!(binpatch.ends_with("client.lzma"));

        let literal = resolve_forge_data_value("'abc123def'", &libs, &data_root)?;
        assert_eq!(literal, "abc123def");

        let mut vars = HashMap::new();
        vars.insert("MINECRAFT_JAR".to_string(), "C:/vexel/1.20.1.jar".to_string());
        vars.insert("BINPATCH".to_string(), binpatch.clone());

        assert_eq!(
            resolve_forge_processor_token("{MINECRAFT_JAR}", &vars, &libs)?,
            "C:/vexel/1.20.1.jar"
        );
        assert_eq!(
            resolve_forge_processor_token("{BINPATCH}", &vars, &libs)?,
            binpatch
        );
        let direct_maven = resolve_forge_processor_token(
            "[net.minecraftforge:forge:1.20.1-47.4.28:client]",
            &vars,
            &libs,
        )?;
        assert!(direct_maven.ends_with("forge-1.20.1-47.4.28-client.jar"));
        Ok(())
    }

    #[test]
    fn test_manifest_mf_main_class_parsing() {
        let manifest = "Manifest-Version: 1.0\r\nMain-Class: net.minecraftforge.binarypatcher.\r\n ConsoleTool\r\nImplementation-Version: 1.1.1\r\n";
        assert_eq!(
            parse_manifest_main_class(manifest).as_deref(),
            Some("net.minecraftforge.binarypatcher.ConsoleTool")
        );
    }

    #[test]
    fn test_merge_overlay_deduplicates_maven_libraries() {
        let libs = PathBuf::from("C:/vexel/shared/libraries");
        let asm_new = libs.join("org/ow2/asm/asm/9.7/asm-9.7.jar");
        let asm_old = libs.join("org/ow2/asm/asm/9.3/asm-9.3.jar");
        let forge_client = libs.join("net/minecraftforge/forge/1.20.1-47.4.28/forge-1.20.1-47.4.28-client.jar");
        let forge_universal = libs.join("net/minecraftforge/forge/1.20.1-47.4.28/forge-1.20.1-47.4.28-universal.jar");
        let vanilla_jar = PathBuf::from("C:/vexel/shared/versions/1.20.1/1.20.1.jar");

        let mut base_plan = DownloadPlan {
            artifacts: Vec::new(),
            classpath_entries: vec![asm_old, vanilla_jar.clone()],
            native_archives: Vec::new(),
            logging_jvm_arg: None,
        };

        let overlay = ResolvedLoaderOverlay {
            loader_version: "47.4.28".to_string(),
            main_class: "cpw.mods.bootstraplauncher.BootstrapLauncher".to_string(),
            extra_jvm_args: Vec::new(),
            extra_game_args: Vec::new(),
            artifacts: Vec::new(),
            classpath_entries: vec![asm_new.clone(), forge_client.clone(), forge_universal.clone()],
        };

        merge_overlay_into_plan_dedup(&mut base_plan, overlay, &libs);
        // asm-9.3 must be deduplicated in favor of overlay's asm-9.7, while distinct classifiers (-client vs -universal) stay!
        assert_eq!(
            base_plan.classpath_entries,
            vec![asm_new, forge_client, forge_universal, vanilla_jar]
        );
    }

    #[test]
    fn test_neoforge_prefix_and_stable_vs_beta_resolution() {
        assert_eq!(super::mc_version_to_neoforge_prefix("1.20.4").as_deref(), Some("20.4."));
        assert_eq!(super::mc_version_to_neoforge_prefix("1.21").as_deref(), Some("21.0."));
        assert_eq!(super::mc_version_to_neoforge_prefix("1.21.1").as_deref(), Some("21.1."));
        assert!(super::mc_version_to_neoforge_prefix("1.19.2").is_none());

        let xml = r#"
            <metadata>
              <versioning>
                <versions>
                  <version>21.1.10-beta</version>
                  <version>21.1.95</version>
                  <version>21.1.120-beta</version>
                  <version>21.1.118</version>
                  <version>21.4.2-beta</version>
                  <version>21.4.15-beta</version>
                </versions>
              </versioning>
            </metadata>
        "#;
        // Must pick highest STABLE (21.1.118) over newer -beta (21.1.120-beta)
        assert_eq!(
            super::resolve_neoforge_version_from_maven_metadata_xml(xml, "1.21.1").as_deref(),
            Some("21.1.118")
        );
        // Falls back to highest -beta when no stable exists for that MC version
        assert_eq!(
            super::resolve_neoforge_version_from_maven_metadata_xml(xml, "1.21.4").as_deref(),
            Some("21.4.15-beta")
        );
    }
}
