mod client;
mod config;
mod model;
mod queue;
mod redaction;
mod sources;

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant};

use clap::{Parser, Subcommand};
use config::{Config, Mode};
use model::{OperationalEvent, Resource};
use serde_json::json;
use uuid::Uuid;

#[derive(Debug, Parser)]
#[command(
    name = "incidentatlas-agent",
    version,
    about = "Linux operational change collector"
)]
struct Args {
    #[arg(long, global = true, value_name = "PATH")]
    config: Option<PathBuf>,
    #[command(subcommand)]
    command: Option<CommandLine>,
}

#[derive(Debug, Subcommand)]
enum CommandLine {
    Run,
    Status,
    Doctor,
    TestRedaction,
    TestSource { source: String },
    PrintConfig,
}

fn main() {
    if let Err(code) = execute() {
        eprintln!("{{\"event\":\"agent.command.failed\",\"error_code\":\"{code}\"}}");
        std::process::exit(1);
    }
}

fn execute() -> Result<(), &'static str> {
    let args = Args::parse();
    let command = args.command.unwrap_or(CommandLine::Run);
    if matches!(command, CommandLine::PrintConfig) {
        print!("{}", config::example_config());
        return Ok(());
    }
    if matches!(command, CommandLine::TestRedaction) {
        return test_redaction();
    }
    let path = args.config.unwrap_or_else(config::default_config_path);
    let config = Config::load(&path).map_err(|_| "configuration_invalid")?;
    match command {
        CommandLine::Run => run(config),
        CommandLine::Status => status(&config),
        CommandLine::Doctor => doctor(&config),
        CommandLine::TestSource { source } => test_source(&config, &source),
        CommandLine::TestRedaction | CommandLine::PrintConfig => Ok(()),
    }
}

fn status(config: &Config) -> Result<(), &'static str> {
    let queue = queue::Queue::open(&config.collector.queue_path, config.collector.queue_max_mb)
        .map_err(|_| "queue_unavailable")?;
    let credential_present = std::fs::symlink_metadata(&config.server.credential_file)
        .is_ok_and(|metadata| metadata.file_type().is_file());
    println!(
        "{}",
        json!({
            "mode": config.mode,
            "queue_depth": queue.queue_depth().map_err(|_| "queue_unavailable")?,
            "queue_payload_bytes": queue.payload_bytes().map_err(|_| "queue_unavailable")?,
            "events_dropped": queue.dropped_count().map_err(|_| "queue_unavailable")?,
            "credential_present": credential_present,
            "agent_version": env!("CARGO_PKG_VERSION"),
        })
    );
    Ok(())
}

fn doctor(config: &Config) -> Result<(), &'static str> {
    let queue = queue::Queue::open(&config.collector.queue_path, config.collector.queue_max_mb)
        .map_err(|_| "queue_unavailable")?;
    let mut checks = vec![
        json!({"check":"config","status":"ok"}),
        json!({"check":"queue","status":"ok","depth":queue.queue_depth().map_err(|_| "queue_unavailable")?,"payload_bytes":queue.payload_bytes().map_err(|_| "queue_unavailable")?}),
        json!({"check":"systemd_journal","status":if journal_accessible() {"ok"} else {"unavailable"}}),
        json!({"check":"docker","status":if config.sources.docker { if sources::source_available("docker") {"accessible"} else {"unavailable"} } else {"disabled; Docker access is root-equivalent"}}),
        json!({"check":"nginx_source","status":if config.sources.nginx {"not_implemented"} else {"disabled"}}),
        json!({"check":"postgres_source","status":if config.sources.postgres {"not_implemented"} else {"disabled"}}),
        json!({"check":"credential_file","status":if std::fs::symlink_metadata(&config.server.credential_file).is_ok() {"present"} else if config.mode == Mode::Connected {"will_enroll_on_first_delivery"} else {"not_required"}}),
        json!({"check":"clock_sync","status":clock_sync_status()}),
    ];
    if config.mode == Mode::Connected {
        let api = client::ApiClient::new(config).map_err(|_| "server_configuration_invalid")?;
        checks.push(json!({"check":"server","status":match api.health() {Ok(true)=>"ready",Ok(false)=>"unavailable",Err(_)=>"unreachable"}}));
        if !std::fs::symlink_metadata(&config.server.enrollment_token_file).is_ok() {
            checks.push(json!({"check":"enrollment_token_file","status":"missing"}));
        } else {
            checks.push(json!({"check":"enrollment_token_file","status":"present"}));
        }
    } else {
        checks.push(json!({"check":"server","status":"not_used_in_current_mode"}));
    }
    if !config.watch.files.is_empty() {
        checks.push(json!({"check":"configured_file_watch","status":"not_implemented"}));
    }
    println!("{}", json!({"checks": checks}));
    Ok(())
}

