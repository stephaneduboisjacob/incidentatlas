use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("could not read configuration file")]
    Read(#[from] std::io::Error),
    #[error("configuration file is invalid")]
    Parse(#[from] toml::de::Error),
    #[error("configuration values are outside supported bounds")]
    Invalid,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Mode {
    #[default]
    DryRun,
    Local,
    Connected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub mode: Mode,
    pub server: ServerConfig,
    pub collector: CollectorConfig,
    pub sources: SourcesConfig,
    pub redaction: RedactionConfig,
    pub watch: WatchConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ServerConfig {
    pub url: String,
    pub enrollment_token_file: PathBuf,
    pub credential_file: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct CollectorConfig {
    pub queue_path: PathBuf,
    pub queue_max_mb: u64,
    pub batch_max_events: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct SourcesConfig {
    pub systemd: bool,
    pub systemd_units: Vec<String>,
    pub docker: bool,
    pub nginx: bool,
    pub postgres: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct RedactionConfig {
    pub preset: String,
    pub redact_email_addresses: bool,
    pub redact_ip_addresses: bool,
    pub custom_patterns: Vec<CustomPattern>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomPattern {
    pub name: String,
    pub regex: String,
    pub replacement: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct WatchConfig {
    pub files: Vec<PathBuf>,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            url: String::new(),
            enrollment_token_file: PathBuf::from("/etc/incidentatlas/enrollment-token"),
            credential_file: PathBuf::from("/var/lib/incidentatlas/credential"),
        }
    }
}

impl Default for CollectorConfig {
    fn default() -> Self {
        Self {
            queue_path: PathBuf::from("/var/lib/incidentatlas/queue.sqlite3"),
            queue_max_mb: 256,
            batch_max_events: 100,
        }
    }
}

impl Default for SourcesConfig {
    fn default() -> Self {
        Self {
            systemd: true,
            systemd_units: Vec::new(),
            docker: false,
            nginx: false,
            postgres: false,
        }
    }
}

impl Default for RedactionConfig {
    fn default() -> Self {
        Self {
            preset: "strict".to_owned(),
            redact_email_addresses: true,
            redact_ip_addresses: false,
            custom_patterns: Vec::new(),
        }
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            mode: Mode::DryRun,
            server: ServerConfig::default(),
            collector: CollectorConfig::default(),
            sources: SourcesConfig::default(),
            redaction: RedactionConfig::default(),
            watch: WatchConfig::default(),
        }
    }
}

impl Config {
    pub fn load(path: &Path) -> Result<Self, ConfigError> {
        let contents = fs::read_to_string(path)?;
        let value: Self = toml::from_str(&contents)?;
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), ConfigError> {
        if !(16..=4096).contains(&self.collector.queue_max_mb)
            || !(1..=100).contains(&self.collector.batch_max_events)
            || !matches!(self.redaction.preset.as_str(), "strict" | "credentials")
            || self.sources.systemd_units.iter().any(|unit| {
                unit.is_empty() || unit.len() > 256 || unit.chars().any(char::is_control)
            })
            || self.sources.nginx != !self.watch.files.is_empty()
            || self.watch.files.iter().enumerate().any(|(index, path)| {
                !path.is_absolute()
                    || path.as_os_str().len() > 4096
                    || path.to_string_lossy().chars().any(char::is_control)
                    || self.watch.files[..index].contains(path)
            })
            || self.redaction.custom_patterns.iter().any(|pattern| {
                pattern.name.is_empty()
                    || pattern.name.len() > 64
                    || pattern.regex.len() > 2048
                    || pattern.replacement.len() > 128
                    || regex::Regex::new(&pattern.regex).is_err()
            })
        {
            return Err(ConfigError::Invalid);
        }
        if self.mode == Mode::Connected {
            let url = reqwest::Url::parse(&self.server.url).map_err(|_| ConfigError::Invalid)?;
            if url.scheme() != "https"
                || url.host_str().is_none()
                || url.path() != "/"
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
            {
                return Err(ConfigError::Invalid);
            }
        }
        Ok(())
    }
}

pub fn default_config_path() -> PathBuf {
    std::env::var_os("INCIDENTATLAS_CONFIG")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/etc/incidentatlas/agent.toml"))
}

pub fn example_config() -> &'static str {
    r#"mode = "dry-run"

[server]
url = "http://127.0.0.1:14000"
enrollment_token_file = "/etc/incidentatlas/enrollment-token"
credential_file = "/var/lib/incidentatlas/credential"

[collector]
queue_path = "/var/lib/incidentatlas/queue.sqlite3"
queue_max_mb = 256
batch_max_events = 100

[sources]
systemd = true
systemd_units = []
docker = false
nginx = false
postgres = false

[redaction]
preset = "strict"
redact_email_addresses = true
redact_ip_addresses = false
custom_patterns = []

[watch]
files = []
"#
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nginx_watch_requires_unique_absolute_paths_and_an_enabled_source() {
        let mut config = Config::default();
        assert!(config.validate().is_ok());

        config.sources.nginx = true;
        config.watch.files = vec![PathBuf::from("/etc/nginx/nginx.conf")];
        assert!(config.validate().is_ok());

        config
            .watch
            .files
            .push(PathBuf::from("/etc/nginx/nginx.conf"));
        assert!(matches!(config.validate(), Err(ConfigError::Invalid)));

        config.watch.files = vec![PathBuf::from("relative/nginx.conf")];
        assert!(matches!(config.validate(), Err(ConfigError::Invalid)));

        config.sources.nginx = false;
        assert!(matches!(config.validate(), Err(ConfigError::Invalid)));
    }
}
