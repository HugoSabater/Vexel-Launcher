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
    pub version_type: String,
    pub username: String,
    pub ram_mb: u64,
    pub gc_preset: GcPreset,
    pub process_priority: ProcessPriority,
    pub server_address: Option<String>,
    pub world_folder: Option<String>,
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
    pub detached: bool,
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

const DEFAULT_OPTIMIZED_OPTIONS_TXT: &str = "\
enableVsync:false\n\
maxFps:260\n\
renderDistance:12\n\
simulationDistance:8\n\
entityDistanceScaling:1.0\n\
biomeBlendRadius:2\n\
mipmapLevels:4\n\
particles:1\n\
graphicsMode:1\n\
prioritizeChunkUpdates:1\n\
pauseOnLostFocus:true\n";

const SAFE_PERFORMANCE_OPTION_OVERRIDES: &[(&str, &str)] = &[
    ("renderDistance", "12"),
    ("simulationDistance", "8"),
    ("enableVsync", "false"),
    ("prioritizeChunkUpdates", "1"),
    ("biomeBlendRadius", "2"),
];

/// Updates ONLY safe performance keys in `options.txt`, preserving line ending style (CRLF/LF),
/// user keybinds, language, audio volumes, and `resourcePacks`, and appending any missing keys.
#[must_use]
pub fn merge_options_txt_performance_keys(existing: &str) -> String {
    let eol = if existing.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let mut seen: HashSet<&str> = HashSet::with_capacity(SAFE_PERFORMANCE_OPTION_OVERRIDES.len());
    let mut out_lines: Vec<String> = Vec::new();

    for line in existing.lines() {
        if let Some((key, _val)) = line.split_once(':') {
            if let Some(&(target_key, target_val)) = SAFE_PERFORMANCE_OPTION_OVERRIDES
                .iter()
                .find(|(k, _)| *k == key)
            {
                if seen.insert(target_key) {
                    out_lines.push(format!("{target_key}:{target_val}"));
                }
                continue;
            }
        }
        out_lines.push(line.to_string());
    }

    for &(target_key, target_val) in SAFE_PERFORMANCE_OPTION_OVERRIDES {
        if !seen.contains(target_key) {
            out_lines.push(format!("{target_key}:{target_val}"));
        }
    }

    let mut merged = out_lines.join(eol);
    merged.push_str(eol);
    merged
}

pub async fn ensure_optimized_options_txt(instance_dir: &Path) -> AppResult<bool> {
    tokio::fs::create_dir_all(instance_dir).await?;
    let options_path = instance_dir.join("options.txt");
    if tokio::fs::try_exists(&options_path).await? {
        return Ok(false);
    }
    tokio::fs::write(&options_path, DEFAULT_OPTIMIZED_OPTIONS_TXT.as_bytes()).await?;
    Ok(true)
}

/// Safely optimizes `options.txt` in an existing (or fresh) instance.
/// Always creates a `.bak` backup if `options.txt` existed, and returns the optional backup filename.
pub async fn reoptimize_options_txt(
    instance_dir: &Path,
    timestamp_secs: u64,
) -> AppResult<Option<String>> {
    tokio::fs::create_dir_all(instance_dir).await?;
    let options_path = instance_dir.join("options.txt");

    let (next_content, backup_name) = if tokio::fs::try_exists(&options_path).await? {
        let bak_path =
            crate::core::worldgen_configs::backup_file_before_overwrite(&options_path, timestamp_secs)
                .await?;
        let bak_name = bak_path
            .and_then(|p| p.file_name().and_then(|n| n.to_str()).map(str::to_string));
        let existing = tokio::fs::read_to_string(&options_path).await?;
        (merge_options_txt_performance_keys(&existing), bak_name)
    } else {
        (DEFAULT_OPTIMIZED_OPTIONS_TXT.to_string(), None)
    };

    let tmp_path = instance_dir.join("options.txt.tmp");
    tokio::fs::write(&tmp_path, next_content.as_bytes()).await?;
    tokio::fs::rename(&tmp_path, &options_path).await?;
    Ok(backup_name)
}

