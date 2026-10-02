use std::fmt::Write as FmtWrite;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use uuid::Uuid;

use crate::config::Config;
use crate::model::{EventBatch, OperationalEvent};

#[derive(Debug, Error)]
pub enum ClientError {
    #[error("server configuration is invalid")]
    Configuration,
    #[error("server request failed")]
    Request(#[from] reqwest::Error),
    #[error("server returned a non-success status")]
    Status,
    #[error("server response was invalid")]
    Response(#[from] serde_json::Error),
    #[error("credential file is missing or unsafe")]
    Credential,
    #[error("enrollment token file is missing or unsafe")]
    EnrollmentToken,
    #[error("credential storage failed")]
    Storage(#[from] std::io::Error),
}

#[derive(Debug, Deserialize)]
struct RegistrationResponse {
    credential: String,
}

#[derive(Debug, Deserialize)]
struct BatchResponse {
    accepted: usize,
    duplicates: usize,
}

#[derive(Debug, Serialize)]
struct RegistrationRequest<'a> {
    enrollment_token: &'a str,
    hostname: &'a str,
    machine_id_hash: &'a str,
    operating_system: &'a str,
    kernel: &'a str,
    agent_version: &'a str,
    schema_version: u8,
}

pub struct ApiClient {
    client: Client,
    base_url: reqwest::Url,
    credential_path: PathBuf,
    enrollment_path: PathBuf,
}

impl ApiClient {
    pub fn new(config: &Config) -> Result<Self, ClientError> {
        let base_url =
            reqwest::Url::parse(&config.server.url).map_err(|_| ClientError::Configuration)?;
        if base_url.scheme() != "https"
            || base_url.host_str().is_none()
            || base_url.path() != "/"
            || !base_url.username().is_empty()
            || base_url.password().is_some()
        {
            return Err(ClientError::Configuration);
        }
        let client = Client::builder()
            .timeout(Duration::from_secs(12))
            .connect_timeout(Duration::from_secs(5))
            .user_agent(concat!("incidentatlas-agent/", env!("CARGO_PKG_VERSION")))
            .build()?;
        Ok(Self {
            client,
            base_url,
            credential_path: config.server.credential_file.clone(),
            enrollment_path: config.server.enrollment_token_file.clone(),
        })
    }

    fn endpoint(&self, path: &str) -> Result<reqwest::Url, ClientError> {
        self.base_url
            .join(path)
            .map_err(|_| ClientError::Configuration)
    }

    pub fn health(&self) -> Result<bool, ClientError> {
        let response = self.client.get(self.endpoint("/health/ready")?).send()?;
        Ok(response.status().is_success())
    }

    pub fn credential(&self) -> Result<String, ClientError> {
        match fs::symlink_metadata(&self.credential_path) {
            Ok(_) => {
                let value = read_private_file(&self.credential_path, false)
                    .map_err(|_| ClientError::Credential)?;
                let token = value.trim();
                if token.len() != 43
                    || !token
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
                {
                    return Err(ClientError::Credential);
                }
                Ok(token.to_owned())
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => self.enroll(),
            Err(_) => Err(ClientError::Credential),
        }
    }

    fn enroll(&self) -> Result<String, ClientError> {
        let enrollment_token = read_private_file(&self.enrollment_path, true)
            .map_err(|_| ClientError::EnrollmentToken)?;
        let token = enrollment_token.trim();
        if token.len() < 32 {
            return Err(ClientError::EnrollmentToken);
        }
        let hostname = hostname();
        let machine_id_hash = machine_id_hash()?;
        let operating_system = operating_system();
        let kernel = kernel_version();
        let request = RegistrationRequest {
            enrollment_token: token,
            hostname: &hostname,
            machine_id_hash: &machine_id_hash,
            operating_system: &operating_system,
            kernel: &kernel,
            agent_version: env!("CARGO_PKG_VERSION"),
            schema_version: 1,
        };
        let response = self
            .client
            .post(self.endpoint("/api/v1/collector/register")?)
            .json(&request)
            .send()?;
        if response.status() != reqwest::StatusCode::CREATED {
            return Err(ClientError::Status);
        }
        let response: RegistrationResponse = response.json()?;
        if response.credential.len() != 43
            || !response
                .credential
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
        {
            return Err(ClientError::Credential);
        }
        write_private_file(&self.credential_path, &response.credential)?;
        Ok(response.credential)
    }

    pub fn send_batch(
        &self,
        credential: &str,
        events: &[OperationalEvent],
    ) -> Result<(), ClientError> {
        let response = self
            .client
            .post(self.endpoint("/api/v1/collector/events")?)
            .bearer_auth(credential)
            .json(&EventBatch {
                schema_version: 1,
                events,
            })
            .send()?;
        if response.status() != reqwest::StatusCode::ACCEPTED {
            return Err(ClientError::Status);
        }
        let ack: BatchResponse = response.json()?;
        if ack.accepted.saturating_add(ack.duplicates) != events.len() {
            return Err(ClientError::Status);
        }
        Ok(())
    }
}

fn read_private_file(path: &Path, allow_group_read: bool) -> Result<String, std::io::Error> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "expected a regular file",
        ));
    }
    let mode = metadata.permissions().mode() & 0o777;
    let allowed = if allow_group_read {
        mode & 0o027 == 0
    } else {
        mode & 0o077 == 0
    };
    if !allowed {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "file permissions are too broad",
        ));
    }
    fs::read_to_string(path)
}

