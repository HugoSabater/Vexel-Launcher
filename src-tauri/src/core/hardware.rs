use serde::{Deserialize, Serialize};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareInfo {
    pub total_ram_mb: u64,
    pub available_ram_mb: u64,
    pub logical_cores: usize,
    pub recommended_vanilla_mb: u64,
    pub recommended_modded_mb: u64,
    pub max_safe_ram_mb: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveMemoryTelemetry {
    pub total_ram_mb: u64,
    pub available_ram_mb: u64,
    pub system_used_mb: u64,
    pub game_rss_mb: u64,
    pub game_running: bool,
}

#[must_use]
pub fn calculate_ram_presets(total_ram_mb: u64) -> (u64, u64, u64) {
    if total_ram_mb <= 8192 {
        let max_safe = (total_ram_mb / 2).max(2048);
        (2048, 3072.min(max_safe), max_safe)
    } else if total_ram_mb <= 24576 {
        let max_safe = 8192;
        (4096, 6144, max_safe)
    } else {
        let max_safe = 12288;
        (6144, 8192, max_safe)
    }
}

#[must_use]
pub fn detect_hardware() -> HardwareInfo {
    let mut sys = System::new();
    sys.refresh_memory();
    sys.refresh_cpu_all();

    let total_ram_mb = (sys.total_memory() / (1024 * 1024)).max(2048);
    let available_ram_mb = sys.available_memory() / (1024 * 1024);
    let logical_cores = sys.cpus().len().max(1);
    let (recommended_vanilla_mb, recommended_modded_mb, max_safe_ram_mb) =
        calculate_ram_presets(total_ram_mb);

    HardwareInfo {
        total_ram_mb,
        available_ram_mb,
        logical_cores,
        recommended_vanilla_mb,
        recommended_modded_mb,
        max_safe_ram_mb,
    }
}

#[must_use]
pub fn sample_live_memory_telemetry(active_pids: &[u32]) -> LiveMemoryTelemetry {
    let mut sys = System::new();
    sys.refresh_memory();

    let total_ram_mb = (sys.total_memory() / (1024 * 1024)).max(2048);
    let available_ram_mb = (sys.available_memory() / (1024 * 1024)).min(total_ram_mb);

    let mut game_rss_bytes = 0_u64;
    let mut game_running = false;

    if !active_pids.is_empty() {
        let pids: Vec<Pid> = active_pids.iter().map(|&p| Pid::from_u32(p)).collect();
        sys.refresh_processes_specifics(
            ProcessesToUpdate::Some(&pids),
            true,
            ProcessRefreshKind::nothing().with_memory(),
        );
        for pid in pids {
            if let Some(proc_info) = sys.process(pid) {
                game_running = true;
                game_rss_bytes = game_rss_bytes.saturating_add(proc_info.memory());
            }
        }
    }

    let game_rss_mb = game_rss_bytes / (1024 * 1024);
    let total_used_mb = total_ram_mb.saturating_sub(available_ram_mb);
    let system_used_mb = total_used_mb.saturating_sub(game_rss_mb);

    LiveMemoryTelemetry {
        total_ram_mb,
        available_ram_mb,
        system_used_mb,
        game_rss_mb,
        game_running,
    }
}

#[cfg(test)]
mod tests {
    use super::{calculate_ram_presets, detect_hardware};

    #[test]
    fn test_ram_presets_4gb() {
        let (vanilla, modded, max_safe) = calculate_ram_presets(4096);
        assert_eq!(vanilla, 2048);
        assert_eq!(modded, 2048);
        assert_eq!(max_safe, 2048);
    }

    #[test]
    fn test_ram_presets_8gb() {
        let (vanilla, modded, max_safe) = calculate_ram_presets(8192);
        assert_eq!(vanilla, 2048);
        assert_eq!(modded, 3072);
        assert_eq!(max_safe, 4096);
    }

    #[test]
    fn test_ram_presets_16gb() {
        let (vanilla, modded, max_safe) = calculate_ram_presets(16384);
        assert_eq!(vanilla, 4096);
        assert_eq!(modded, 6144);
        assert_eq!(max_safe, 8192);
    }

    #[test]
    fn test_ram_presets_32gb_and_64gb() {
        let (vanilla_32, modded_32, max_32) = calculate_ram_presets(32768);
        assert_eq!(vanilla_32, 6144);
        assert_eq!(modded_32, 8192);
        assert_eq!(max_32, 12288);

        let (vanilla_64, modded_64, max_64) = calculate_ram_presets(65536);
        assert_eq!(vanilla_64, 6144);
        assert_eq!(modded_64, 8192);
        assert_eq!(max_64, 12288);
    }

    #[test]
    fn test_detect_hardware_returns_sane_values() {
        let hw = detect_hardware();
        assert!(hw.total_ram_mb >= 2048);
        assert!(hw.logical_cores >= 1);
        assert!(hw.recommended_vanilla_mb <= hw.recommended_modded_mb);
        assert!(hw.recommended_modded_mb <= hw.max_safe_ram_mb);
    }

    #[test]
    fn test_live_memory_telemetry_separates_process_rss() {
        let idle = super::sample_live_memory_telemetry(&[]);
        assert!(idle.total_ram_mb >= 2048);
        assert!(!idle.game_running);
        assert_eq!(idle.game_rss_mb, 0);

        let self_pid = std::process::id();
        let active = super::sample_live_memory_telemetry(&[self_pid]);
        assert!(active.game_running);
        assert!(active.system_used_mb + active.game_rss_mb <= active.total_ram_mb);
    }
}
