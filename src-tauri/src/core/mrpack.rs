use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha1::{Digest as _, Sha1};
use sha2::Sha512;
use tokio::io::AsyncWriteExt;
use tokio::sync::Semaphore;

use crate::core::downloader::{append_part_extension, DownloadProgress};
use crate::core::instance::{ModLoaderKind, Profile};
use crate::core::paths::LauncherPaths;
use crate::error::{AppError, AppResult};

const MAX_MRPACK_CONCURRENT_DOWNLOADS: usize = 12;
const MAX_MRPACK_DOWNLOAD_ATTEMPTS: usize = 3;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModrinthPackIndex {
    pub format_version: u32,
    pub game: String,
    #[serde(default)]
    pub version_id: String,
    pub name: String,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub files: Vec<ModrinthPackFile>,
    #[serde(default)]
    pub dependencies: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModrinthPackFile {
    pub path: String,
    #[serde(default)]
    pub hashes: ModrinthPackHashes,
    #[serde(default)]
    pub env: Option<ModrinthPackEnv>,
    #[serde(default)]
    pub downloads: Vec<String>,
    #[serde(default)]
    pub file_size: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModrinthPackHashes {
    #[serde(default)]
    pub sha1: Option<String>,
    #[serde(default)]
    pub sha512: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModrinthPackEnv {
    #[serde(default)]
    pub client: Option<String>,
    #[serde(default)]
    pub server: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MrpackImportResult {
    pub profile: Profile,
    pub downloaded_files: usize,
    pub extracted_overrides: usize,
    pub skipped_server_only: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct MrpackExportResult {
    pub output_path: String,
    pub file_name: String,
    pub modrinth_files_count: usize,
    pub override_files_count: usize,
    pub size_bytes: u64,
}

/// Strictly validates a relative path inside a `.mrpack` (`files[].path`, `overrides/*`, `client-overrides/*`).
/// Rejects empty paths, absolute paths, Windows drive prefixes (`C:`), `..`, `.`, and any control chars.
pub fn validate_mrpack_relative_path(raw: &str) -> AppResult<PathBuf> {
    let normalized = raw.trim().replace('\\', "/");
    if normalized.is_empty()
        || normalized.starts_with('/')
        || normalized.chars().any(|c| c.is_control())
    {
        return Err(AppError::ContentError(format!(
            "Ruta insegura en .mrpack rechazada: '{raw}'"
        )));
    }

    let mut clean = PathBuf::new();
    for segment in normalized.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." || segment.contains(':') {
            return Err(AppError::ContentError(format!(
                "Ruta insegura en .mrpack rechazada: '{raw}'"
            )));
        }
        clean.push(segment);
    }

    if clean.as_os_str().is_empty()
        || !clean
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
    {
        return Err(AppError::ContentError(format!(
            "Ruta insegura en .mrpack rechazada: '{raw}'"
        )));
    }

    Ok(clean)
}

#[must_use]
pub fn is_allowed_mrpack_download_url(url: &str) -> bool {
    let trimmed = url.trim();
    trimmed.starts_with("https://") && !trimmed.chars().any(|c| c.is_whitespace() || c.is_control())
}

#[must_use]
pub fn should_include_mrpack_file_on_client(file: &ModrinthPackFile) -> bool {
    !file
        .env
        .as_ref()
        .and_then(|e| e.client.as_deref())
        .is_some_and(|v| v.eq_ignore_ascii_case("unsupported"))
}

pub fn detect_loader_from_dependencies(
    deps: &HashMap<String, String>,
) -> AppResult<(String, ModLoaderKind, Option<String>)> {
    let mc_version = deps
        .get("minecraft")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::ContentError(
                "El archivo modrinth.index.json no especifica la versión de Minecraft.".to_string(),
            )
        })?;

    if let Some(ver) = deps.get("fabric-loader").filter(|s| !s.trim().is_empty()) {
        return Ok((mc_version, ModLoaderKind::Fabric, Some(ver.trim().to_string())));
    }
    if let Some(ver) = deps.get("neoforge").filter(|s| !s.trim().is_empty()) {
        return Ok((mc_version, ModLoaderKind::NeoForge, Some(ver.trim().to_string())));
    }
    if let Some(ver) = deps.get("forge").filter(|s| !s.trim().is_empty()) {
        return Ok((mc_version, ModLoaderKind::Forge, Some(ver.trim().to_string())));
    }
    Ok((mc_version, ModLoaderKind::Vanilla, None))
}

#[must_use]
pub fn slugify_profile_name(name: &str) -> String {
    let mut slug = String::new();
    let mut prev_dash = false;
    for ch in name.to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            prev_dash = false;
        } else if !prev_dash && !slug.is_empty() {
            slug.push('-');
            prev_dash = true;
        }
    }
    let trimmed = slug.trim_matches('-');
    let base = if trimmed.is_empty() {
        "modpack"
    } else {
        trimmed
    };
    let short_uid = &uuid::Uuid::new_v4().simple().to_string()[..6];
    format!("{base}-{short_uid}")
}