#[must_use]
pub fn strip_windows_extended_prefix(raw: &str) -> String {
    raw.strip_prefix(r"\\?\").unwrap_or(raw).to_string()
}

#[cfg(windows)]
pub fn register_high_performance_gpu_preference(javaw_path: &Path) -> AppResult<String> {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, REG_SZ,
    };

    let resolved = std::fs::canonicalize(javaw_path).unwrap_or_else(|_| javaw_path.to_path_buf());
    let normalized_path = strip_windows_extended_prefix(&resolved.to_string_lossy());

    let subkey: Vec<u16> = r"Software\Microsoft\DirectX\UserGpuPreferences"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let value_name: Vec<u16> = normalized_path
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let value_data: Vec<u16> = "GpuPreference=2;"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    let mut hkey: HKEY = std::ptr::null_mut();
    // Safety: Standard Win32 HKCU registry write with null-terminated UTF-16 buffers; handle always closed.
    unsafe {
        let create_status = RegCreateKeyW(HKEY_CURRENT_USER, subkey.as_ptr(), &mut hkey);
        if create_status != ERROR_SUCCESS {
            return Err(AppError::Win32Error(format!(
                "RegCreateKeyW failed with code {create_status}"
            )));
        }

        let byte_len = (value_data.len() * std::mem::size_of::<u16>()) as u32;
        let set_status = RegSetValueExW(
            hkey,
            value_name.as_ptr(),
            0,
            REG_SZ,
            value_data.as_ptr().cast::<u8>(),
            byte_len,
        );
        let _ = RegCloseKey(hkey);

        if set_status != ERROR_SUCCESS {
            return Err(AppError::Win32Error(format!(
                "RegSetValueExW failed with code {set_status}"
            )));
        }
    }

    Ok(normalized_path)
}

#[cfg(not(windows))]
pub fn register_high_performance_gpu_preference(javaw_path: &Path) -> AppResult<String> {
    Ok(javaw_path.to_string_lossy().into_owned())
}

fn build_natives_stamp(native_jars: &[PathBuf]) -> String {
    let mut entries: Vec<String> = native_jars
        .iter()
        .filter_map(|p| {
            let meta = std::fs::metadata(p).ok()?;
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_secs());
            let name = p
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown.jar");
            Some(format!("{name}:{}:{mtime}", meta.len()))
        })
        .collect();
    entries.sort();
    entries.join("\n")
}

fn dir_has_any_dll(natives_dir: &Path) -> bool {
    let Ok(read_dir) = std::fs::read_dir(natives_dir) else {
        return false;
    };
    read_dir.flatten().any(|entry| {
        entry
            .path()
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("dll"))
    })
}

fn extract_natives_blocking(native_jars: &[PathBuf], natives_dir: &Path) -> AppResult<()> {
    std::fs::create_dir_all(natives_dir)?;
    if native_jars.is_empty() {
        return Ok(());
    }

    let stamp_path = natives_dir.join(".natives_stamp");
    let expected_stamp = build_natives_stamp(native_jars);
    if !expected_stamp.is_empty() && dir_has_any_dll(natives_dir) {
        if let Ok(existing) = std::fs::read_to_string(&stamp_path) {
            if existing == expected_stamp {
                return Ok(());
            }
        }
    }

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

    if !expected_stamp.is_empty() {
        let _ = std::fs::write(&stamp_path, expected_stamp.as_bytes());
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
    "--quickPlaySingleplayer",
    "--server",
    "--port",
    "--width",
    "--height",
];

fn is_single_value_game_option(flag: &str) -> bool {
    SINGLE_VALUE_GAME_OPTIONS.contains(&flag)
}

const LAUNCHER_BRAND_NAME: &str = "Vexel Launcher";
const LAUNCHER_BRAND_VERSION: &str = env!("CARGO_PKG_VERSION");

fn substitute_launcher_tokens(raw: &str) -> String {
    raw.replace("${launcher_name}", LAUNCHER_BRAND_NAME)
        .replace("${launcher_version}", LAUNCHER_BRAND_VERSION)
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
    substitute_launcher_tokens(raw)
        .replace("${auth_player_name}", &req.username)
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
        .replace("${version_type}", &req.version_type)
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
        ("--versionType", req.version_type.clone()),
    ];

    for (flag, value) in base_pairs {
        seen_single_options.insert(flag.to_string());
        args.push(flag.to_string());
        args.push(value);
    }

    let quickplay_args = if let Some(world) = req
        .world_folder
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if supports_modern_quickplay(&req.mc_version) {
            vec!["--quickPlaySingleplayer".to_string(), world.to_string()]
        } else {
            Vec::new()
        }
    } else {
        build_quickplay_args(&req.mc_version, req.server_address.as_deref())
    };
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

