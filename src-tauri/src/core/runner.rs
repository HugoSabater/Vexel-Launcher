use std::collections::HashSet;
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
    pub window_width: Option<u32>,
    pub window_height: Option<u32>,
    pub fullscreen: bool,
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

const SINGLE_VALUE_GAME_OPTIONS: &[&str] = &[
    "--username",
    "--version",
    "--gameDir",
    "--assetsDir",
    "--assetIndex",
    "--uuid",
    "--accessToken",
    "--userType",
    "--versionType",
    "--clientId",
    "--xuid",
    "--quickPlayMultiplayer",
    "--server",
    "--port",
    "--width",
    "--height",
];

fn is_single_value_game_option(flag: &str) -> bool {
    SINGLE_VALUE_GAME_OPTIONS.contains(&flag)
}

fn substitute_game_arg_template(
    raw: &str,
    req: &LaunchRequest,
    game_dir: &Path,
    assets_dir: &Path,
    offline_uuid_str: &str,
) -> String {
    let game_dir_str = game_dir.to_string_lossy();
    let assets_dir_str = assets_dir.to_string_lossy();
    raw.replace("${auth_player_name}", &req.username)
        .replace("${version_name}", &req.mc_version)
        .replace("${game_directory}", &game_dir_str)
        .replace("${assets_root}", &assets_dir_str)
        .replace("${game_assets}", &assets_dir_str)
        .replace("${assets_index_name}", &req.asset_index_id)
        .replace("${auth_uuid}", offline_uuid_str)
        .replace("${auth_access_token}", "0")
        .replace("${auth_session}", "0")
        .replace("${clientid}", "0")
        .replace("${auth_xuid}", "0")
        .replace("${user_type}", "legacy")
        .replace("${version_type}", "release")
}

#[must_use]
pub fn build_game_args(req: &LaunchRequest, paths: &LauncherPaths) -> Vec<String> {
    let game_dir = paths.instance_dir(&req.profile_id);
    let assets_dir = paths.shared_assets_dir();
    let offline_uuid_str = generate_offline_uuid(&req.username).simple().to_string();

    let mut args = Vec::new();
    let mut seen_single_options: HashSet<String> = HashSet::new();

    let base_pairs = [
        ("--username", req.username.clone()),
        ("--version", req.mc_version.clone()),
        ("--gameDir", game_dir.to_string_lossy().into_owned()),
        ("--assetsDir", assets_dir.to_string_lossy().into_owned()),
        ("--assetIndex", req.asset_index_id.clone()),
        ("--uuid", offline_uuid_str.clone()),
        ("--accessToken", "0".to_string()),
        ("--userType", "legacy".to_string()),
        ("--versionType", "release".to_string()),
    ];

    for (flag, value) in base_pairs {
        seen_single_options.insert(flag.to_string());
        args.push(flag.to_string());
        args.push(value);
    }

    let quickplay_args = build_quickplay_args(&req.mc_version, req.server_address.as_deref());
    let mut combined_extra: Vec<String> = req
        .extra_game_args
        .iter()
        .map(|arg| {
            substitute_game_arg_template(arg, req, &game_dir, &assets_dir, &offline_uuid_str)
        })
        .collect();
    combined_extra.extend(quickplay_args);

    if let Some(w) = req.window_width {
        combined_extra.push("--width".to_string());
        combined_extra.push(w.to_string());
    }
    if let Some(h) = req.window_height {
        combined_extra.push("--height".to_string());
        combined_extra.push(h.to_string());
    }
    if req.fullscreen && !combined_extra.iter().any(|a| a == "--fullscreen") {
        combined_extra.push("--fullscreen".to_string());
    }

    let mut idx = 0;
    while idx < combined_extra.len() {
        let token = &combined_extra[idx];
        if is_single_value_game_option(token) {
            if seen_single_options.contains(token) {
                // Skip duplicate single-value option and its associated value (if present)
                if idx + 1 < combined_extra.len() && !combined_extra[idx + 1].starts_with("--") {
                    idx += 2;
                } else {
                    idx += 1;
                }
                continue;
            }
            seen_single_options.insert(token.clone());
            args.push(token.clone());
            if idx + 1 < combined_extra.len() && !combined_extra[idx + 1].starts_with("--") {
                args.push(combined_extra[idx + 1].clone());
                idx += 2;
            } else {
                idx += 1;
            }
        } else {
            args.push(token.clone());
            idx += 1;
        }
    }

    args
}

#[must_use]
pub fn build_full_command_preview(
    req: &LaunchRequest,
    paths: &LauncherPaths,
    logical_cores: usize,
) -> String {
    let natives_dir = paths.instance_natives_version_dir(&req.profile_id, &req.mc_version);
    let tuning = generate_jvm_flags(&JvmTuningInput {
        java_major: req.java_major,
        ram_mb: req.ram_mb,
        logical_cores,
        gc_preset: req.gc_preset,
    });
    let separator = if cfg!(windows) { ";" } else { ":" };
    let classpath = req
        .classpath_entries
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join(separator);
    let game_args = build_game_args(req, paths);

    let mut parts = Vec::new();
    parts.push(format!("\"{}\"", req.javaw_path.to_string_lossy()));
    parts.extend(tuning.flags);
    parts.extend(req.extra_jvm_args.clone());
    parts.push(format!(
        "\"-Djava.library.path={}\"",
        natives_dir.to_string_lossy()
    ));
    parts.push("-cp".to_string());
    parts.push(format!("\"{classpath}\""));
    parts.push(req.main_class.clone());
    parts.extend(game_args);
    parts.join(" ")
}

