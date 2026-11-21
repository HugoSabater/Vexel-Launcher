use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GcPreset {
    GenerationalZgc,
    AikarG1Gc,
}

#[derive(Debug, Clone)]
pub struct JvmTuningInput {
    pub java_major: u32,
    pub ram_mb: u64,
    pub logical_cores: usize,
    pub gc_preset: GcPreset,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JvmTuningOutput {
    pub effective_gc: GcPreset,
    pub flags: Vec<String>,
    pub fallback_notice: Option<String>,
}

#[must_use]
pub fn generate_jvm_flags(input: &JvmTuningInput) -> JvmTuningOutput {
    let ram_mb = input.ram_mb.max(1024);
    let initial_ram_mb = ram_mb.min(1024);
    let mut flags = vec![format!("-Xms{initial_ram_mb}M"), format!("-Xmx{ram_mb}M")];

    if input.gc_preset == GcPreset::GenerationalZgc && input.java_major >= 21 {
        let conc_threads = (input.logical_cores / 4).clamp(1, 4);
        flags.extend([
            "-XX:+UnlockExperimentalVMOptions".to_string(),
            "-XX:+UseZGC".to_string(),
        ]);
        if input.java_major < 23 {
            flags.push("-XX:+ZGenerational".to_string());
        }
        flags.extend([
            "-XX:+DisableExplicitGC".to_string(),
            "-XX:+PerfDisableSharedMem".to_string(),
            format!("-XX:ConcGCThreads={conc_threads}"),
        ]);

        return JvmTuningOutput {
            effective_gc: GcPreset::GenerationalZgc,
            flags,
            fallback_notice: None,
        };
    }

    let fallback_notice = if input.gc_preset == GcPreset::GenerationalZgc && input.java_major < 21 {
        Some(format!(
            "Java {} detected; Generational ZGC requires Java 21+. Falling back safely to Aikar's G1GC.",
            input.java_major
        ))
    } else {
        None
    };

    flags.extend([
        "-XX:+UseG1GC".to_string(),
        "-XX:+ParallelRefProcEnabled".to_string(),
        "-XX:MaxGCPauseMillis=50".to_string(),
        "-XX:+UnlockExperimentalVMOptions".to_string(),
        "-XX:+DisableExplicitGC".to_string(),
    ]);

    if ram_mb >= 12288 {
        flags.extend([
            "-XX:G1NewSizePercent=40".to_string(),
            "-XX:G1MaxNewSizePercent=50".to_string(),
            "-XX:G1HeapRegionSize=16M".to_string(),
            "-XX:G1ReservePercent=15".to_string(),
            "-XX:InitiatingHeapOccupancyPercent=20".to_string(),
        ]);
    } else {
        flags.extend([
            "-XX:G1NewSizePercent=30".to_string(),
            "-XX:G1MaxNewSizePercent=40".to_string(),
            "-XX:G1HeapRegionSize=8M".to_string(),
            "-XX:G1ReservePercent=20".to_string(),
            "-XX:InitiatingHeapOccupancyPercent=15".to_string(),
        ]);
    }

    flags.extend([
        "-XX:G1HeapWastePercent=5".to_string(),
        "-XX:G1MixedGCCountTarget=4".to_string(),
        "-XX:G1MixedGCLiveThresholdPercent=90".to_string(),
        "-XX:G1RSetUpdatingPauseTimePercent=5".to_string(),
        "-XX:SurvivorRatio=32".to_string(),
        "-XX:+PerfDisableSharedMem".to_string(),
        "-XX:MaxTenuringThreshold=1".to_string(),
        "-Dusing.aikars.flags=https://mcflags.emc.gs".to_string(),
        "-Daikars.new.flags=true".to_string(),
    ]);

    JvmTuningOutput {
        effective_gc: GcPreset::AikarG1Gc,
        flags,
        fallback_notice,
    }
}

#[cfg(test)]
mod tests {
    use super::{generate_jvm_flags, GcPreset, JvmTuningInput};

    #[test]
    fn test_java_21_generational_zgc() {
        let out = generate_jvm_flags(&JvmTuningInput {
            java_major: 21,
            ram_mb: 6144,
            logical_cores: 16,
            gc_preset: GcPreset::GenerationalZgc,
        });

        assert_eq!(out.effective_gc, GcPreset::GenerationalZgc);
        assert!(out.fallback_notice.is_none());
        assert!(out.flags.contains(&"-Xms1024M".to_string()));
        assert!(out.flags.contains(&"-Xmx6144M".to_string()));
        assert!(out.flags.contains(&"-XX:+UseZGC".to_string()));
        assert!(out.flags.contains(&"-XX:+ZGenerational".to_string()));
        assert!(out.flags.contains(&"-XX:ConcGCThreads=4".to_string()));
        assert!(!out.flags.contains(&"-XX:+AlwaysPreTouch".to_string()));
        assert!(!out
            .flags
            .contains(&"-Dfml.ignoreInvalidMinecraftCertificates=true".to_string()));
    }

    #[test]
    fn test_java_23_zgc_omits_deprecated_generational_flag() {
        let out = generate_jvm_flags(&JvmTuningInput {
            java_major: 23,
            ram_mb: 6144,
            logical_cores: 8,
            gc_preset: GcPreset::GenerationalZgc,
        });

        assert_eq!(out.effective_gc, GcPreset::GenerationalZgc);
        assert!(out.flags.contains(&"-XX:+UseZGC".to_string()));
        assert!(!out.flags.contains(&"-XX:+ZGenerational".to_string()));
    }

    #[test]
    fn test_java_17_zgc_falls_back_to_aikar_g1gc() {
        let out = generate_jvm_flags(&JvmTuningInput {
            java_major: 17,
            ram_mb: 4096,
            logical_cores: 8,
            gc_preset: GcPreset::GenerationalZgc,
        });

        assert_eq!(out.effective_gc, GcPreset::AikarG1Gc);
        assert!(out.fallback_notice.is_some());
        assert!(out.flags.contains(&"-Xms1024M".to_string()));
        assert!(out.flags.contains(&"-XX:+UseG1GC".to_string()));
        assert!(out.flags.contains(&"-XX:MaxGCPauseMillis=50".to_string()));
        assert!(out.flags.contains(&"-XX:G1HeapRegionSize=8M".to_string()));
        assert!(!out.flags.contains(&"-XX:+UseZGC".to_string()));
        assert!(!out.flags.contains(&"-XX:+AlwaysPreTouch".to_string()));
    }

    #[test]
    fn test_java_8_standard_and_high_memory_g1gc() {
        let standard = generate_jvm_flags(&JvmTuningInput {
            java_major: 8,
            ram_mb: 3072,
            logical_cores: 4,
            gc_preset: GcPreset::AikarG1Gc,
        });
        assert_eq!(standard.effective_gc, GcPreset::AikarG1Gc);
        assert!(standard.fallback_notice.is_none());
        assert!(standard.flags.contains(&"-XX:G1NewSizePercent=30".to_string()));

        let high_mem = generate_jvm_flags(&JvmTuningInput {
            java_major: 21,
            ram_mb: 12288,
            logical_cores: 12,
            gc_preset: GcPreset::AikarG1Gc,
        });
        assert!(high_mem.flags.contains(&"-XX:G1NewSizePercent=40".to_string()));
        assert!(high_mem.flags.contains(&"-XX:G1HeapRegionSize=16M".to_string()));
    }
}