fn quote_arg_if_needed(arg: &str) -> String {
    if arg.is_empty() || arg.chars().any(char::is_whitespace) {
        format!("\"{}\"", arg.replace('"', "\\\""))
    } else {
        arg.to_string()
    }
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
    parts.extend(tuning.flags.into_iter().map(|a| quote_arg_if_needed(&a)));
    parts.extend(
        req.extra_jvm_args
            .iter()
            .map(|a| quote_arg_if_needed(&substitute_launcher_tokens(a))),
    );
    parts.push(quote_arg_if_needed(&format!(
        "-Dminecraft.launcher.brand={LAUNCHER_BRAND_NAME}"
    )));
    parts.push(format!(
        "-Dminecraft.launcher.version={LAUNCHER_BRAND_VERSION}"
    ));
    parts.push(format!(
        "\"-Djava.library.path={}\"",
        natives_dir.to_string_lossy()
    ));
    parts.push("-cp".to_string());
    parts.push(format!("\"{classpath}\""));
    parts.push(req.main_class.clone());
    parts.extend(game_args.into_iter().map(|a| quote_arg_if_needed(&a)));
    parts.join(" ")
}

#[cfg(windows)]
pub async fn terminate_process(pid: u32) -> AppResult<()> {
    use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, TerminateProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        PROCESS_TERMINATE,
    };

    tokio::task::spawn_blocking(move || {
        // Safety: Opens process with terminate+query rights, terminates if alive, and always closes handle.
        unsafe {
            let handle = OpenProcess(
                PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION,
                0,
                pid,
            );
            if handle.is_null() {
                // Process may already have exited; treat as already stopped.
                return Ok(());
            }
            let term_ok = TerminateProcess(handle, 1);
            let mut already_exited = false;
            if term_ok == 0 {
                let mut exit_code: u32 = 0;
                if GetExitCodeProcess(handle, &mut exit_code) != 0
                    && exit_code != STILL_ACTIVE as u32
                {
                    already_exited = true;
                }
            }
            let last_err = std::io::Error::last_os_error();
            let _ = CloseHandle(handle);
            if term_ok == 0 && !already_exited {
                return Err(AppError::Win32Error(format!(
                    "TerminateProcess failed for PID {pid}: {last_err}"
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

#[derive(Debug, Default)]
pub struct Log4jStreamParser {
    in_event: bool,
    thread: String,
    level: String,
    in_message: bool,
    message_buf: String,
    in_throwable: bool,
}

impl Log4jStreamParser {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    fn is_error_level(level: &str) -> bool {
        level.eq_ignore_ascii_case("ERROR") || level.eq_ignore_ascii_case("FATAL")
    }

    fn extract_attr(tag: &str, name: &str) -> Option<String> {
        let double_needle = format!("{name}=\"");
        if let Some((_, after)) = tag.split_once(&double_needle) {
            if let Some((val, _)) = after.split_once('"') {
                return Some(val.to_string());
            }
        }
        let single_needle = format!("{name}='");
        if let Some((_, after)) = tag.split_once(&single_needle) {
            if let Some((val, _)) = after.split_once('\'') {
                return Some(val.to_string());
            }
        }
        None
    }

    fn flush_message(&mut self, out: &mut Vec<(String, bool)>) {
        let thread = if self.thread.is_empty() {
            "main"
        } else {
            self.thread.as_str()
        };
        let level = if self.level.is_empty() {
            "INFO"
        } else {
            self.level.as_str()
        };
        let is_err = Self::is_error_level(level);
        let cleaned = self.message_buf.trim_end_matches(['\r', '\n']);

        if cleaned.is_empty() {
            self.message_buf.clear();
            return;
        }

        let mut lines_iter = cleaned.lines();
        if let Some(first) = lines_iter.next() {
            out.push((format!("[{thread}/{level}]: {first}"), is_err));
            for cont in lines_iter {
                out.push((cont.to_string(), is_err));
            }
        }
        self.message_buf.clear();
    }

    /// Consumes a single stdout line and emits zero or more `(formatted_line, is_stderr)` pairs.
    /// Plain non-XML lines pass through untouched.
    pub fn feed_line(&mut self, raw_line: &str) -> Vec<(String, bool)> {
        let line = raw_line.trim_end_matches('\r');
        let mut out = Vec::new();

        if !self.in_event
            && !self.in_message
            && !self.in_throwable
            && !line.contains("<log4j:")
            && !line.contains("</log4j:")
        {
            out.push((line.to_string(), false));
            return out;
        }

        let mut rest = line;
        for _ in 0..32 {
            if rest.is_empty() {
                break;
            }

            if self.in_throwable {
                let close_split = rest
                    .split_once("]]></log4j:Throwable>")
                    .or_else(|| rest.split_once("</log4j:Throwable>"));
                if let Some((before, after)) = close_split {
                    let cleaned = before.trim_end_matches('\r');
                    if !cleaned.trim().is_empty() {
                        out.push((cleaned.to_string(), true));
                    }
                    self.in_throwable = false;
                    rest = after;
                    continue;
                }
                if !rest.trim().is_empty() {
                    out.push((rest.to_string(), true));
                }
                break;
            }

            if self.in_message {
                let close_split = rest
                    .split_once("]]></log4j:Message>")
                    .or_else(|| rest.split_once("</log4j:Message>"));
                if let Some((before, after)) = close_split {
                    if !self.message_buf.is_empty() {
                        self.message_buf.push('\n');
                    }
                    self.message_buf.push_str(before);
                    self.flush_message(&mut out);
                    self.in_message = false;
                    rest = after;
                    continue;
                }
                if !self.message_buf.is_empty() {
                    self.message_buf.push('\n');
                }
                self.message_buf.push_str(rest);
                break;
            }

            // Find the earliest Log4j control tag in `rest`
            let markers: [(&str, u8); 4] = [
                ("<log4j:Event", 0),
                ("<log4j:Message>", 1),
                ("<log4j:Throwable>", 2),
                ("</log4j:Event>", 3),
            ];
            let earliest = markers
                .iter()
                .filter_map(|&(pat, kind)| rest.find(pat).map(|pos| (pos, pat, kind)))
                .min_by_key(|(pos, _, _)| *pos);

            let Some((pos, pat, kind)) = earliest else {
                if !self.in_event {
                    let trimmed = rest.trim();
                    if !trimmed.is_empty()
                        && !trimmed.starts_with("</log4j:")
                        && !trimmed.starts_with("<log4j:")
                    {
                        out.push((rest.to_string(), false));
                    }
                }
                break;
            };

            let after_marker = match rest.get(pos..) {
                Some(s) => s,
                None => break,
            };

            match kind {
                0 => {
                    // <log4j:Event ...>
                    if let Some((open_tag, after_gt)) = after_marker.split_once('>') {
                        self.in_event = true;
                        self.thread =
                            Self::extract_attr(open_tag, "thread").unwrap_or_else(|| "main".to_string());
                        self.level =
                            Self::extract_attr(open_tag, "level").unwrap_or_else(|| "INFO".to_string());
                        rest = after_gt;
                    } else {
                        break;
                    }
                }
                1 => {
                    // <log4j:Message>
                    let body = after_marker.strip_prefix(pat).unwrap_or("");
                    let body = body.strip_prefix("<![CDATA[").unwrap_or(body);
                    self.in_message = true;
                    self.message_buf.clear();
                    rest = body;
                }
                2 => {
                    // <log4j:Throwable>
                    let body = after_marker.strip_prefix(pat).unwrap_or("");
                    let body = body.strip_prefix("<![CDATA[").unwrap_or(body);
                    self.in_throwable = true;
                    rest = body;
                }
                _ => {
                    // </log4j:Event>
                    self.in_event = false;
                    self.thread.clear();
                    self.level.clear();
                    rest = after_marker.strip_prefix(pat).unwrap_or("");
                }
            }
        }

        out
    }
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

    if let Err(err) = register_high_performance_gpu_preference(&req.javaw_path) {
        on_log(format!("[GPU Preference] Warning: {err}"), false);
    }

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

    let extra_jvm_resolved: Vec<String> = req
        .extra_jvm_args
        .iter()
        .map(|a| substitute_launcher_tokens(a))
        .collect();

    let mut cmd = Command::new(&req.javaw_path);
    cmd.current_dir(&game_dir)
        .args(&tuning.flags)
        .args(&extra_jvm_resolved)
        .arg(format!("-Dminecraft.launcher.brand={LAUNCHER_BRAND_NAME}"))
        .arg(format!(
            "-Dminecraft.launcher.version={LAUNCHER_BRAND_VERSION}"
        ))
        .arg(format!("-Djava.library.path={}", natives_dir.to_string_lossy()))
        .arg("-cp")
        .arg(&classpath)
        .arg(&req.main_class)
        .args(&game_args);

    if req.detached {
        // Detached mode (launch_behavior == "close"): null stdio so closing the launcher never breaks JVM pipes
        cmd.stdout(Stdio::null()).stderr(Stdio::null());
    } else {
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    }

    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW (0x0800_0000); add CREATE_NEW_PROCESS_GROUP (0x0000_0200) when detached
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        let flags = if req.detached {
            CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP
        } else {
            CREATE_NO_WINDOW
        };
        cmd.creation_flags(flags);
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

    if req.detached {
        return Ok(pid);
    }

    let on_log = std::sync::Arc::new(on_log);

    if let Some(stdout) = child.stdout.take() {
        let cb = std::sync::Arc::clone(&on_log);
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            let mut parser = Log4jStreamParser::new();
            while let Ok(Some(line)) = lines.next_line().await {
                for (clean_line, is_err) in parser.feed_line(&line) {
                    cb(clean_line, is_err);
                }
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
            version_type: "release".to_string(),
            username: "Hugo".to_string(),
            ram_mb: 4096,
            gc_preset: GcPreset::GenerationalZgc,
            process_priority: ProcessPriority::AboveNormal,
            server_address: Some("play.example.net:25565".to_string()),
            world_folder: None,
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
            detached: false,
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

    #[test]
    fn test_world_folder_uses_quickplay_singleplayer_and_omits_server() {
        let paths = LauncherPaths::with_root(PathBuf::from("test-root"));
        let req = LaunchRequest {
            profile_id: "survival".to_string(),
            mc_version: "1.21.4".to_string(),
            version_type: "release".to_string(),
            username: "Hugo".to_string(),
            ram_mb: 4096,
            gc_preset: GcPreset::GenerationalZgc,
            process_priority: ProcessPriority::AboveNormal,
            server_address: Some("play.example.net:25565".to_string()),
            world_folder: Some("MiMundoSurvival".to_string()),
            javaw_path: PathBuf::from("javaw.exe"),
            main_class: "net.minecraft.client.main.Main".to_string(),
            java_major: 21,
            classpath_entries: Vec::new(),
            native_archives: Vec::new(),
            asset_index_id: "19".to_string(),
            extra_jvm_args: Vec::new(),
            extra_game_args: Vec::new(),
            window_width: None,
            window_height: None,
            fullscreen: false,
            detached: false,
        };

        let args = build_game_args(&req, &paths);
        assert!(args.contains(&"--quickPlaySingleplayer".to_string()));
        assert!(args.contains(&"MiMundoSurvival".to_string()));
        assert!(!args.contains(&"--quickPlayMultiplayer".to_string()));
        assert!(!args.contains(&"--server".to_string()));

        // Preview command must quote world names containing spaces
        let mut spaced_req = req;
        spaced_req.world_folder = Some("Mi Mundo Con Espacios".to_string());
        let preview = super::build_full_command_preview(&spaced_req, &paths, 8);
        assert!(preview.contains("\"Mi Mundo Con Espacios\""));
    }

    #[test]
    fn test_extract_natives_stamp_skips_redundant_extraction() -> Result<(), Box<dyn std::error::Error>> {
        use std::io::Write;
        use zip::write::SimpleFileOptions;

        let tmp = std::env::temp_dir().join(format!(
            "mc-launcher-natives-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&tmp)?;
        let jar_path = tmp.join("lwjgl-natives.jar");
        let natives_dir = tmp.join("out_natives");

        {
            let file = std::fs::File::create(&jar_path)?;
            let mut writer = zip::ZipWriter::new(file);
            writer.start_file("lwjgl.dll", SimpleFileOptions::default())?;
            writer.write_all(b"ORIGINAL_DLL")?;
            writer.finish()?;
        }

        super::extract_natives_blocking(std::slice::from_ref(&jar_path), &natives_dir)?;
        assert_eq!(std::fs::read(natives_dir.join("lwjgl.dll"))?, b"ORIGINAL_DLL");
        assert!(natives_dir.join(".natives_stamp").exists());

        // Overwrite extracted DLL marker; second run with identical JAR stamp must skip extraction
        std::fs::write(natives_dir.join("lwjgl.dll"), b"SENTINEL_CACHED")?;
        super::extract_natives_blocking(&[jar_path], &natives_dir)?;
        assert_eq!(
            std::fs::read(natives_dir.join("lwjgl.dll"))?,
            b"SENTINEL_CACHED"
        );

        let _ = std::fs::remove_dir_all(&tmp);
        Ok(())
    }

    #[test]
    fn test_strip_windows_extended_prefix() {
        assert_eq!(
            super::strip_windows_extended_prefix(r"\\?\C:\Users\Hugo\javaw.exe"),
            r"C:\Users\Hugo\javaw.exe"
        );
        assert_eq!(
            super::strip_windows_extended_prefix(r"C:\Program Files\Java\bin\javaw.exe"),
            r"C:\Program Files\Java\bin\javaw.exe"
        );
    }

    #[tokio::test]
    async fn test_ensure_optimized_options_txt_does_not_overwrite_existing() -> Result<(), Box<dyn std::error::Error>> {
        let tmp = std::env::temp_dir().join(format!(
            "mc-launcher-opt-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let created = super::ensure_optimized_options_txt(&tmp).await?;
        assert!(created);
        let initial = tokio::fs::read_to_string(tmp.join("options.txt")).await?;
        assert!(initial.contains("enableVsync:false"));
        assert!(initial.contains("renderDistance:12"));

        tokio::fs::write(tmp.join("options.txt"), b"renderDistance:20\n").await?;
        let created_again = super::ensure_optimized_options_txt(&tmp).await?;
        assert!(!created_again);
        let preserved = tokio::fs::read_to_string(tmp.join("options.txt")).await?;
        assert_eq!(preserved, "renderDistance:20\n");

        let _ = tokio::fs::remove_dir_all(&tmp).await;
        Ok(())
    }

    #[test]
    fn test_log4j_xml_parser_handles_events_throwables_and_plain_lines() {
        let mut parser = super::Log4jStreamParser::new();

        // 1. Plain text passes through unchanged
        assert_eq!(
            parser.feed_line("[14:00:00] [main/INFO]: Loading Fabric Loader 0.16.10"),
            vec![(
                "[14:00:00] [main/INFO]: Loading Fabric Loader 0.16.10".to_string(),
                false
            )]
        );

        // 2. Single-line XML info event
        let single = r#"<log4j:Event logger="net.minecraft.client.Minecraft" timestamp="1700000000" level="INFO" thread="Render thread"><log4j:Message><![CDATA[Setting user: Hugo]]></log4j:Message></log4j:Event>"#;
        assert_eq!(
            parser.feed_line(single),
            vec![("[Render thread/INFO]: Setting user: Hugo".to_string(), false)]
        );

        // 3. Multi-line ERROR event with <log4j:Throwable>
        let lines = [
            r#"  <log4j:Event logger="net.minecraft.server.Main" timestamp="1700000001" level="ERROR" thread="Server thread">"#,
            r#"    <log4j:Message><![CDATA[Encountered an unexpected exception]]></log4j:Message>"#,
            r#"    <log4j:Throwable><![CDATA[java.lang.RuntimeException: Boom"#,
            "\tat net.minecraft.World.tick(World.java:42)",
            "\tat net.minecraft.Main.main(Main.java:10)]]></log4j:Throwable>",
            r#"  </log4j:Event>"#,
        ];

        let mut collected = Vec::new();
        for l in lines {
            collected.extend(parser.feed_line(l));
        }

        assert_eq!(
            collected,
            vec![
                (
                    "[Server thread/ERROR]: Encountered an unexpected exception".to_string(),
                    true
                ),
                ("java.lang.RuntimeException: Boom".to_string(), true),
                ("\tat net.minecraft.World.tick(World.java:42)".to_string(), true),
                ("\tat net.minecraft.Main.main(Main.java:10)".to_string(), true),
            ]
        );

        // 4. Subsequent plain line after </log4j:Event> still passes through cleanly
        assert_eq!(
            parser.feed_line("Post-event plain line"),
            vec![("Post-event plain line".to_string(), false)]
        );
    }

    #[tokio::test]
    async fn test_merge_options_txt_preserves_controls_resource_packs_and_eol()
    -> Result<(), Box<dyn std::error::Error>> {
        // Test CRLF preservation + partial key override + appending missing keys
        let existing_crlf = concat!(
            "lang:es_es\r\n",
            "soundCategory_music:0.25\r\n",
            "key_key.forward:key.keyboard.w\r\n",
            "renderDistance:16\r\n",
            "simulationDistance:12\r\n",
            "enableVsync:true\r\n",
            "resourcePacks:[\"vanilla\",\"file/LowOnFire.zip\"]\r\n",
        );

        let merged = super::merge_options_txt_performance_keys(existing_crlf);
        assert!(merged.contains("\r\n"));
        assert!(!merged.replace("\r\n", "").contains('\n'));
        assert!(merged.contains("lang:es_es\r\n"));
        assert!(merged.contains("soundCategory_music:0.25\r\n"));
        assert!(merged.contains("key_key.forward:key.keyboard.w\r\n"));
        assert!(merged.contains("resourcePacks:[\"vanilla\",\"file/LowOnFire.zip\"]\r\n"));
        assert!(merged.contains("renderDistance:12\r\n"));
        assert!(merged.contains("simulationDistance:8\r\n"));
        assert!(merged.contains("enableVsync:false\r\n"));
        // Missing keys must be appended at the end
        assert!(merged.contains("prioritizeChunkUpdates:1\r\n"));
        assert!(merged.contains("biomeBlendRadius:2\r\n"));
        assert!(!merged.contains("renderDistance:16"));
        assert!(!merged.contains("enableVsync:true"));

        // Verify disk roundtrip with automatic .bak backup
        let tmp = std::env::temp_dir().join(format!(
            "vexel-opt-reopt-{}",
            uuid::Uuid::new_v4().simple()
        ));
        tokio::fs::create_dir_all(&tmp).await?;
        let lf_sample = "lang:en_us\nrenderDistance:20\nresourcePacks:[\"vanilla\"]\n";
        tokio::fs::write(tmp.join("options.txt"), lf_sample).await?;

        let bak_name = super::reoptimize_options_txt(&tmp, 1_700_000_000).await?;
        assert_eq!(bak_name.as_deref(), Some("options.txt.bak"));
        assert_eq!(
            tokio::fs::read_to_string(tmp.join("options.txt.bak")).await?,
            lf_sample
        );

        let updated = tokio::fs::read_to_string(tmp.join("options.txt")).await?;
        assert!(!updated.contains("\r\n"));
        assert!(updated.contains("lang:en_us\n"));
        assert!(updated.contains("resourcePacks:[\"vanilla\"]\n"));
        assert!(updated.contains("renderDistance:12\n"));
        assert!(updated.contains("simulationDistance:8\n"));
        assert!(updated.contains("enableVsync:false\n"));
        assert!(updated.contains("prioritizeChunkUpdates:1\n"));
        assert!(updated.contains("biomeBlendRadius:2\n"));

        let _ = tokio::fs::remove_dir_all(&tmp).await;
        Ok(())
    }
}
