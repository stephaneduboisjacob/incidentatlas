use std::collections::{BTreeMap, HashMap};
use std::io::{self, BufRead, BufReader, Read};
use std::process::{Command, Stdio};
use std::sync::mpsc::Sender;
use std::thread;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use serde_json::{Value, json};

use crate::model::{OperationalEvent, Resource};

const MAX_SOURCE_LINE_BYTES: usize = 64 * 1024;
const UNIT_STARTED: &str = "7d4958e842da4a758f6c1cdc7b36dcc5";
const UNIT_STOPPED: &str = "39f53479d3a045ac8e11786248231fbf";
const UNIT_FAILED: &str = "be02cf6855d2428ba40df7e9d022f03d";
const UNIT_SUCCEEDED: &str = "9d1aaa27d60140bd96365438aad20286";

enum SourceLine {
    Complete(usize),
    Oversized,
    Eof,
}

fn read_bounded_line(reader: &mut impl BufRead, buffer: &mut Vec<u8>) -> io::Result<SourceLine> {
    buffer.clear();
    let mut oversized = false;
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return Ok(if buffer.is_empty() && !oversized {
                SourceLine::Eof
            } else if oversized {
                SourceLine::Oversized
            } else {
                SourceLine::Complete(buffer.len())
            });
        }
        let line_end = available
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(available.len(), |position| position + 1);
        if !oversized {
            let room = MAX_SOURCE_LINE_BYTES.saturating_sub(buffer.len());
            let count = room.min(line_end);
            buffer.extend_from_slice(&available[..count]);
            if count < line_end {
                oversized = true;
            }
        }
        let ended = available.get(line_end.wrapping_sub(1)) == Some(&b'\n');
        reader.consume(line_end);
        if ended {
            return Ok(if oversized {
                SourceLine::Oversized
            } else {
                SourceLine::Complete(buffer.len())
            });
        }
    }
}

fn restart_delay() {
    thread::sleep(Duration::from_secs(2));
}

fn systemd_event(value: &Value, allowlist: &[String]) -> Option<OperationalEvent> {
    let message_id = value.get("MESSAGE_ID")?.as_str()?;
    let (state, severity, kind) = match message_id {
        UNIT_STARTED => ("active", "info", "start"),
        UNIT_STOPPED => ("inactive", "info", "stop"),
        UNIT_FAILED => ("failed", "error", "failure"),
        UNIT_SUCCEEDED => ("active", "info", "recovery"),
        _ => return None,
    };
    let unit = value.get("UNIT")?.as_str()?.trim();
    if unit.is_empty() || unit.len() > 256 || unit.chars().any(char::is_control) {
        return None;
    }
    if !allowlist.is_empty() && !allowlist.iter().any(|allowed| allowed == unit) {
        return None;
    }
    let timestamp = value
        .get("__REALTIME_TIMESTAMP")
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<i64>().ok())
        .and_then(DateTime::from_timestamp_micros)
        .map(|value| value.to_rfc3339())
        .unwrap_or_else(crate::model::now_rfc3339);
    let mut before = BTreeMap::new();
    before.insert("state".to_owned(), json!("unknown"));
    let mut after = BTreeMap::new();
    after.insert("state".to_owned(), json!(state));
    let mut event = OperationalEvent::new(
        "systemd",
        "process",
        "systemd.service_state_changed",
        severity,
        kind,
        Resource {
            resource_type: "service".to_owned(),
            id: unit.to_owned(),
            name: Some(unit.trim_end_matches(".service").to_owned()),
        },
        format!("{unit} transitioned to {state}"),
        timestamp,
        before,
        after,
        BTreeMap::new(),
    );
    event.actor = Some(crate::model::Actor {
        actor_type: "system".to_owned(),
        id: Some("systemd".to_owned()),
        display: Some("systemd".to_owned()),
    });
    Some(event)
}