fn test_source(config: &Config, name: &str) -> Result<(), &'static str> {
    let available = match name {
        "systemd" => journal_accessible(),
        "docker" => sources::source_available("docker"),
        "nginx" => config.watch.files.iter().any(|path| path.exists()),
        "postgres" => false,
        _ => return Err("unknown_source"),
    };
    println!(
        "{}",
        json!({"source":name,"status":if available {"available"} else {"unavailable"}})
    );
    if available {
        Ok(())
    } else {
        Err("source_unavailable")
    }
}

fn test_redaction() -> Result<(), &'static str> {
    let fixture = concat!(
        "password=hunter2 Authorization: Bearer fake_token ",
        "postgres://fakeuser:fakepass@example/db fake@example.com ",
        "-----BEGIN PRIVATE KEY-----fake-key-----END PRIVATE KEY-----"
    );
    let (redacted, fields) = redaction::redact_text(fixture, &config::RedactionConfig::default());
    println!(
        "{}",
        json!({"redacted_fixture":redacted,"rules_applied":fields})
    );
    Ok(())
}

fn run(config: Config) -> Result<(), &'static str> {
    let mut queue = if config.mode == Mode::DryRun {
        None
    } else {
        Some(
            queue::Queue::open(&config.collector.queue_path, config.collector.queue_max_mb)
                .map_err(|_| "queue_unavailable")?,
        )
    };
    let api = if config.mode == Mode::Connected {
        Some(client::ApiClient::new(&config).map_err(|_| "server_configuration_invalid")?)
    } else {
        None
    };
    let (sender, receiver) = mpsc::channel();
    if config.sources.systemd {
        sources::start_systemd(sender.clone(), config.sources.systemd_units.clone());
    }
    if config.sources.docker {
        sources::start_docker(sender.clone());
    }

    if config.sources.nginx || config.sources.postgres || !config.watch.files.is_empty() {
        eprintln!("{{\"event\":\"agent.source.not_implemented\"}}");
    }
    eprintln!(
        "{{\"event\":\"agent.started\",\"mode\":\"{}\"}}",
        mode_name(config.mode)
    );
    let started = agent_started_event();
    receive_event(started, &config, &mut queue)?;

    let mut next_delivery = Instant::now();
    let mut retry_delay = Duration::from_secs(5);
    loop {
        match receiver.recv_timeout(Duration::from_millis(500)) {
            Ok(event) => receive_event(event, &config, &mut queue)?,
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return Err("source_threads_stopped"),
        }

        if let Some(local_queue) = queue.as_mut() {
            emit_dropped_counter(local_queue, &config)?;
        }

        if config.mode != Mode::Connected || Instant::now() < next_delivery {
            continue;
        }
        let local_queue = queue.as_mut().ok_or("queue_unavailable")?;
        if local_queue.queue_depth().map_err(|_| "queue_unavailable")? == 0 {
            continue;
        }
        let batch = local_queue
            .batch(config.collector.batch_max_events)
            .map_err(|_| "queue_unavailable")?;
        if batch.is_empty() {
            continue;
        }
        let ids = batch
            .iter()
            .map(|event| event.event_id.clone())
            .collect::<Vec<_>>();
        let delivery_result = api
            .as_ref()
            .ok_or("server_configuration_invalid")?
            .credential()
            .and_then(|credential| {
                api.as_ref()
                    .expect("connected mode creates API client")
                    .send_batch(&credential, &batch)
            });
        match delivery_result {
            Ok(()) => {
                local_queue
                    .acknowledge(&ids)
                    .map_err(|_| "queue_unavailable")?;
                retry_delay = Duration::from_secs(5);
                next_delivery = Instant::now();
                if local_queue
                    .delivery_failed_reported()
                    .map_err(|_| "queue_unavailable")?
                {
                    let recovered = collector_event(
                        "collector.delivery_recovered",
                        "info",
                        "recovery",
                        "Collector delivery recovered",
                        BTreeMap::new(),
                    );
                    if enqueue_event(local_queue, recovered, &config)? {
                        local_queue
                            .set_delivery_failed_reported(false)
                            .map_err(|_| "queue_unavailable")?;
                    }
                }
            }
            Err(_) => {
                local_queue
                    .mark_failed(&ids)
                    .map_err(|_| "queue_unavailable")?;
                if !local_queue
                    .delivery_failed_reported()
                    .map_err(|_| "queue_unavailable")?
                {
                    let failed = collector_event(
                        "collector.delivery_failed",
                        "warning",
                        "failure",
                        "Collector could not deliver queued events",
                        BTreeMap::new(),
                    );
                    if enqueue_event(local_queue, failed, &config)? {
                        local_queue
                            .set_delivery_failed_reported(true)
                            .map_err(|_| "queue_unavailable")?;
                    }
                }
                let jitter_ms = (Uuid::new_v4().as_u128() % 1000) as u64;
                next_delivery = Instant::now() + retry_delay + Duration::from_millis(jitter_ms);
                retry_delay = (retry_delay * 2).min(Duration::from_secs(300));
                eprintln!("{{\"event\":\"collector.delivery.retry_scheduled\"}}");
            }
        }
    }
}

