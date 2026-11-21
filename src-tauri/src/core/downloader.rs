use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{Mutex, Semaphore};

use crate::error::{AppError, AppResult};

const MAX_CONCURRENT_DOWNLOADS: usize = 12;
const MAX_DOWNLOAD_ATTEMPTS: usize = 3;

#[must_use]
pub fn append_part_extension(destination: &Path) -> PathBuf {
    let mut os = destination.as_os_str().to_os_string();
    os.push(".part");
    PathBuf::from(os)
}

fn is_retryable_status(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::TOO_MANY_REQUESTS
        || status == reqwest::StatusCode::REQUEST_TIMEOUT
        || status.is_server_error()
}

async fn download_with_retries(
    client: &reqwest::Client,
    artifact: &DownloadArtifact,
    part_path: &Path,
    bytes_counter: &std::sync::atomic::AtomicU64,
) -> AppResult<String> {
    let mut last_err: Option<AppError> = None;

    for attempt in 1..=MAX_DOWNLOAD_ATTEMPTS {
        let res = client.get(&artifact.url).send().await;
        match res {
            Ok(resp) => {
                let status = resp.status();
                if !status.is_success() {
                    let retryable = is_retryable_status(status);
                    let err = match resp.error_for_status() {
                        Err(e) => AppError::Network(e),
                        Ok(_) => AppError::ContentError(format!("HTTP error {status}")),
                    };
                    if retryable && attempt < MAX_DOWNLOAD_ATTEMPTS {
                        last_err = Some(err);
                        let backoff_ms = 400_u64.saturating_mul(1_u64 << (attempt - 1));
                        tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
                        continue;
                    }
                    return Err(err);
                }

                let mut stream = resp.bytes_stream();
                let mut file = tokio::fs::File::create(part_path).await?;
                let mut hasher = Sha1::new();
                let mut stream_err: Option<AppError> = None;

                while let Some(chunk_res) = stream.next().await {
                    match chunk_res {
                        Ok(chunk) => {
                            hasher.update(&chunk);
                            file.write_all(&chunk).await?;
                            bytes_counter.fetch_add(
                                chunk.len() as u64,
                                std::sync::atomic::Ordering::Relaxed,
                            );
                        }
                        Err(err) => {
                            stream_err = Some(AppError::Network(err));
                            break;
                        }
                    }
                }
                let _ = file.flush().await;
                drop(file);

                if let Some(err) = stream_err {
                    let _ = tokio::fs::remove_file(part_path).await;
                    if attempt < MAX_DOWNLOAD_ATTEMPTS {
                        last_err = Some(err);
                        let backoff_ms = 400_u64.saturating_mul(1_u64 << (attempt - 1));
                        tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
                        continue;
                    }
                    return Err(err);
                }

                return Ok(hex::encode(hasher.finalize()));
            }
            Err(err) => {
                let _ = tokio::fs::remove_file(part_path).await;
                if attempt < MAX_DOWNLOAD_ATTEMPTS {
                    last_err = Some(AppError::Network(err));
                    let backoff_ms = 400_u64.saturating_mul(1_u64 << (attempt - 1));
                    tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
                    continue;
                }
                return Err(AppError::Network(err));
            }
        }
    }

    Err(last_err.unwrap_or_else(|| {
        AppError::ContentError(format!("Download failed after retries: {}", artifact.url))
    }))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IntegrityEntry {
    pub size: u64,
    pub mtime_secs: u64,
    pub sha1: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct IntegrityIndex {
    pub entries: HashMap<String, IntegrityEntry>,
}

#[derive(Debug, Clone)]
pub struct DownloadArtifact {
    pub relative_key: String,
    pub url: String,
    pub destination: PathBuf,
    pub expected_sha1: Option<String>,
    pub expected_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    pub phase: String,
    pub completed_files: usize,
    pub total_files: usize,
    pub bytes_downloaded: u64,
    pub current_file: String,
    pub fast_path_hits: usize,
}

#[derive(Debug, Clone)]
pub struct DownloadSummary {
    pub total_artifacts: usize,
    pub fast_path_hits: usize,
    pub hashed_from_disk: usize,
    pub downloaded_files: usize,
}

impl IntegrityIndex {
    pub async fn load(path: &Path) -> AppResult<Self> {
        if !tokio::fs::try_exists(path).await? {
            return Ok(Self::default());
        }
        let raw = tokio::fs::read_to_string(path).await?;
        match serde_json::from_str::<Self>(&raw) {
            Ok(idx) => Ok(idx),
            Err(_) => Ok(Self::default()),
        }
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

    #[must_use]
    pub fn is_fast_valid(
        &self,
        key: &str,
        size: u64,
        mtime_secs: u64,
        expected_sha1: Option<&str>,
    ) -> bool {
        let Some(entry) = self.entries.get(key) else {
            return false;
        };
        if entry.size != size || entry.mtime_secs != mtime_secs {
            return false;
        }
        match expected_sha1 {
            Some(expected) => entry.sha1.eq_ignore_ascii_case(expected),
            None => true,
        }
    }
}

async fn read_file_stat(path: &Path) -> AppResult<Option<(u64, u64)>> {
    match tokio::fs::metadata(path).await {
        Ok(meta) if meta.is_file() => {
            let size = meta.len();
            let mtime_secs = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_secs());
            Ok(Some((size, mtime_secs)))
        }
        Ok(_) => Ok(None),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(AppError::Io(err)),
    }
}

pub async fn compute_file_sha1(path: &Path) -> AppResult<String> {
    let mut file = tokio::fs::File::open(path).await?;
    let mut hasher = Sha1::new();
    let mut buffer = vec![0_u8; 64 * 1024];

    loop {
        let n = file.read(&mut buffer).await?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }

    Ok(hex::encode(hasher.finalize()))
}

pub async fn verify_and_download_all<F>(
    client: &reqwest::Client,
    artifacts: Vec<DownloadArtifact>,
    index_path: &Path,
    on_progress: F,
) -> AppResult<DownloadSummary>
where
    F: Fn(DownloadProgress) + Send + Sync + 'static,
{
    let total_artifacts = artifacts.len();
    let mut index = IntegrityIndex::load(index_path).await?;
    let mut fast_path_hits = 0_usize;
    let mut hashed_from_disk = 0_usize;
    let mut pending_downloads = Vec::new();
    let mut index_dirty = false;

    on_progress(DownloadProgress {
        phase: "Verificando caché (Fast-Path)".to_string(),
        completed_files: 0,
        total_files: total_artifacts,
        bytes_downloaded: 0,
        current_file: "Consultando integrity_index.json...".to_string(),
        fast_path_hits: 0,
    });

    for artifact in artifacts {
        if let Some((size, mtime_secs)) = read_file_stat(&artifact.destination).await? {
            if index.is_fast_valid(
                &artifact.relative_key,
                size,
                mtime_secs,
                artifact.expected_sha1.as_deref(),
            ) {
                fast_path_hits += 1;
                continue;
            }

            let actual_sha1 = compute_file_sha1(&artifact.destination).await?;
            hashed_from_disk += 1;
            let matches_expected = match &artifact.expected_sha1 {
                Some(exp) => actual_sha1.eq_ignore_ascii_case(exp),
                None => artifact
                    .expected_size
                    .is_none_or(|exp_size| exp_size == size),
            };

            if matches_expected {
                index.entries.insert(
                    artifact.relative_key.clone(),
                    IntegrityEntry {
                        size,
                        mtime_secs,
                        sha1: actual_sha1,
                    },
                );
                index_dirty = true;
                continue;
            }
        }

        pending_downloads.push(artifact);
    }

    on_progress(DownloadProgress {
        phase: "Verificación completada".to_string(),
        completed_files: fast_path_hits + hashed_from_disk,
        total_files: total_artifacts,
        bytes_downloaded: 0,
        current_file: format!(
            "{fast_path_hits} hits instantáneos, {} pendientes",
            pending_downloads.len()
        ),
        fast_path_hits,
    });

    let pending_count = pending_downloads.len();
    if pending_count == 0 {
        if index_dirty {
            index.save_atomic(index_path).await?;
        }
        return Ok(DownloadSummary {
            total_artifacts,
            fast_path_hits,
            hashed_from_disk,
            downloaded_files: 0,
        });
    }

    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_DOWNLOADS));
    let shared_index = Arc::new(Mutex::new(index));
    let progress_cb = Arc::new(on_progress);
    let completed_counter = Arc::new(std::sync::atomic::AtomicUsize::new(
        fast_path_hits + hashed_from_disk,
    ));
    let bytes_counter = Arc::new(std::sync::atomic::AtomicU64::new(0));

    let mut handles = Vec::with_capacity(pending_count);
    for artifact in pending_downloads {
        let permit = Arc::clone(&semaphore)
            .acquire_owned()
            .await
            .map_err(|_| AppError::ConfigError("Download semaphore closed".to_string()))?;
        let client = client.clone();
        let shared_index = Arc::clone(&shared_index);
        let progress_cb = Arc::clone(&progress_cb);
        let completed_counter = Arc::clone(&completed_counter);
        let bytes_counter = Arc::clone(&bytes_counter);

        let handle = tokio::spawn(async move {
            let _permit = permit;
            if let Some(parent) = artifact.destination.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }

            let part_path = append_part_extension(&artifact.destination);
            let actual_sha1 =
                download_with_retries(&client, &artifact, &part_path, &bytes_counter).await?;
            if let Some(expected) = &artifact.expected_sha1 {
                if !actual_sha1.eq_ignore_ascii_case(expected) {
                    let _ = tokio::fs::remove_file(&part_path).await;
                    return Err(AppError::IntegrityMismatch {
                        path: artifact.relative_key.clone(),
                        expected: expected.clone(),
                        actual: actual_sha1,
                    });
                }
            }

            tokio::fs::rename(&part_path, &artifact.destination).await?;
            let (size, mtime_secs) = read_file_stat(&artifact.destination)
                .await?
                .unwrap_or((0, 0));

            {
                let mut guard = shared_index.lock().await;
                guard.entries.insert(
                    artifact.relative_key.clone(),
                    IntegrityEntry {
                        size,
                        mtime_secs,
                        sha1: actual_sha1,
                    },
                );
            }

            let done = completed_counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
            let bytes = bytes_counter.load(std::sync::atomic::Ordering::Relaxed);
            progress_cb(DownloadProgress {
                phase: "Descargando archivos (12x HTTP/2)".to_string(),
                completed_files: done,
                total_files: total_artifacts,
                bytes_downloaded: bytes,
                current_file: artifact.relative_key,
                fast_path_hits,
            });

            Ok::<(), AppError>(())
        });
        handles.push(handle);
    }

    for handle in handles {
        let task_res = handle
            .await
            .map_err(|err| AppError::ConfigError(format!("Download task panic: {err}")))?;
        task_res?;
    }

    let final_index = shared_index.lock().await;
    final_index.save_atomic(index_path).await?;

    Ok(DownloadSummary {
        total_artifacts,
        fast_path_hits,
        hashed_from_disk,
        downloaded_files: pending_count,
    })
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{IntegrityEntry, IntegrityIndex};

    #[test]
    fn test_integrity_index_fast_path_hit_and_miss() {
        let mut idx = IntegrityIndex::default();
        idx.entries.insert(
            "assets/objects/ab/ab1234".to_string(),
            IntegrityEntry {
                size: 1024,
                mtime_secs: 1_700_000_000,
                sha1: "ab1234567890".to_string(),
            },
        );

        assert!(idx.is_fast_valid(
            "assets/objects/ab/ab1234",
            1024,
            1_700_000_000,
            Some("AB1234567890"),
        ));
        assert!(!idx.is_fast_valid(
            "assets/objects/ab/ab1234",
            2048,
            1_700_000_000,
            Some("ab1234567890"),
        ));
        assert!(!idx.is_fast_valid(
            "assets/objects/ab/ab1234",
            1024,
            1_700_000_001,
            Some("ab1234567890"),
        ));
        assert!(!idx.is_fast_valid(
            "assets/objects/ab/ab1234",
            1024,
            1_700_000_000,
            Some("ffffffff"),
        ));
    }

    #[tokio::test]
    async fn test_integrity_index_atomic_roundtrip() -> Result<(), Box<dyn std::error::Error>> {
        let unique = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
        let temp_dir = std::env::temp_dir().join(format!("mc-launcher-idx-{unique}"));
        let index_path = temp_dir.join("integrity_index.json");

        let mut idx = IntegrityIndex::default();
        idx.entries.insert(
            "libraries/sample.jar".to_string(),
            IntegrityEntry {
                size: 512,
                mtime_secs: 1_700_000_123,
                sha1: "deadbeef".to_string(),
            },
        );

        idx.save_atomic(&index_path).await?;
        let loaded = IntegrityIndex::load(&index_path).await?;
        assert!(loaded.is_fast_valid(
            "libraries/sample.jar",
            512,
            1_700_000_123,
            Some("deadbeef"),
        ));

        tokio::fs::remove_dir_all(&temp_dir).await?;
        Ok(())
    }

    #[test]
    fn test_append_part_extension_avoids_stem_collision() {
        use std::path::PathBuf;
        let jar_part = super::append_part_extension(&PathBuf::from("versions/1.21.4/1.21.4.jar"));
        let json_part = super::append_part_extension(&PathBuf::from("versions/1.21.4/1.21.4.json"));
        assert_ne!(jar_part, json_part);
        assert!(jar_part.to_string_lossy().ends_with("1.21.4.jar.part"));
        assert!(json_part.to_string_lossy().ends_with("1.21.4.json.part"));
    }
}
