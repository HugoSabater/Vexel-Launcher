use std::fs::File;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use uuid::Uuid;

use crate::core::jvm_optimizer::{generate_jvm_flags, GcPreset, JvmTuningInput};
use crate::core::paths::LauncherPaths;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProcessPriority {
    Normal,
    AboveNormal,
    High,
}

#[derive(Debug, Clone)]
pub struct LaunchRequest {
    pub profile_id: String,
    pub mc_version: String,
    pub username: String,
    pub ram_mb: u64,
    pub gc_preset: GcPreset,
    pub process_priority: ProcessPriority,
    pub server_address: Option<String>,
    pub javaw_path: PathBuf,
    pub main_class: String,
    pub java_major: u32,
    pub classpath_entries: Vec<PathBuf>,
    pub native_archives: Vec<PathBuf>,
    pub asset_index_id: String,
    pub extra_jvm_args: Vec<String>,
    pub extra_game_args: Vec<String>,
}

#[must_use]
pub fn generate_offline_uuid(username: &str) -> Uuid {
    let mut hasher = Md5::new();
    hasher.update(format!("OfflinePlayer:{username}").as_bytes());
    let digest = hasher.finalize();
    let mut bytes: [u8; 16] = digest.into();
    // Apply Java UUID.nameUUIDFromBytes (RFC 4122 version 3, variant 1)
    bytes[6] = (bytes[6] & 0x0f) | 0x30;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Uuid::from_bytes(bytes)
}

#[must_use]
fn supports_modern_quickplay(mc_version: &str) -> bool {
    let clean = mc_version.split('-').next().unwrap_or(mc_version);
    let mut parts = clean.split('.');
    let major = parts.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(1);
    let minor = parts.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
    major > 1 || (major == 1 && minor >= 20)
}

#[must_use]
pub fn build_quickplay_args(mc_version: &str, server_address: Option<&str>) -> Vec<String> {
    let Some(raw) = server_address.map(str::trim).filter(|s| !s.is_empty()) else {
        return Vec::new();
    };

    if supports_modern_quickplay(mc_version) {
        let target = if raw.contains(':') {
            raw.to_string()
        } else {
            format!("{raw}:25565")
        };
        vec!["--quickPlayMultiplayer".to_string(), target]
    } else {
        let (host, port) = match raw.split_once(':') {
            Some((h, p)) if !p.is_empty() => (h.to_string(), p.to_string()),
            _ => (raw.to_string(), "25565".to_string()),
        };
        vec![
            "--server".to_string(),
            host,
            "--port".to_string(),
            port,
        ]
    }
}

fn extract_natives_blocking(native_jars: &[PathBuf], natives_dir: &Path) -> AppResult<()> {
    std::fs::create_dir_all(natives_dir)?;

    for jar_path in native_jars {
        if !jar_path.exists() {
            continue;
        }
        let file = File::open(jar_path)?;
        let mut archive = zip::ZipArchive::new(file)?;

        for i in 0..archive.len() {
            let mut entry = archive.by_index(i)?;
            let Some(enclosed) = entry.enclosed_name() else {
                continue;
            };
            if entry.is_dir() {
                continue;
            }
            let Some(file_name) = enclosed.file_name() else {
                continue;
            };
            let is_dll = Path::new(file_name)
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("dll"));
            if !is_dll {
                continue;
            }

            let out_path = natives_dir.join(file_name);
            let mut out_file = File::create(&out_path)?;
            std::io::copy(&mut entry, &mut out_file)?;
        }
    }

    Ok(())
}

pub async fn extract_natives(native_jars: &[PathBuf], natives_dir: &Path) -> AppResult<()> {
    let jars = native_jars.to_vec();
    let target = natives_dir.to_path_buf();
    tokio::task::spawn_blocking(move || extract_natives_blocking(&jars, &target))
        .await
        .map_err(|err| AppError::ProcessLaunch(format!("Natives extraction task failed: {err}")))?
}

#[cfg(windows)]
pub fn apply_windows_process_priority(pid: u32, priority: ProcessPriority) -> AppResult<()> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, SetPriorityClass, ABOVE_NORMAL_PRIORITY_CLASS, HIGH_PRIORITY_CLASS,
        NORMAL_PRIORITY_CLASS, PROCESS_SET_INFORMATION,
    };

    let priority_class = match priority {
        ProcessPriority::Normal => NORMAL_PRIORITY_CLASS,
        ProcessPriority::AboveNormal => ABOVE_NORMAL_PRIORITY_CLASS,
        ProcessPriority::High => HIGH_PRIORITY_CLASS,
    };

    // Safety: Win32 handle opened with PROCESS_SET_INFORMATION and immediately closed afterwards.
    unsafe {
        let handle = OpenProcess(PROCESS_SET_INFORMATION, 0, pid);
        if handle.is_null() {
            return Err(AppError::Win32Error(format!(
                "OpenProcess failed for PID {pid}: {}",
                std::io::Error::last_os_error()
            )));
        }

        let res = SetPriorityClass(handle, priority_class);
        let close_ok = CloseHandle(handle);
        if res == 0 {
            return Err(AppError::Win32Error(format!(
                "SetPriorityClass failed for PID {pid}: {}",
                std::io::Error::last_os_error()
            )));
        }
        if close_ok == 0 {
            return Err(AppError::Win32Error(format!(
                "CloseHandle failed for PID {pid}: {}",
                std::io::Error::last_os_error()
            )));
        }
    }

    Ok(())
}