fn write_private_file(path: &Path, value: &str) -> Result<(), std::io::Error> {
    let parent = path
        .parent()
        .filter(|value| !value.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let parent_existed = parent.exists();
    fs::create_dir_all(parent)?;
    let parent_metadata = fs::symlink_metadata(parent)?;
    if !parent_metadata.is_dir() || parent_metadata.file_type().is_symlink() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "credential parent must be a directory",
        ));
    }
    if !parent_existed {
        fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?;
    }
    if fs::symlink_metadata(path)
        .is_ok_and(|metadata| !metadata.file_type().is_file() || metadata.file_type().is_symlink())
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "credential path must be a regular file",
        ));
    }
    let temp = parent.join(format!(".incidentatlas-credential-{}.tmp", Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&temp)?;
    file.write_all(value.as_bytes())?;
    file.sync_all()?;
    fs::rename(&temp, path)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    if let Ok(directory) = fs::File::open(parent) {
        let _ = directory.sync_all();
    }
    Ok(())
}

fn hostname() -> String {
    let value = fs::read_to_string("/etc/hostname").unwrap_or_default();
    let value = value.trim();
    if !value.is_empty()
        && value.len() <= 253
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return value.to_owned();
    }
    "unknown-host".to_owned()
}

fn machine_id_hash() -> Result<String, ClientError> {
    let machine_id =
        fs::read_to_string("/etc/machine-id").map_err(|_| ClientError::Configuration)?;
    let machine_id = machine_id.trim();
    if machine_id.len() < 16 || !machine_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(ClientError::Configuration);
    }
    let digest = Sha256::digest(machine_id.as_bytes());
    let mut output = String::with_capacity(64);
    for byte in digest {
        let _ = write!(&mut output, "{byte:02x}");
    }
    Ok(output)
}

fn operating_system() -> String {
    let release = fs::read_to_string("/etc/os-release").unwrap_or_default();
    let value = release
        .lines()
        .find_map(|line| line.strip_prefix("PRETTY_NAME="))
        .map(|value| value.trim_matches('"').replace('\\', ""))
        .unwrap_or_else(|| "Linux".to_owned());
    value
        .chars()
        .filter(|character| !character.is_control())
        .take(128)
        .collect()
}

fn kernel_version() -> String {
    Command::new("uname")
        .arg("-r")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| {
            String::from_utf8_lossy(&output.stdout)
                .trim()
                .chars()
                .take(256)
                .collect()
        })
        .unwrap_or_default()
}
