use serde::Serialize;
use thiserror::Error;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Network request failed: {0}")]
    Network(#[from] reqwest::Error),

    #[error("JSON serialization/deserialization failed: {0}")]
    Json(#[from] serde_json::Error),

    #[error("ZIP archive error: {0}")]
    Zip(#[from] zip::result::ZipError),

    #[error("Integrity mismatch for {path}: expected {expected}, got {actual}")]
    IntegrityMismatch {
        path: String,
        expected: String,
        actual: String,
    },

    #[error("Java runtime {required_major} is not installed")]
    JavaNotFound { required_major: u32 },

    #[error("Manifest error: {0}")]
    ManifestError(String),

    #[error("Process launch failed: {0}")]
    ProcessLaunch(String),

    #[error("Win32 API error: {0}")]
    Win32Error(String),

    #[error("Configuration error: {0}")]
    ConfigError(String),

    #[error("Content management error: {0}")]
    ContentError(String),

    #[error("Mod loader error: {0}")]
    LoaderError(String),
}

impl AppError {
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            Self::Io(_) => "IO_ERROR",
            Self::Network(_) => "NETWORK_ERROR",
            Self::Json(_) => "JSON_ERROR",
            Self::Zip(_) => "ZIP_ERROR",
            Self::IntegrityMismatch { .. } => "INTEGRITY_MISMATCH",
            Self::JavaNotFound { .. } => "JAVA_NOT_FOUND",
            Self::ManifestError(_) => "MANIFEST_ERROR",
            Self::ProcessLaunch(_) => "PROCESS_LAUNCH_ERROR",
            Self::Win32Error(_) => "WIN32_ERROR",
            Self::ConfigError(_) => "CONFIG_ERROR",
            Self::ContentError(_) => "CONTENT_ERROR",
            Self::LoaderError(_) => "LOADER_ERROR",
        }
    }
}

#[derive(Serialize)]
struct SerializedError {
    code: &'static str,
    message: String,
    required_major: Option<u32>,
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let required_major = match self {
            Self::JavaNotFound { required_major } => Some(*required_major),
            _ => None,
        };
        let payload = SerializedError {
            code: self.code(),
            message: self.to_string(),
            required_major,
        };
        payload.serialize(serializer)
    }
}