#[cfg(not(windows))]
pub fn apply_windows_process_priority(_pid: u32, _priority: ProcessPriority) -> AppResult<()> {
    Ok(())
}

pub async fn spawn_minecraft<F>(
    req: LaunchRequest,
    paths: &LauncherPaths,
    logical_cores: usize,
    on_log: F,
) -> AppResult<u32>
where
    F: Fn(String, bool) + Send + Sync + 'static,
{
    paths.ensure_instance_dirs(&req.profile_id).await?;
    let game_dir = paths.instance_dir(&req.profile_id);
    let natives_dir = paths.instance_natives_dir(&req.profile_id);
    extract_natives(&req.native_archives, &natives_dir).await?;

    let tuning = generate_jvm_flags(&JvmTuningInput {
        java_major: req.java_major,
        ram_mb: req.ram_mb,
        logical_cores,
        gc_preset: req.gc_preset,
    });

    if let Some(notice) = &tuning.fallback_notice {
        on_log(format!("[JVM Optimizer] {notice}"), false);
    }

    let separator = if cfg!(windows) { ";" } else { ":" };
    let classpath = req
        .classpath_entries
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join(separator);

    let offline_uuid = generate_offline_uuid(&req.username);
    let quickplay_args = build_quickplay_args(&req.mc_version, req.server_address.as_deref());

    let mut cmd = Command::new(&req.javaw_path);
    cmd.current_dir(&game_dir)
        .args(&tuning.flags)
        .args(&req.extra_jvm_args)
        .arg(format!("-Djava.library.path={}", natives_dir.to_string_lossy()))
        .arg("-cp")
        .arg(&classpath)
        .arg(&req.main_class)
        .arg("--username")
        .arg(&req.username)
        .arg("--version")
        .arg(&req.mc_version)
        .arg("--gameDir")
        .arg(&game_dir)
        .arg("--assetsDir")
        .arg(paths.shared_assets_dir())
        .arg("--assetIndex")
        .arg(&req.asset_index_id)
        .arg("--uuid")
        .arg(offline_uuid.simple().to_string())
        .arg("--accessToken")
        .arg("0")
        .arg("--userType")
        .arg("legacy")
        .args(&req.extra_game_args)
        .args(&quickplay_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW prevents flashing console windows when launching java/javaw
        cmd.creation_flags(0x0800_0000);
    }

    let mut child = cmd
        .spawn()
        .map_err(|err| AppError::ProcessLaunch(format!("Failed to spawn javaw: {err}")))?;

    let pid = child
        .id()
        .ok_or_else(|| AppError::ProcessLaunch("Spawned JVM has no OS process ID".to_string()))?;

    if let Err(err) = apply_windows_process_priority(pid, req.process_priority) {
        on_log(format!("[Win32 Tuning] Warning: {err}"), true);
    } else {
        on_log(
            format!(
                "[Win32 Tuning] Applied {:?} priority to PID {pid}",
                req.process_priority
            ),
            false,
        );
    }

    let on_log = std::sync::Arc::new(on_log);

    if let Some(stdout) = child.stdout.take() {
        let cb = std::sync::Arc::clone(&on_log);
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                cb(line, false);
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let cb = std::sync::Arc::clone(&on_log);
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                cb(line, true);
            }
        });
    }

    tokio::spawn(async move {
        match child.wait().await {
            Ok(status) => on_log(format!("[Minecraft] Process exited with {status}"), false),
            Err(err) => on_log(format!("[Minecraft] Wait error: {err}"), true),
        }
    });

    Ok(pid)
}

#[cfg(test)]
mod tests {
    use uuid::Version;

    use super::{build_quickplay_args, generate_offline_uuid};

    #[test]
    fn test_offline_uuid_deterministic_v3() {
        let u1 = generate_offline_uuid("Hugo");
        let u2 = generate_offline_uuid("Hugo");
        let u3 = generate_offline_uuid("Notch");

        assert_eq!(u1, u2);
        assert_ne!(u1, u3);
        assert_eq!(u1.get_version(), Some(Version::Md5));
    }

    #[test]
    fn test_quickplay_args_version_routing() {
        assert_eq!(
            build_quickplay_args("1.21.4", Some("play.example.net")),
            vec!["--quickPlayMultiplayer", "play.example.net:25565"]
        );
        assert_eq!(
            build_quickplay_args("1.20.1", Some("192.168.1.10:25577")),
            vec!["--quickPlayMultiplayer", "192.168.1.10:25577"]
        );
        assert_eq!(
            build_quickplay_args("1.19.4", Some("mc.server.org:25580")),
            vec!["--server", "mc.server.org", "--port", "25580"]
        );
        assert_eq!(
            build_quickplay_args("1.8.9", Some("localhost")),
            vec!["--server", "localhost", "--port", "25565"]
        );
        assert!(build_quickplay_args("1.21.4", Some("   ")).is_empty());
        assert!(build_quickplay_args("1.21.4", None).is_empty());
    }
}
