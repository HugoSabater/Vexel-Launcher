export type GcPreset = "generational_zgc" | "aikar_g1_gc";
export type ProcessPriority = "normal" | "above_normal" | "high";
export type ModLoaderKind = "vanilla" | "fabric" | "forge" | "neo_forge";
export type ContentKind = "mod" | "resource_pack";

export interface HardwareInfo {
  total_ram_mb: number;
  available_ram_mb: number;
  logical_cores: number;
  recommended_vanilla_mb: number;
  recommended_modded_mb: number;
  max_safe_ram_mb: number;
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
}

export interface LauncherConfig {
  offline_username: string;
  process_priority: ProcessPriority;
  close_on_launch: boolean;
  profiles: Profile[];
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
  timestamp: string;
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

export interface IpcErrorPayload {
  code?: string;
  message?: string;
  required_major?: number;
}