pub fn read_mrpack_index_blocking(mrpack_path: &Path) -> AppResult<ModrinthPackIndex> {
    let file = File::open(mrpack_path).map_err(|err| {
        AppError::ContentError(format!("No se pudo abrir el archivo .mrpack: {err}"))
    })?;
    let mut archive = zip::ZipArchive::new(file).map_err(|err| {
        AppError::ContentError(format!("El archivo .mrpack no es un ZIP válido: {err}"))
    })?;
    let mut entry = archive.by_name("modrinth.index.json").map_err(|_| {
        AppError::ContentError(
            "El archivo .mrpack no contiene modrinth.index.json en la raíz.".to_string(),
        )
    })?;
    let mut raw = String::new();
    entry.read_to_string(&mut raw)?;
    let index: ModrinthPackIndex = serde_json::from_str(&raw).map_err(|err| {
        AppError::ContentError(format!("modrinth.index.json inválido: {err}"))
    })?;

    if index.format_version != 1 {
        return Err(AppError::ContentError(format!(
            "Versión de formato .mrpack no soportada: {} (se esperaba 1)",
            index.format_version
        )));
    }
    if !index.game.eq_ignore_ascii_case("minecraft") {
        return Err(AppError::ContentError(format!(
            "Este .mrpack pertenece al juego '{}' y no a Minecraft.",
            index.game
        )));
    }

    Ok(index)
}

fn extract_mrpack_overrides_blocking(mrpack_path: &Path, instance_dir: &Path) -> AppResult<usize> {
    let file = File::open(mrpack_path)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|err| AppError::ContentError(format!("ZIP .mrpack inválido: {err}")))?;

    // Extract overrides/ first, then client-overrides/ so client overrides take precedence
    let mut extracted_count = 0_usize;
    for prefix in ["overrides/", "client-overrides/"] {
        for idx in 0..archive.len() {
            let mut entry = archive.by_index(idx).map_err(|err| {
                AppError::ContentError(format!("Error leyendo entrada de .mrpack: {err}"))
            })?;
            if entry.is_dir() {
                continue;
            }
            let name = entry.name().replace('\\', "/");
            let Some(rel_raw) = name.strip_prefix(prefix) else {
                continue;
            };
            let rel = validate_mrpack_relative_path(rel_raw)?;
            let dest = instance_dir.join(&rel);
            if !dest.starts_with(instance_dir) {
                return Err(AppError::ContentError(format!(
                    "Ruta de override fuera de la instancia: '{name}'"
                )));
            }
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut out = File::create(&dest)?;
            std::io::copy(&mut entry, &mut out)?;
            extracted_count += 1;
        }
    }
    Ok(extracted_count)
}