fn systemd_source(sender: Sender<OperationalEvent>, allowlist: Vec<String>) {
    loop {
        let child = Command::new("journalctl")
            .args(["--follow", "--output=json", "--no-pager", "--lines=0"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn();
        let Ok(mut child) = child else {
            eprintln!("{{\"event\":\"source.systemd.unavailable\"}}");
            restart_delay();
            continue;
        };
        if let Some(stdout) = child.stdout.take() {
            let mut reader = BufReader::new(stdout);
            let mut line = Vec::with_capacity(4096);
            loop {
                match read_bounded_line(&mut reader, &mut line) {
                    Ok(SourceLine::Complete(length)) if length > 0 => {
                        if let Ok(value) = serde_json::from_slice::<Value>(&line)
                            && let Some(event) = systemd_event(&value, &allowlist)
                            && sender.send(event).is_err()
                        {
                            return;
                        }
                    }
                    Ok(SourceLine::Complete(_)) | Ok(SourceLine::Oversized) => continue,
                    Ok(SourceLine::Eof) | Err(_) => break,
                }
            }
        }
        let _ = child.kill();
        let _ = child.wait();
        eprintln!("{{\"event\":\"source.systemd.restarting\"}}");
        restart_delay();
    }
}

fn parse_docker_time(value: &Value) -> String {
    if let Some(nanos) = value.get("timeNano").and_then(Value::as_i64)
        && let Some(timestamp) = DateTime::from_timestamp(
            nanos.div_euclid(1_000_000_000),
            nanos.rem_euclid(1_000_000_000) as u32,
        )
    {
        return timestamp.to_rfc3339();
    }
    if let Some(seconds) = value.get("time").and_then(Value::as_i64)
        && let Some(timestamp) = DateTime::from_timestamp(seconds, 0)
    {
        return timestamp.to_rfc3339();
    }
    Utc::now().to_rfc3339()
}

fn docker_image_id(container_id: &str) -> Option<String> {
    if container_id.is_empty() || !container_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    let mut child = Command::new("docker")
        .args(["inspect", "--format", "{{.Image}}", container_id])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + Duration::from_secs(2);
    let status = loop {
        if let Some(status) = child.try_wait().ok()? {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        thread::sleep(Duration::from_millis(25));
    };
    if !status.success() {
        return None;
    }
    let mut output = String::new();
    child.stdout.take()?.read_to_string(&mut output).ok()?;
    let image = output.trim().to_owned();
    if image.starts_with("sha256:") && image.len() <= 128 {
        Some(image)
    } else {
        None
    }
}

fn docker_event(
    value: &Value,
    previous_images: &mut HashMap<String, String>,
) -> Vec<OperationalEvent> {
    let Some(action) = value
        .get("Action")
        .or_else(|| value.get("status"))
        .and_then(Value::as_str)
    else {
        return Vec::new();
    };
    let actor = &value["Actor"];
    let attributes = &actor["Attributes"];
    let Some(id) = actor.get("ID").and_then(Value::as_str) else {
        return Vec::new();
    };
    if id.is_empty() || id.len() > 128 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Vec::new();
    }
    let name = attributes
        .get("name")
        .and_then(Value::as_str)
        .filter(|value| {
            !value.is_empty() && value.len() <= 256 && !value.chars().any(char::is_control)
        });
    let resource_name = name
        .map(str::to_owned)
        .unwrap_or_else(|| id.chars().take(12).collect());
    let image = attributes
        .get("image")
        .and_then(Value::as_str)
        .filter(|value| value.len() <= 512 && !value.chars().any(char::is_control));
    let image_id = if matches!(action, "create" | "start") {
        docker_image_id(id).or_else(|| image.map(str::to_owned))
    } else {
        image.map(str::to_owned)
    };
    let time = parse_docker_time(value);
    let resource = Resource {
        resource_type: "container".to_owned(),
        id: id.to_owned(),
        name: Some(resource_name.clone()),
    };
    let mut events = Vec::new();

    if matches!(action, "create" | "start")
        && let Some(current_image) = image_id.as_ref()
        && let Some(previous) = previous_images.insert(resource_name.clone(), current_image.clone())
        && previous != *current_image
    {
        let mut before = BTreeMap::new();
        before.insert("image".to_owned(), json!(previous));
        let mut after = BTreeMap::new();
        after.insert("image".to_owned(), json!(current_image));
        events.push(OperationalEvent::new(
            "docker",
            "deployment",
            "container.image_changed",
            "warning",
            "update",
            resource.clone(),
            format!("Container {resource_name} image changed"),
            time.clone(),
            before,
            after,
            BTreeMap::new(),
        ));
    }

    let (event_type, severity, change_kind, state) =
        if let Some(health) = action.strip_prefix("health_status:") {
            match health.trim() {
                "healthy" => ("container.health_changed", "info", "recovery", "healthy"),
                "unhealthy" => ("container.health_changed", "error", "failure", "unhealthy"),
                "starting" => ("container.health_changed", "info", "update", "starting"),
                _ => return events,
            }
        } else {
            match action {
                "create" => ("container.created", "info", "create", "created"),
                "start" => ("container.started", "info", "start", "running"),
                "stop" => ("container.stopped", "info", "stop", "stopped"),
                "die" => {
                    let exit_code = attributes
                        .get("exitCode")
                        .and_then(Value::as_str)
                        .and_then(|value| value.parse::<i32>().ok());
                    if exit_code.is_some_and(|value| value != 0) {
                        ("container.exited", "error", "failure", "exited")
                    } else {
                        ("container.exited", "info", "stop", "exited")
                    }
                }
                "kill" => ("container.killed", "warning", "failure", "killed"),
                "restart" => ("container.restarted", "warning", "restart", "running"),
                "destroy" => ("container.destroyed", "info", "delete", "destroyed"),
                _ => return events,
            }
        };
    let mut after = BTreeMap::new();
    after.insert("state".to_owned(), json!(state));
    if let Some(image) = image_id {
        after.insert("image".to_owned(), json!(image));
    }
    if let Some(exit_code) = attributes
        .get("exitCode")
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<i32>().ok())
    {
        after.insert("exit_code".to_owned(), json!(exit_code));
    }
    let summary = format!("Container {resource_name} {state}");
    events.push(OperationalEvent::new(
        "docker",
        "container",
        event_type,
        severity,
        change_kind,
        resource,
        summary,
        time,
        BTreeMap::new(),
        after,
        BTreeMap::new(),
    ));
    events
}

fn docker_source(sender: Sender<OperationalEvent>) {
    let mut previous_images = HashMap::new();
    loop {
        let child = Command::new("docker")
            .args([
                "events",
                "--filter",
                "type=container",
                "--format",
                "{{json .}}",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn();
        let Ok(mut child) = child else {
            eprintln!("{{\"event\":\"source.docker.unavailable\"}}");
            restart_delay();
            continue;
        };
        if let Some(stdout) = child.stdout.take() {
            let mut reader = BufReader::new(stdout);
            let mut line = Vec::with_capacity(4096);
            loop {
                match read_bounded_line(&mut reader, &mut line) {
                    Ok(SourceLine::Complete(length)) if length > 0 => {
                        if let Ok(value) = serde_json::from_slice::<Value>(&line) {
                            for event in docker_event(&value, &mut previous_images) {
                                if sender.send(event).is_err() {
                                    return;
                                }
                            }
                        }
                    }
                    Ok(SourceLine::Complete(_)) | Ok(SourceLine::Oversized) => continue,
                    Ok(SourceLine::Eof) | Err(_) => break,
                }
            }
        }
        let _ = child.kill();
        let _ = child.wait();
        eprintln!("{{\"event\":\"source.docker.restarting\"}}");
        restart_delay();
    }
}

pub fn start_systemd(sender: Sender<OperationalEvent>, allowlist: Vec<String>) {
    thread::Builder::new()
        .name("incidentatlas-systemd".to_owned())
        .spawn(move || systemd_source(sender, allowlist))
        .expect("systemd source thread starts");
}

pub fn start_docker(sender: Sender<OperationalEvent>) {
    thread::Builder::new()
        .name("incidentatlas-docker".to_owned())
        .spawn(move || docker_source(sender))
        .expect("Docker source thread starts");
}

pub fn source_available(name: &str) -> bool {
    match name {
        "systemd" => Command::new("journalctl")
            .args(["--version"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success()),
        "docker" => Command::new("docker")
            .args(["version", "--format", "{{.Server.Version}}"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success()),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_systemd_transitions_without_journal_message_text() {
        let line = json!({
            "MESSAGE_ID": UNIT_FAILED,
            "UNIT": "nginx.service",
            "MESSAGE": "password=hunter2 this raw message must not appear",
            "__REALTIME_TIMESTAMP": "1790961600000000"
        });
        let event = systemd_event(&line, &[]).expect("recognized systemd unit failure");
        let serialized = serde_json::to_string(&event).expect("serializes event");
        assert!(serialized.contains("nginx.service transitioned to failed"));
        assert!(!serialized.contains("hunter2"));
        assert!(!serialized.contains("raw message"));
        assert_eq!(event.category, "process");
        assert_eq!(event.change_kind, "failure");
    }

    #[test]
    fn ignores_non_lifecycle_journal_entries() {
        assert!(systemd_event(&json!({"MESSAGE":"ordinary service log"}), &[]).is_none());
        assert!(
            systemd_event(
                &json!({"MESSAGE_ID":UNIT_STARTED,"MESSAGE":"missing unit"}),
                &[]
            )
            .is_none()
        );
    }

    #[test]
    fn systemd_source_respects_an_explicit_unit_allowlist() {
        let event = json!({"MESSAGE_ID":UNIT_STARTED,"UNIT":"nginx.service"});
        assert!(systemd_event(&event, &["incidentatlas-agent.service".to_owned()]).is_none());
        assert!(systemd_event(&event, &["nginx.service".to_owned()]).is_some());
    }

    #[test]
    fn parses_only_container_lifecycle_metadata() {
        let mut images = HashMap::new();
        let value = json!({
            "Action":"die",
            "time":1790961600,
            "Actor":{"ID":"0123456789abcdef","Attributes":{"name":"api","image":"registry.example/api:v2","exitCode":"2","secret":"must not be copied"}}
        });
        let events = docker_event(&value, &mut images);
        assert_eq!(events.len(), 1);
        let serialized = serde_json::to_string(&events[0]).expect("serializes event");
        assert!(serialized.contains("exit_code"));
        assert!(!serialized.contains("must not be copied"));
        assert_eq!(events[0].change_kind, "failure");
    }
}