#[cfg(windows)]
pub async fn terminate_process(pid: u32) -> AppResult<()> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};

    tokio::task::spawn_blocking(move || {
        // Safety: Opens process with PROCESS_TERMINATE, terminates if alive, and always closes handle.
        unsafe {
            let handle = OpenProcess(PROCESS_TERMINATE, 0, pid);
            if handle.is_null() {
                // Process may already have exited; treat as already stopped.
                return Ok(());
            }
            let term_ok = TerminateProcess(handle, 1);
            let _ = CloseHandle(handle);
            if term_ok == 0 {
                return Err(AppError::Win32Error(format!(
                    "TerminateProcess failed for PID {pid}: {}",
                    std::io::Error::last_os_error()
                )));
            }
        }
        Ok(())
    })
    .await
    .map_err(|err| AppError::ProcessLaunch(format!("Terminate task failed: {err}")))?
}

#[cfg(not(windows))]
pub async fn terminate_process(_pid: u32) -> AppResult<()> {
    Ok(())
}

pub async fn spawn_minecraft<F, E>(
    req: LaunchRequest,
    paths: &LauncherPaths,
    logical_cores: usize,
    on_log: F,
    on_exit: E,
) -> AppResult<u32>
where
    F: Fn(String, bool) + Send + Sync + 'static,
    E: FnOnce(Option<i32>) + Send + 'static,
{
    paths.ensure_instance_dirs(&req.profile_id).await?;
    let game_dir = paths.instance_dir(&req.profile_id);
    let natives_dir = paths.instance_natives_version_dir(&req.profile_id, &req.mc_version);
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

    let game_args = build_game_args(&req, paths);

    let mut cmd = Command::new(&req.javaw_path);
    cmd.current_dir(&game_dir)
        .args(&tuning.flags)
        .args(&req.extra_jvm_args)
        .arg(format!("-Djava.library.path={}", natives_dir.to_string_lossy()))
        .arg("-cp")
        .arg(&classpath)
        .arg(&req.main_class)
        .args(&game_args)
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
        let exit_code = match child.wait().await {
            Ok(status) => {
                on_log(format!("[Minecraft] Process exited with {status}"), false);
                status.code()
            }
            Err(err) => {
                on_log(format!("[Minecraft] Wait error: {err}"), true);
                Some(-1)
            }
        };
        on_exit(exit_code);
    });

    Ok(pid)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use uuid::Version;

    use super::{
        build_game_args, build_quickplay_args, generate_offline_uuid, LaunchRequest,
        ProcessPriority,
    };
    use crate::core::jvm_optimizer::GcPreset;
    use crate::core::paths::LauncherPaths;

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

    #[test]
    fn test_build_game_args_deduplicates_modern_1_21_4_options() {
        let paths = LauncherPaths::with_root(PathBuf::from("test-root"));
        let req = LaunchRequest {
            profile_id: "vanilla-1-21-4".to_string(),
            mc_version: "1.21.4".to_string(),
            username: "Hugo".to_string(),
            ram_mb: 4096,
            gc_preset: GcPreset::GenerationalZgc,
            process_priority: ProcessPriority::AboveNormal,
            server_address: Some("play.example.net:25565".to_string()),
            javaw_path: PathBuf::from("javaw.exe"),
            main_class: "net.minecraft.client.main.Main".to_string(),
            java_major: 21,
            classpath_entries: Vec::new(),
            native_archives: Vec::new(),
            asset_index_id: "19".to_string(),
            extra_jvm_args: Vec::new(),
            extra_game_args: vec![
                "--username".to_string(),
                "${auth_player_name}".to_string(),
                "--version".to_string(),
                "${version_name}".to_string(),
                "--gameDir".to_string(),
                "${game_directory}".to_string(),
                "--assetsDir".to_string(),
                "${assets_root}".to_string(),
                "--assetIndex".to_string(),
                "${assets_index_name}".to_string(),
                "--uuid".to_string(),
                "${auth_uuid}".to_string(),
                "--accessToken".to_string(),
                "${auth_access_token}".to_string(),
                "--clientId".to_string(),
                "${clientid}".to_string(),
                "--xuid".to_string(),
                "${auth_xuid}".to_string(),
                "--userType".to_string(),
                "${user_type}".to_string(),
                "--versionType".to_string(),
                "${version_type}".to_string(),
                "--customLoaderFlag".to_string(),
                "enabled".to_string(),
            ],
            window_width: Some(1920),
            window_height: Some(1080),
            fullscreen: true,
        };

        let args = build_game_args(&req, &paths);

        for unique_flag in [
            "--version",
            "--username",
            "--gameDir",
            "--assetsDir",
            "--assetIndex",
            "--uuid",
            "--accessToken",
            "--userType",
            "--versionType",
            "--clientId",
            "--xuid",
            "--quickPlayMultiplayer",
            "--width",
            "--height",
        ] {
            let count = args.iter().filter(|a| a.as_str() == unique_flag).count();
            assert_eq!(
                count, 1,
                "Expected option '{unique_flag}' exactly once, found {count} in {args:?}"
            );
        }

        assert!(
            args.iter().all(|a| !a.contains("${")),
            "Found unresolved template placeholder in {args:?}"
        );
        assert!(args.contains(&"1.21.4".to_string()));
        assert!(args.contains(&"--customLoaderFlag".to_string()));
        assert!(args.contains(&"enabled".to_string()));
        assert!(args.contains(&"1920".to_string()));
        assert!(args.contains(&"1080".to_string()));
        assert!(args.contains(&"--fullscreen".to_string()));
    }
}