async fn download_mrpack_single_file(
    client: &reqwest::Client,
    file_spec: &ModrinthPackFile,
    dest: &Path,
    bytes_counter: &AtomicU64,
) -> AppResult<()> {
    let https_urls: Vec<&str> = file_spec
        .downloads
        .iter()
        .map(String::as_str)
        .filter(|u| is_allowed_mrpack_download_url(u))
        .collect();

    if https_urls.is_empty() {
        return Err(AppError::ContentError(format!(
            "El archivo '{}' no tiene ninguna URL HTTPS válida en el .mrpack.",
            file_spec.path
        )));
    }

    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let part_path = append_part_extension(dest);
    let mut last_err: Option<AppError> = None;

    for url in https_urls {
        for attempt in 1..=MAX_MRPACK_DOWNLOAD_ATTEMPTS {
            match client.get(url).send().await {
                Ok(resp) if resp.status().is_success() => {
                    let mut stream = resp.bytes_stream();
                    let mut out = tokio::fs::File::create(&part_path).await?;
                    let mut sha1_hasher = Sha1::new();
                    let mut sha512_hasher = Sha512::new();
                    let mut stream_err: Option<AppError> = None;

                    while let Some(chunk_res) = stream.next().await {
                        match chunk_res {
                            Ok(chunk) => {
                                sha1_hasher.update(&chunk);
                                sha512_hasher.update(&chunk);
                                out.write_all(&chunk).await?;
                                bytes_counter.fetch_add(chunk.len() as u64, Ordering::Relaxed);
                            }
                            Err(err) => {
                                stream_err = Some(AppError::Network(err));
                                break;
                            }
                        }
                    }
                    let _ = out.flush().await;
                    drop(out);

                    if let Some(err) = stream_err {
                        let _ = tokio::fs::remove_file(&part_path).await;
                        last_err = Some(err);
                        if attempt < MAX_MRPACK_DOWNLOAD_ATTEMPTS {
                            tokio::time::sleep(Duration::from_millis(350 * attempt as u64)).await;
                            continue;
                        }
                        break;
                    }

                    let actual_sha1 = hex::encode(sha1_hasher.finalize());
                    let actual_sha512 = hex::encode(sha512_hasher.finalize());

                    if let Some(expected) = file_spec.hashes.sha1.as_deref().filter(|s| !s.is_empty())
                    {
                        if !actual_sha1.eq_ignore_ascii_case(expected) {
                            let _ = tokio::fs::remove_file(&part_path).await;
                            last_err = Some(AppError::ContentError(format!(
                                "Hash SHA-1 inválido para '{}' (esperado {expected}, obtenido {actual_sha1})",
                                file_spec.path
                            )));
                            break;
                        }
                    }
                    if let Some(expected) =
                        file_spec.hashes.sha512.as_deref().filter(|s| !s.is_empty())
                    {
                        if !actual_sha512.eq_ignore_ascii_case(expected) {
                            let _ = tokio::fs::remove_file(&part_path).await;
                            last_err = Some(AppError::ContentError(format!(
                                "Hash SHA-512 inválido para '{}' (esperado {expected}, obtenido {actual_sha512})",
                                file_spec.path
                            )));
                            break;
                        }
                    }

                    if tokio::fs::rename(&part_path, dest).await.is_err() {
                        let _ = tokio::fs::remove_file(dest).await;
                        tokio::fs::rename(&part_path, dest).await?;
                    }
                    return Ok(());
                }
                Ok(resp) => {
                    let status = resp.status();
                    last_err = Some(AppError::ContentError(format!(
                        "Error HTTP {status} descargando {}",
                        file_spec.path
                    )));
                    if attempt < MAX_MRPACK_DOWNLOAD_ATTEMPTS {
                        tokio::time::sleep(Duration::from_millis(350 * attempt as u64)).await;
                        continue;
                    }
                }
                Err(err) => {
                    last_err = Some(AppError::Network(err));
                    if attempt < MAX_MRPACK_DOWNLOAD_ATTEMPTS {
                        tokio::time::sleep(Duration::from_millis(350 * attempt as u64)).await;
                        continue;
                    }
                }
            }
        }
    }

    Err(last_err.unwrap_or_else(|| {
        AppError::ContentError(format!("No se pudo descargar '{}'", file_spec.path))
    }))
}