fn receive_event(
    mut event: OperationalEvent,
    config: &Config,
    queue: &mut Option<queue::Queue>,
) -> Result<(), &'static str> {
    let redacted_fields = match redaction::redact_event(&mut event, &config.redaction) {
        Ok(fields) => fields,
        Err(_) => {
            eprintln!("{{\"event\":\"collector.redaction.failed\"}}");
            return Ok(());
        }
    };
    if config.mode == Mode::DryRun {
        let output = json!({"event":event,"redacted_fields":redacted_fields});
        println!("{}", output);
        return Ok(());
    }
    let local_queue = queue.as_mut().ok_or("queue_unavailable")?;
    if !local_queue
        .enqueue(&event)
        .map_err(|_| "queue_unavailable")?
    {
        // Queue::enqueue records the overflow count durably.
    }
    Ok(())
}

fn enqueue_event(
    queue: &mut queue::Queue,
    event: OperationalEvent,
    config: &Config,
) -> Result<bool, &'static str> {
    let mut event = event;
    if redaction::redact_event(&mut event, &config.redaction).is_err() {
        eprintln!("{{\"event\":\"collector.redaction.failed\"}}");
        return Ok(false);
    }
    queue.enqueue(&event).map_err(|_| "queue_unavailable")
}

fn emit_dropped_counter(queue: &mut queue::Queue, config: &Config) -> Result<(), &'static str> {
    let dropped = queue.dropped_count().map_err(|_| "queue_unavailable")?;
    if dropped == 0
        || queue
            .payload_bytes()
            .map_err(|_| "queue_unavailable")?
            .saturating_add(4096)
            >= config.collector.queue_max_mb * 1024 * 1024
    {
        return Ok(());
    }
    let mut after = BTreeMap::new();
    after.insert("dropped_count".to_owned(), json!(dropped));
    let event = collector_event(
        "collector.events_dropped",
        "error",
        "anomaly",
        "Collector local queue overflowed",
        after,
    );
    if enqueue_event(queue, event, config)? {
        queue
            .reset_dropped_count()
            .map_err(|_| "queue_unavailable")?;
    }
    Ok(())
}

fn agent_started_event() -> OperationalEvent {
    let hostname =
        std::fs::read_to_string("/etc/hostname").unwrap_or_else(|_| "unknown-host".to_owned());
    let mut attributes = BTreeMap::new();
    attributes.insert("agent_version".to_owned(), json!(env!("CARGO_PKG_VERSION")));
    collector_event(
        "collector.agent_started",
        "info",
        "start",
        "IncidentAtlas collector started",
        attributes,
    )
    .with_resource_name(hostname.trim())
}

fn collector_event(
    event_type: &str,
    severity: &str,
    change: &str,
    summary: &str,
    after: BTreeMap<String, serde_json::Value>,
) -> OperationalEvent {
    OperationalEvent::new(
        "collector",
        "collector",
        event_type,
        severity,
        change,
        Resource {
            resource_type: "collector".to_owned(),
            id: "local".to_owned(),
            name: None,
        },
        summary.to_owned(),
        model::now_rfc3339(),
        BTreeMap::new(),
        after,
        BTreeMap::new(),
    )
}

trait EventResourceName {
    fn with_resource_name(self, name: &str) -> Self;
}

impl EventResourceName for OperationalEvent {
    fn with_resource_name(mut self, name: &str) -> Self {
        if !name.is_empty() && name.len() <= 253 && !name.chars().any(char::is_control) {
            self.resource.id = name.to_owned();
            self.resource.name = Some(name.to_owned());
        }
        self
    }
}

fn mode_name(mode: Mode) -> &'static str {
    match mode {
        Mode::DryRun => "dry-run",
        Mode::Local => "local",
        Mode::Connected => "connected",
    }
}

fn journal_accessible() -> bool {
    Command::new("journalctl")
        .args(["--quiet", "--lines=0", "--no-pager"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

fn clock_sync_status() -> &'static str {
    Command::new("timedatectl")
        .args(["show", "-p", "NTPSynchronized", "--value"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .map(|value| {
            if value == "yes" {
                "synchronized"
            } else {
                "not_synchronized"
            }
        })
        .unwrap_or("unknown")
}
