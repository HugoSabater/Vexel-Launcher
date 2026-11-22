export type GcPreset = "generational_zgc" | "aikar_g1_gc";
export type ProcessPriority = "normal" | "above_normal" | "high";
export type ModLoaderKind = "vanilla" | "fabric" | "forge" | "neo_forge";
export type ContentKind = "mod" | "resource_pack" | "shader";
export type ModrinthSort = "downloads" | "relevance" | "newest" | "updated";
export type PerformancePreset =
  | "fps_pure"
  | "distant_horizons"
  | "c2me_chunk_accel"
  | "bobby_multiplayer";
export type AccentColor = "emerald" | "cyan" | "indigo" | "amber" | "crimson";
export type LaunchBehavior = "keep_open" | "hide_and_restore" | "close";

export interface HardwareInfo {
  total_ram_mb: number;
  available_ram_mb: number;
  logical_cores: number;
  recommended_vanilla_mb: number;
  recommended_modded_mb: number;
  max_safe_ram_mb: number;
}

export interface LiveMemoryTelemetry {
  total_ram_mb: number;
  available_ram_mb: number;
  system_used_mb: number;
  game_rss_mb: number;
  game_running: boolean;
}

export interface Profile {
  id: string;
  name: string;
  mc_version: string;
  loader: ModLoaderKind;
  loader_version: string | null;
  ram_mb: number;
  gc_preset: GcPreset;
  server_address: string | null;
  is_default: boolean;
  window_width: number | null;
  window_height: number | null;
  fullscreen: boolean;
  custom_jvm_args: string | null;
  custom_java_path: string | null;
}

export interface LauncherConfig {
  offline_username: string;
  process_priority: ProcessPriority;
  close_on_launch: boolean;
  skin_path: string | null;
  skin_model: string;
  apply_skin_ingame: boolean;
  accent_color: string;
  launch_behavior: string;
  auto_open_console_on_crash: boolean;
  auto_tune_mod_configs: boolean;
  profiles: Profile[];
}

export interface GlobalSettingsPayload {
  offline_username: string;
  process_priority: ProcessPriority;
  close_on_launch: boolean;
  apply_skin_ingame: boolean;
  accent_color: string;
  launch_behavior: string;
  auto_open_console_on_crash: boolean;
  auto_tune_mod_configs: boolean;
}

export interface BootstrapState {
  hardware: HardwareInfo;
  config: LauncherConfig;
  data_root: string;
}

export interface ContentItem {
  file_name: string;
  display_name: string;
  enabled: boolean;
  size_bytes: number;
  kind: ContentKind;
  version?: string | null;
  mod_id?: string | null;
  slug?: string | null;
  project_id?: string | null;
  icon_url?: string | null;
  metadata_warning?: string | null;
}

export interface ModrinthSearchResult {
  slug: string;
  title: string;
  description: string;
  icon_url: string | null;
  downloads: number;
  categories: string[];
  compatible: boolean;
  compatibility_note: string | null;
  installed: boolean;
  kind: ContentKind;
  performance_warning?: string | null;
}

export interface InstalledJavaRuntime {
  major: number;
  path: string;
  size_bytes: number;
}

export interface StorageBreakdown {
  assets_bytes: number;
  libraries_bytes: number;
  runtimes_bytes: number;
  instances_bytes: number;
  total_bytes: number;
}

export interface LogCleanupResult {
  files_removed: number;
  bytes_freed: number;
}

export interface ReoptimizeResult {
  updated_files: string[];
  backups_created: string[];
}

export type WorldGameType =
  | "survival"
  | "creative"
  | "adventure"
  | "spectator";

export interface WorldSummary {
  folder_name: string;
  level_name: string;
  game_type: WorldGameType | null;
  hardcore: boolean;
  last_played_ms: number;
  last_modified_ms: number;
  mc_version: string | null;
  seed: string | null;
  icon_data_url: string | null;
}

export interface InstanceSummary {
  recent_worlds: WorldSummary[];
  latest_screenshot_data_url: string | null;
}

export interface LaunchProgressEvent {
  phase: string;
  completed: number;
  total: number;
  bytes_downloaded: number;
  detail: string;
  fast_path_hits: number;
}

export interface LogLineEvent {
  line: string;
  is_stderr: boolean;
  timestamp_ms: number;
}

export type JavaRuntimeStatus =
  | {
      status: "installed";
      major: number;
      javaw_path: string;
    }
  | {
      status: "missing";
      major: number;
      adoptium_url: string;
    };

export interface JvmTuningOutput {
  effective_gc: GcPreset;
  flags: string[];
  fallback_notice: string | null;
}

export interface LaunchResult {
  pid: number;
  fast_path_hits: number;
  downloaded_files: number;
  java_major: number;
}

export interface InstanceExitEvent {
  profile_id: string;
  exit_code: number | null;
}

export interface IpcErrorPayload {
  code?: string;
  message?: string;
  required_major?: number;
}

export interface MinecraftVersionEntry {
  id: string;
  version_type: string;
  release_time: string;
}