pub async fn populate_instance_from_mrpack<F>(
    client: &reqwest::Client,
    mrpack_path: &Path,
    index: &ModrinthPackIndex,
    instance_dir: &Path,
    on_progress: F,
) -> AppResult<(usize, usize, usize)>
where
    F: Fn(DownloadProgress) + Send + Sync + 'static,
{
    let mut client_files: Vec<(ModrinthPackFile, PathBuf)> = Vec::new();
    let mut skipped_server_only = 0_usize;

    for f in &index.files {
        if !should_include_mrpack_file_on_client(f) {
            skipped_server_only += 1;
            continue;
        }
        let rel = validate_mrpack_relative_path(&f.path)?;
        let dest = instance_dir.join(&rel);
        if !dest.starts_with(instance_dir) {
            return Err(AppError::ContentError(format!(
                "Ruta fuera de la instancia rechazada: '{}'",
                f.path
            )));
        }
        client_files.push((f.clone(), dest));
    }

    let total_files = client_files.len();
    let completed = Arc::new(AtomicUsize::new(0));
    let bytes_counter = Arc::new(AtomicU64::new(0));
    let semaphore = Arc::new(Semaphore::new(MAX_MRPACK_CONCURRENT_DOWNLOADS));
    let progress_cb = Arc::new(on_progress);

    progress_cb(DownloadProgress {
        phase: "Importando modpack...".to_string(),
        completed_files: 0,
        total_files: total_files.max(1),
        bytes_downloaded: 0,
        current_file: format!("Descargando {total_files} archivos del modpack..."),
        fast_path_hits: 0,
    });

    let mut handles = Vec::with_capacity(total_files);
    for (file_spec, dest) in client_files {
        let sem = Arc::clone(&semaphore);
        let client_clone = client.clone();
        let completed_ref = Arc::clone(&completed);
        let bytes_ref = Arc::clone(&bytes_counter);
        let cb_ref = Arc::clone(&progress_cb);

        handles.push(tokio::spawn(async move {
            let _permit = sem
                .acquire_owned()
                .await
                .map_err(|err| AppError::ContentError(format!("Semáforo cerrado: {err}")))?;
            download_mrpack_single_file(&client_clone, &file_spec, &dest, &bytes_ref).await?;
            let done = completed_ref.fetch_add(1, Ordering::Relaxed) + 1;
            cb_ref(DownloadProgress {
                phase: "Descargando mods del pack...".to_string(),
                completed_files: done,
                total_files: total_files.max(1),
                bytes_downloaded: bytes_ref.load(Ordering::Relaxed),
                current_file: file_spec.path,
                fast_path_hits: 0,
            });
            Ok::<(), AppError>(())
        }));
    }

    for handle in handles {
        handle
            .await
            .map_err(|err| AppError::ContentError(format!("Tarea de descarga falló: {err}")))??;
    }

    progress_cb(DownloadProgress {
        phase: "Extrayendo configuraciones...".to_string(),
        completed_files: total_files,
        total_files: total_files.max(1),
        bytes_downloaded: bytes_counter.load(Ordering::Relaxed),
        current_file: "Aplicando overrides del modpack...".to_string(),
        fast_path_hits: 0,
    });

    let mrpack_clone = mrpack_path.to_path_buf();
    let inst_clone = instance_dir.to_path_buf();
    let extracted_overrides = tokio::task::spawn_blocking(move || {
        extract_mrpack_overrides_blocking(&mrpack_clone, &inst_clone)
    })
    .await
    .map_err(|err| AppError::ContentError(format!("Error extrayendo overrides: {err}")))??;

    Ok((total_files, extracted_overrides, skipped_server_only))
}

#[derive(Debug, Deserialize)]
struct ModrinthVersionFileLookup {
    files: Vec<ModrinthVersionFileEntry>,
}

#[derive(Debug, Deserialize)]
struct ModrinthVersionFileEntry {
    hashes: ModrinthPackHashes,
    url: String,
    primary: bool,
}

