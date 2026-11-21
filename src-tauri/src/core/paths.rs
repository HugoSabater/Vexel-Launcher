use std::path::{Path, PathBuf};

use directories::ProjectDirs;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone)]
pub struct LauncherPaths {
    root: PathBuf,
}

impl LauncherPaths {
    pub fn resolve() -> AppResult<Self> {
        let proj = ProjectDirs::from("com", "mclauncher", "mc-launcher-rust").ok_or_else(|| {
            AppError::ConfigError(
                "Unable to resolve portable application data directory".to_string(),
            )
        })?;
        Ok(Self {
            root: proj.data_local_dir().to_path_buf(),
        })
    }

    #[must_use]
    pub fn with_root(root: PathBuf) -> Self {
        Self { root }
    }

    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    #[must_use]
    pub fn shared_dir(&self) -> PathBuf {
        self.root.join("shared")
    }

    #[must_use]
    pub fn shared_assets_dir(&self) -> PathBuf {
        self.shared_dir().join("assets")
    }

    #[must_use]
    pub fn shared_assets_indexes_dir(&self) -> PathBuf {
        self.shared_assets_dir().join("indexes")
    }

    #[must_use]
    pub fn shared_assets_objects_dir(&self) -> PathBuf {
        self.shared_assets_dir().join("objects")
    }

    #[must_use]
    pub fn shared_assets_log_configs_dir(&self) -> PathBuf {
        self.shared_assets_dir().join("log_configs")
    }

    #[must_use]
    pub fn shared_libraries_dir(&self) -> PathBuf {
        self.shared_dir().join("libraries")
    }

    #[must_use]
    pub fn shared_versions_dir(&self) -> PathBuf {
        self.shared_dir().join("versions")
    }

    #[must_use]
    pub fn version_dir(&self, version_id: &str) -> PathBuf {
        self.shared_versions_dir().join(version_id)
    }

    #[must_use]
    pub fn version_json_path(&self, version_id: &str) -> PathBuf {
        self.version_dir(version_id)
            .join(format!("{version_id}.json"))
    }

    #[must_use]
    pub fn version_jar_path(&self, version_id: &str) -> PathBuf {
        self.version_dir(version_id)
            .join(format!("{version_id}.jar"))
    }

    #[must_use]
    pub fn shared_runtimes_dir(&self) -> PathBuf {
        self.shared_dir().join("runtimes")
    }

    #[must_use]
    pub fn runtime_dir(&self, java_major: u32) -> PathBuf {
        self.shared_runtimes_dir()
            .join(format!("java-{java_major}"))
    }

    #[must_use]
    pub fn shared_cache_dir(&self) -> PathBuf {
        self.shared_dir().join("cache")
    }

    #[must_use]
    pub fn shared_skins_dir(&self) -> PathBuf {
        self.shared_dir().join("skins")
    }

    #[must_use]
    pub fn custom_skin_path(&self) -> PathBuf {
        self.shared_skins_dir().join("custom_skin.png")
    }

    #[must_use]
    pub fn integrity_index_path(&self) -> PathBuf {
        self.shared_cache_dir().join("integrity_index.json")
    }

    #[must_use]
    pub fn instances_dir(&self) -> PathBuf {
        self.root.join("instances")
    }

    #[must_use]
    pub fn instance_dir(&self, profile_id: &str) -> PathBuf {
        self.instances_dir().join(profile_id)
    }

    #[must_use]
    pub fn instance_mods_dir(&self, profile_id: &str) -> PathBuf {
        self.instance_dir(profile_id).join("mods")
    }

    #[must_use]
    pub fn instance_resourcepacks_dir(&self, profile_id: &str) -> PathBuf {
        self.instance_dir(profile_id).join("resourcepacks")
    }

    #[must_use]
    pub fn instance_shaderpacks_dir(&self, profile_id: &str) -> PathBuf {
        self.instance_dir(profile_id).join("shaderpacks")
    }

    #[must_use]
    pub fn instance_saves_dir(&self, profile_id: &str) -> PathBuf {
        self.instance_dir(profile_id).join("saves")
    }

    #[must_use]
    pub fn instance_config_dir(&self, profile_id: &str) -> PathBuf {
        self.instance_dir(profile_id).join("config")
    }

    #[must_use]
    pub fn instance_screenshots_dir(&self, profile_id: &str) -> PathBuf {
        self.instance_dir(profile_id).join("screenshots")
    }

    #[must_use]
    pub fn instance_natives_dir(&self, profile_id: &str) -> PathBuf {
        self.instance_dir(profile_id).join("natives")
    }

    #[must_use]
    pub fn instance_natives_version_dir(&self, profile_id: &str, mc_version: &str) -> PathBuf {
        self.instance_natives_dir(profile_id).join(mc_version)
    }

    #[must_use]
    pub fn instance_content_index_path(&self, profile_id: &str) -> PathBuf {
        self.instance_dir(profile_id).join(".content_index.json")
    }

    #[must_use]
    pub fn config_path(&self) -> PathBuf {
        self.root.join("config.json")
    }

    pub async fn ensure_base_dirs(&self) -> AppResult<()> {
        let dirs = [
            self.root.clone(),
            self.shared_assets_indexes_dir(),
            self.shared_assets_objects_dir(),
            self.shared_assets_log_configs_dir(),
            self.shared_libraries_dir(),
            self.shared_versions_dir(),
            self.shared_runtimes_dir(),
            self.shared_cache_dir(),
            self.shared_skins_dir(),
            self.instances_dir(),
        ];

        for dir in dirs {
            tokio::fs::create_dir_all(&dir).await?;
        }
        Ok(())
    }

    pub async fn ensure_instance_dirs(&self, profile_id: &str) -> AppResult<()> {
        let dirs = [
            self.instance_dir(profile_id),
            self.instance_mods_dir(profile_id),
            self.instance_resourcepacks_dir(profile_id),
            self.instance_shaderpacks_dir(profile_id),
            self.instance_saves_dir(profile_id),
            self.instance_natives_dir(profile_id),
        ];

        for dir in dirs {
            tokio::fs::create_dir_all(&dir).await?;
        }
        Ok(())
    }
}
