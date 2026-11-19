use std::fs::File;
use std::path::{Component, Path, PathBuf};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;

use crate::core::paths::LauncherPaths;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum JavaRuntimeStatus {
    Installed {
        major: u32,
        javaw_path: String,
    },
    Missing {
        major: u32,
        adoptium_url: String,
    },
}

#[must_use]
pub fn adoptium_download_url(major: u32) -> String {
    format!(
        "https://api.adoptium.net/v3/binary/latest/{major}/ga/windows/x64/jre/hotspot/normal/eclipse"
    )
}

async fn find_javaw_in_dir(runtime_dir: &Path) -> AppResult<Option<PathBuf>> {
    let direct = runtime_dir.join("bin").join("javaw.exe");
    if tokio::fs::try_exists(&direct).await? {
        return Ok(Some(direct));
    }

    if !tokio::fs::try_exists(runtime_dir).await? {
        return Ok(None);
    }

    let mut entries = tokio::fs::read_dir(runtime_dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        let meta = entry.metadata().await?;
        if meta.is_dir() {
            let nested = entry.path().join("bin").join("javaw.exe");
            if tokio::fs::try_exists(&nested).await? {
                return Ok(Some(nested));
            }
        }
    }

    Ok(None)
}

pub async fn check_java_runtime(
    major: u32,
    paths: &LauncherPaths,
) -> AppResult<JavaRuntimeStatus> {
    let runtime_dir = paths.runtime_dir(major);
    if let Some(javaw_path) = find_javaw_in_dir(&runtime_dir).await? {
        return Ok(JavaRuntimeStatus::Installed {
            major,
            javaw_path: javaw_path.to_string_lossy().into_owned(),
        });
    }

    Ok(JavaRuntimeStatus::Missing {
        major,
        adoptium_url: adoptium_download_url(major),
    })
}

fn extract_jre_zip_blocking(zip_path: &Path, target_dir: &Path) -> AppResult<()> {
    let file = File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;
        let Some(enclosed) = entry.enclosed_name() else {
            continue;
        };

        let components: Vec<Component<'_>> = enclosed.components().collect();
        let stripped: PathBuf = if components.len() > 1 {
            components[1..].iter().collect()
        } else {
            components.iter().collect()
        };

        if stripped.as_os_str().is_empty() {
            continue;
        }

        let out_path = target_dir.join(&stripped);
        if entry.is_dir() {
            std::fs::create_dir_all(&out_path)?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut out_file = File::create(&out_path)?;
            std::io::copy(&mut entry, &mut out_file)?;
        }
    }

    Ok(())
}

pub async fn install_java_runtime<F>(
    client: &reqwest::Client,
    major: u32,
    paths: &LauncherPaths,
    on_progress: F,
) -> AppResult<PathBuf>
where
    F: Fn(u64, Option<u64>, &str) + Send + Sync,
{
    let url = adoptium_download_url(major);
    let cache_dir = paths.shared_cache_dir();
    tokio::fs::create_dir_all(&cache_dir).await?;
    let zip_path = cache_dir.join(format!("adoptium-jre-{major}.zip"));

    on_progress(0, None, &format!("Conectando con Eclipse Adoptium (Java {major})..."));

    let response = client.get(&url).send().await?.error_for_status()?;
    let total_bytes = response.content_length();
    let mut stream = response.bytes_stream();
    let mut zip_file = tokio::fs::File::create(&zip_path).await?;
    let mut downloaded = 0_u64;

    while let Some(chunk_res) = stream.next().await {
        let chunk = chunk_res?;
        zip_file.write_all(&chunk).await?;
        downloaded += chunk.len() as u64;
        on_progress(
            downloaded,
            total_bytes,
            &format!("Descargando Adoptium JRE {major}"),
        );
    }
    zip_file.flush().await?;
    drop(zip_file);

    on_progress(
        downloaded,
        total_bytes,
        &format!("Extrayendo Java {major} en shared/runtimes/java-{major}..."),
    );

    let runtime_dir = paths.runtime_dir(major);
    tokio::fs::create_dir_all(&runtime_dir).await?;

    let zip_clone = zip_path.clone();
    let target_clone = runtime_dir.clone();
    tokio::task::spawn_blocking(move || extract_jre_zip_blocking(&zip_clone, &target_clone))
        .await
        .map_err(|err| AppError::ConfigError(format!("JRE extraction task failed: {err}")))??;

    let _ = tokio::fs::remove_file(&zip_path).await;

    find_javaw_in_dir(&runtime_dir)
        .await?
        .ok_or(AppError::JavaNotFound {
            required_major: major,
        })
}