struct ExportCandidate {
    rel_zip_path: String,
    disk_path: PathBuf,
    size: u64,
    sha1: String,
    sha512: String,
    is_content_asset: bool,
}

fn hash_file_sha1_sha512_blocking(path: &Path) -> AppResult<(String, String, u64)> {
    let mut file = File::open(path)?;
    let size = file.metadata()?.len();
    let mut sha1 = Sha1::new();
    let mut sha512 = Sha512::new();
    let mut buf = vec![0_u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        sha1.update(&buf[..n]);
        sha512.update(&buf[..n]);
    }
    Ok((
        hex::encode(sha1.finalize()),
        hex::encode(sha512.finalize()),
        size,
    ))
}

fn collect_dir_files_recursive(
    base_dir: &Path,
    rel_prefix: &str,
    out: &mut Vec<(String, PathBuf)>,
) -> AppResult<()> {
    if !base_dir.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(base_dir)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.is_empty() || name.starts_with('.') {
            continue;
        }
        let rel = format!("{rel_prefix}/{name}");
        let meta = entry.metadata()?;
        if meta.is_dir() {
            collect_dir_files_recursive(&path, &rel, out)?;
        } else if meta.is_file() {
            out.push((rel, path));
        }
    }
    Ok(())
}

fn collect_export_candidates_blocking(
    instance_dir: &Path,
    include_config: bool,
) -> AppResult<Vec<ExportCandidate>> {
    let mut candidates = Vec::new();

    // Only export active mods, resourcepacks and shaderpacks (strictly exclude .disabled & internal skin pack)
    let content_folders = [
        ("mods", ".jar"),
        ("resourcepacks", ".zip"),
        ("shaderpacks", ".zip"),
    ];
    for (folder, expected_ext) in content_folders {
        let dir = instance_dir.join(folder);
        if !dir.exists() {
            continue;
        }
        for entry in std::fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            if !entry.metadata()?.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let lower = name.to_lowercase();
            if !lower.ends_with(expected_ext)
                || lower.ends_with(".disabled")
                || lower == "_launcher_skin.zip"
                || name.starts_with('.')
            {
                continue;
            }
            let (sha1, sha512, size) = hash_file_sha1_sha512_blocking(&path)?;
            candidates.push(ExportCandidate {
                rel_zip_path: format!("{folder}/{name}"),
                disk_path: path,
                size,
                sha1,
                sha512,
                is_content_asset: true,
            });
        }
    }

    if include_config {
        let mut cfg_files = Vec::new();
        collect_dir_files_recursive(&instance_dir.join("config"), "config", &mut cfg_files)?;
        for (rel, path) in cfg_files {
            if rel.ends_with(".bak") || rel.ends_with(".tmp") {
                continue;
            }
            let size = std::fs::metadata(&path).map_or(0, |m| m.len());
            candidates.push(ExportCandidate {
                rel_zip_path: rel,
                disk_path: path,
                size,
                sha1: String::new(),
                sha512: String::new(),
                is_content_asset: false,
            });
        }
    }

    Ok(candidates)
}

async fn batch_lookup_modrinth_hashes(
    client: &reqwest::Client,
    sha1_hashes: &[String],
) -> HashMap<String, String> {
    if sha1_hashes.is_empty() {
        return HashMap::new();
    }
    let body = serde_json::json!({
        "hashes": sha1_hashes,
        "algorithm": "sha1"
    });
    let Ok(resp) = client
        .post("https://api.modrinth.com/v2/version_files")
        .json(&body)
        .send()
        .await
    else {
        return HashMap::new();
    };
    if !resp.status().is_success() {
        return HashMap::new();
    }
    let Ok(map) = resp
        .json::<HashMap<String, ModrinthVersionFileLookup>>()
        .await
    else {
        return HashMap::new();
    };

    let mut urls = HashMap::new();
    for (hash_key, ver) in map {
        let matched = ver
            .files
            .iter()
            .find(|f| {
                f.hashes
                    .sha1
                    .as_deref()
                    .is_some_and(|h| h.eq_ignore_ascii_case(&hash_key))
            })
            .or_else(|| ver.files.iter().find(|f| f.primary))
            .or_else(|| ver.files.first());

        if let Some(file_entry) = matched {
            if is_allowed_mrpack_download_url(&file_entry.url) {
                urls.insert(hash_key.to_lowercase(), file_entry.url.clone());
            }
        }
    }
    urls
}

pub async fn export_instance_to_mrpack(
    client: &reqwest::Client,
    paths: &LauncherPaths,
    profile: &Profile,
    include_config: bool,
    output_dir_override: Option<PathBuf>,
) -> AppResult<MrpackExportResult> {
    let instance_dir = paths.instance_dir(&profile.id);
    let inst_clone = instance_dir.clone();
    let candidates = tokio::task::spawn_blocking(move || {
        collect_export_candidates_blocking(&inst_clone, include_config)
    })
    .await
    .map_err(|err| AppError::ContentError(format!("Error escaneando instancia: {err}")))??;

    let sha1_list: Vec<String> = candidates
        .iter()
        .filter(|c| c.is_content_asset && !c.sha1.is_empty())
        .map(|c| c.sha1.clone())
        .collect();

    let modrinth_urls = batch_lookup_modrinth_hashes(client, &sha1_list).await;

    let mut index_files = Vec::new();
    let mut overrides_to_pack: Vec<(String, PathBuf)> = Vec::new();

    for cand in candidates {
        if cand.is_content_asset {
            if let Some(url) = modrinth_urls.get(&cand.sha1.to_lowercase()) {
                index_files.push(ModrinthPackFile {
                    path: cand.rel_zip_path,
                    hashes: ModrinthPackHashes {
                        sha1: Some(cand.sha1),
                        sha512: Some(cand.sha512),
                    },
                    env: Some(ModrinthPackEnv {
                        client: Some("required".to_string()),
                        server: Some("optional".to_string()),
                    }),
                    downloads: vec![url.clone()],
                    file_size: cand.size,
                });
                continue;
            }
        }
        overrides_to_pack.push((format!("overrides/{}", cand.rel_zip_path), cand.disk_path));
    }

    let mut dependencies = HashMap::new();
    dependencies.insert("minecraft".to_string(), profile.mc_version.clone());
    let loader_ver = profile
        .loader_version
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("latest")
        .to_string();
    match profile.loader {
        ModLoaderKind::Vanilla => {}
        ModLoaderKind::Fabric => {
            dependencies.insert("fabric-loader".to_string(), loader_ver);
        }
        ModLoaderKind::Forge => {
            dependencies.insert("forge".to_string(), loader_ver);
        }
        ModLoaderKind::NeoForge => {
            dependencies.insert("neoforge".to_string(), loader_ver);
        }
    }

    let pack_index = ModrinthPackIndex {
        format_version: 1,
        game: "minecraft".to_string(),
        version_id: "1.0.0".to_string(),
        name: profile.name.clone(),
        summary: Some(format!(
            "Exportado desde Vexel Launcher ({} - Minecraft {})",
            profile.name, profile.mc_version
        )),
        files: index_files,
        dependencies,
    };

    let modrinth_files_count = pack_index.files.len();
    let override_files_count = overrides_to_pack.len();
    let index_json = serde_json::to_string_pretty(&pack_index)?;

    let safe_name: String = profile
        .name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let clean_name = safe_name.trim_matches('_');
    let file_name = format!(
        "{}-{}.mrpack",
        if clean_name.is_empty() {
            "vexel-pack"
        } else {
            clean_name
        },
        profile.mc_version
    );

    let out_dir = match output_dir_override {
        Some(dir) => dir,
        None => directories::UserDirs::new()
            .and_then(|u| u.download_dir().map(Path::to_path_buf))
            .unwrap_or_else(|| paths.root().join("exports")),
    };
    tokio::fs::create_dir_all(&out_dir).await?;
    let output_path = out_dir.join(&file_name);
    let tmp_path = append_part_extension(&output_path);

    let tmp_clone = tmp_path.clone();
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        let file = File::create(&tmp_clone)?;
        let mut writer = zip::ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        writer.start_file("modrinth.index.json", opts)?;
        writer.write_all(index_json.as_bytes())?;

        for (zip_path, disk_path) in overrides_to_pack {
            writer.start_file(&zip_path, opts)?;
            let mut src = File::open(&disk_path)?;
            std::io::copy(&mut src, &mut writer)?;
        }
        writer.finish()?;
        Ok(())
    })
    .await
    .map_err(|err| AppError::ContentError(format!("Error escribiendo .mrpack: {err}")))??;

    if tokio::fs::rename(&tmp_path, &output_path).await.is_err() {
        let _ = tokio::fs::remove_file(&output_path).await;
        tokio::fs::rename(&tmp_path, &output_path).await?;
    }

    let size_bytes = tokio::fs::metadata(&output_path)
        .await
        .map_or(0, |m| m.len());

    Ok(MrpackExportResult {
        output_path: output_path.to_string_lossy().into_owned(),
        file_name,
        modrinth_files_count,
        override_files_count,
        size_bytes,
    })
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::fs::File;

    use super::{
        detect_loader_from_dependencies, export_instance_to_mrpack, is_allowed_mrpack_download_url,
        should_include_mrpack_file_on_client, validate_mrpack_relative_path, ModrinthPackEnv,
        ModrinthPackFile, ModrinthPackHashes,
    };
    use crate::core::instance::{ModLoaderKind, Profile};
    use crate::core::jvm_optimizer::GcPreset;
    use crate::core::paths::LauncherPaths;

    #[test]
    fn test_mrpack_path_traversal_rejection() {
        assert!(validate_mrpack_relative_path("mods/sodium.jar").is_ok());
        assert!(validate_mrpack_relative_path("config/sodium-options.json").is_ok());

        assert!(validate_mrpack_relative_path("../evil.jar").is_err());
        assert!(validate_mrpack_relative_path("mods/../../escape.jar").is_err());
        assert!(validate_mrpack_relative_path("/etc/passwd").is_err());
        assert!(validate_mrpack_relative_path(r"\Windows\System32\evil.dll").is_err());
        assert!(validate_mrpack_relative_path("C:\\Windows\\foo.jar").is_err());
        assert!(validate_mrpack_relative_path("").is_err());

        // URL strict HTTPS validation
        assert!(is_allowed_mrpack_download_url(
            "https://cdn.modrinth.com/data/abc/versions/123/mod.jar"
        ));
        assert!(!is_allowed_mrpack_download_url(
            "http://cdn.modrinth.com/mod.jar"
        ));
        assert!(!is_allowed_mrpack_download_url("file:///C:/evil.jar"));
        assert!(!is_allowed_mrpack_download_url(
            "https://example.com/a b.jar"
        ));
    }

    #[test]
    fn test_mrpack_client_env_filtering_and_dependency_detection()
    -> Result<(), Box<dyn std::error::Error>> {
        let server_only = ModrinthPackFile {
            path: "mods/server-only.jar".to_string(),
            hashes: ModrinthPackHashes::default(),
            env: Some(ModrinthPackEnv {
                client: Some("unsupported".to_string()),
                server: Some("required".to_string()),
            }),
            downloads: vec!["https://cdn.modrinth.com/server.jar".to_string()],
            file_size: 100,
        };
        let client_req = ModrinthPackFile {
            path: "mods/sodium.jar".to_string(),
            hashes: ModrinthPackHashes::default(),
            env: Some(ModrinthPackEnv {
                client: Some("required".to_string()),
                server: Some("unsupported".to_string()),
            }),
            downloads: vec!["https://cdn.modrinth.com/sodium.jar".to_string()],
            file_size: 200,
        };
        assert!(!should_include_mrpack_file_on_client(&server_only));
        assert!(should_include_mrpack_file_on_client(&client_req));

        let mut deps = HashMap::new();
        deps.insert("minecraft".to_string(), "1.21.1".to_string());
        deps.insert("neoforge".to_string(), "21.1.267".to_string());
        let (mc, loader, ver) = detect_loader_from_dependencies(&deps)?;
        assert_eq!(mc, "1.21.1");
        assert_eq!(loader, ModLoaderKind::NeoForge);
        assert_eq!(ver.as_deref(), Some("21.1.267"));

        let mut f_deps = HashMap::new();
        f_deps.insert("minecraft".to_string(), "1.20.1".to_string());
        f_deps.insert("forge".to_string(), "47.4.28".to_string());
        let (_, loader_f, _) = detect_loader_from_dependencies(&f_deps)?;
        assert_eq!(loader_f, ModLoaderKind::Forge);
        Ok(())
    }

    #[tokio::test]
    async fn test_mrpack_export_excludes_saves_and_internal_files()
    -> Result<(), Box<dyn std::error::Error>> {
        let tmp = std::env::temp_dir().join(format!(
            "vexel-mrpack-export-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let paths = LauncherPaths::with_root(tmp.clone());
        paths.ensure_instance_dirs("pack-prof").await?;
        let inst = paths.instance_dir("pack-prof");

        // Active mod, disabled mod, internal skin pack, saves, logs, content_index, config
        tokio::fs::write(inst.join("mods").join("custom-mod.jar"), b"fake-mod-bytes").await?;
        tokio::fs::write(inst.join("mods").join("off-mod.jar.disabled"), b"disabled").await?;
        tokio::fs::write(
            inst.join("resourcepacks").join("_launcher_skin.zip"),
            b"skin",
        )
        .await?;
        tokio::fs::create_dir_all(inst.join("saves").join("MyWorld")).await?;
        tokio::fs::write(
            inst.join("saves").join("MyWorld").join("level.dat"),
            b"world-data",
        )
        .await?;
        tokio::fs::create_dir_all(inst.join("logs")).await?;
        tokio::fs::write(inst.join("logs").join("latest.log"), b"log").await?;
        tokio::fs::write(inst.join(".content_index.json"), b"{}").await?;
        tokio::fs::create_dir_all(inst.join("config")).await?;
        tokio::fs::write(inst.join("config").join("my_mod.toml"), b"enabled = true\n").await?;

        let profile = Profile {
            id: "pack-prof".to_string(),
            name: "Mi Pack".to_string(),
            mc_version: "1.21.1".to_string(),
            loader: ModLoaderKind::NeoForge,
            loader_version: Some("21.1.267".to_string()),
            ram_mb: 6144,
            gc_preset: GcPreset::GenerationalZgc,
            server_address: None,
            is_default: true,
            window_width: None,
            window_height: None,
            fullscreen: false,
            custom_jvm_args: None,
            custom_java_path: None,
        };

        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_millis(500))
            .timeout(std::time::Duration::from_millis(500))
            .build()?;

        let export_dir = tmp.join("out");
        let res =
            export_instance_to_mrpack(&client, &paths, &profile, true, Some(export_dir)).await?;

        let zip_file = File::open(&res.output_path)?;
        let mut archive = zip::ZipArchive::new(zip_file)?;
        let mut names: Vec<String> = Vec::new();
        for i in 0..archive.len() {
            names.push(archive.by_index(i)?.name().to_string());
        }

        assert!(names.contains(&"modrinth.index.json".to_string()));
        assert!(names.contains(&"overrides/mods/custom-mod.jar".to_string()));
        assert!(names.contains(&"overrides/config/my_mod.toml".to_string()));
        // Strictly excluded!
        assert!(!names.iter().any(|n| n.contains("saves/")));
        assert!(!names.iter().any(|n| n.contains("logs/")));
        assert!(!names.iter().any(|n| n.contains(".content_index")));
        assert!(!names.iter().any(|n| n.contains("_launcher_skin")));
        assert!(!names.iter().any(|n| n.contains(".disabled")));

        let _ = tokio::fs::remove_dir_all(&tmp).await;
        Ok(())
    }
}
