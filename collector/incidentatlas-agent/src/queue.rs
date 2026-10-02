use std::fs::{self, OpenOptions};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};
use thiserror::Error;

use crate::model::OperationalEvent;

#[derive(Debug, Error)]
pub enum QueueError {
    #[error("local queue filesystem operation failed")]
    Io(#[from] std::io::Error),
    #[error("local queue database operation failed")]
    Sqlite(#[from] rusqlite::Error),
    #[error("event serialization failed")]
    Json(#[from] serde_json::Error),
}

pub struct Queue {
    connection: Connection,
    max_payload_bytes: u64,
}

impl Queue {
    pub fn open(path: &Path, max_mb: u64) -> Result<Self, QueueError> {
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
                "queue parent must be a directory",
            )
            .into());
        }
        if !parent_existed {
            fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?;
        }
        if fs::symlink_metadata(path).is_ok_and(|metadata| {
            !metadata.file_type().is_file() || metadata.file_type().is_symlink()
        }) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "queue path must be a regular file",
            )
            .into());
        }
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .mode(0o600)
            .open(path)?;
        file.set_permissions(fs::Permissions::from_mode(0o600))?;
        drop(file);

        let connection = Connection::open(path)?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "FULL")?;
        connection.pragma_update(None, "journal_size_limit", 4 * 1024 * 1024_i64)?;
        let max_page_count = ((max_mb.saturating_mul(1024 * 1024) / 4096).max(4096)) as i64;
        connection.pragma_update(None, "max_page_count", max_page_count)?;
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS queue_events (
               event_id TEXT PRIMARY KEY,
               occurred_at TEXT NOT NULL,
               payload TEXT NOT NULL,
               queued_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
               attempts INTEGER NOT NULL DEFAULT 0
             );
             CREATE INDEX IF NOT EXISTS queue_events_fifo_idx ON queue_events (queued_at, event_id);
             CREATE TABLE IF NOT EXISTS queue_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )?;
        Ok(Self {
            connection,
            max_payload_bytes: max_mb.saturating_mul(1024 * 1024),
        })
    }

    pub fn enqueue(&mut self, event: &OperationalEvent) -> Result<bool, QueueError> {
        if self
            .connection
            .query_row(
                "SELECT 1 FROM queue_events WHERE event_id = ?1",
                [&event.event_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some()
        {
            return Ok(false);
        }
        let payload = serde_json::to_string(event)?;
        let current_bytes: i64 = self.connection.query_row(
            "SELECT COALESCE(SUM(length(payload)), 0) FROM queue_events",
            [],
            |row| row.get(0),
        )?;
        if u64::try_from(current_bytes)
            .unwrap_or(u64::MAX)
            .saturating_add(payload.len() as u64)
            > self.max_payload_bytes
        {
            self.increment_meta("events_dropped", 1)?;
            return Ok(false);
        }
        let inserted = self.connection.execute(
            "INSERT OR IGNORE INTO queue_events (event_id, occurred_at, payload) VALUES (?1, ?2, ?3)",
            params![event.event_id, event.occurred_at, payload],
        )?;
        Ok(inserted == 1)
    }

    pub fn batch(&self, limit: usize) -> Result<Vec<OperationalEvent>, QueueError> {
        let mut statement = self
            .connection
            .prepare("SELECT payload FROM queue_events ORDER BY queued_at, rowid LIMIT ?1")?;
        let rows = statement.query_map([limit as i64], |row| row.get::<_, String>(0))?;
        rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
    }

    pub fn acknowledge(&mut self, event_ids: &[String]) -> Result<(), QueueError> {
        let transaction = self.connection.transaction()?;
        for id in event_ids {
            transaction.execute("DELETE FROM queue_events WHERE event_id = ?1", [id])?;
        }
        transaction.commit()?;
        self.connection
            .execute_batch("PRAGMA wal_checkpoint(PASSIVE)")?;
        Ok(())
    }

    pub fn mark_failed(&mut self, event_ids: &[String]) -> Result<(), QueueError> {
        let transaction = self.connection.transaction()?;
        for id in event_ids {
            transaction.execute(
                "UPDATE queue_events SET attempts = attempts + 1 WHERE event_id = ?1",
                [id],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn queue_depth(&self) -> Result<u64, QueueError> {
        let value: i64 =
            self.connection
                .query_row("SELECT count(*) FROM queue_events", [], |row| row.get(0))?;
        Ok(u64::try_from(value).unwrap_or(0))
    }

    pub fn payload_bytes(&self) -> Result<u64, QueueError> {
        let value: i64 = self.connection.query_row(
            "SELECT COALESCE(SUM(length(payload)), 0) FROM queue_events",
            [],
            |row| row.get(0),
        )?;
        Ok(u64::try_from(value).unwrap_or(u64::MAX))
    }

    pub fn dropped_count(&self) -> Result<u64, QueueError> {
        self.meta("events_dropped")
    }

    pub fn reset_dropped_count(&mut self) -> Result<(), QueueError> {
        self.connection.execute("INSERT INTO queue_meta (key, value) VALUES ('events_dropped', '0') ON CONFLICT(key) DO UPDATE SET value = '0'", [])?;
        Ok(())
    }

    pub fn delivery_failed_reported(&self) -> Result<bool, QueueError> {
        Ok(self.meta("delivery_failed")? > 0)
    }

    pub fn set_delivery_failed_reported(&mut self, value: bool) -> Result<(), QueueError> {
        self.connection.execute(
            "INSERT INTO queue_meta (key, value) VALUES ('delivery_failed', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [if value { "1" } else { "0" }],
        )?;
        Ok(())
    }

    fn meta(&self, key: &str) -> Result<u64, QueueError> {
        let value = self
            .connection
            .query_row(
                "SELECT value FROM queue_meta WHERE key = ?1",
                [key],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(value
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(0))
    }

    fn increment_meta(&self, key: &str, amount: u64) -> Result<(), QueueError> {
        self.connection.execute(
            "INSERT INTO queue_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + CAST(excluded.value AS INTEGER) AS TEXT)",
            params![key, amount.to_string()],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde_json::json;
    use uuid::Uuid;

    use super::*;
    use crate::model::{OperationalEvent, Resource};

    fn temporary_queue_path() -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "incidentatlas-test-{}-{}.sqlite3",
            std::process::id(),
            Uuid::new_v4()
        ))
    }

    fn event(summary: String) -> OperationalEvent {
        OperationalEvent::new(
            "systemd",
            "process",
            "systemd.service_state_changed",
            "info",
            "start",
            Resource {
                resource_type: "service".to_owned(),
                id: "demo.service".to_owned(),
                name: Some("demo".to_owned()),
            },
            summary,
            crate::model::now_rfc3339(),
            BTreeMap::new(),
            BTreeMap::from([("state".to_owned(), json!("active"))]),
            BTreeMap::new(),
        )
    }

    fn cleanup(path: &Path) {
        let _ = fs::remove_file(path);
        let _ = fs::remove_file(path.with_extension("sqlite3-wal"));
        let _ = fs::remove_file(path.with_extension("sqlite3-shm"));
    }

    #[test]
    fn queue_is_fifo_deduplicated_and_acknowledged() {
        let path = temporary_queue_path();
        let mut queue = Queue::open(&path, 16).expect("queue opens");
        let first = event("first".to_owned());
        let second = event("second".to_owned());
        assert!(queue.enqueue(&first).expect("first event enqueued"));
        assert!(!queue.enqueue(&first).expect("duplicate event ignored"));
        assert!(queue.enqueue(&second).expect("second event enqueued"));
        let batch = queue.batch(2).expect("batch reads");
        assert_eq!(batch.len(), 2);
        assert_eq!(batch[0].summary, "first");
        assert_eq!(batch[1].summary, "second");
        queue
            .acknowledge(&[first.event_id])
            .expect("delivery acknowledged");
        assert_eq!(queue.queue_depth().expect("depth reads"), 1);
        drop(queue);
        cleanup(&path);
    }

    #[test]
    fn queue_overflow_is_counted_instead_of_silently_dropped() {
        let path = temporary_queue_path();
        let mut queue = Queue::open(&path, 16).expect("queue opens");
        let oversized = event("x".repeat(16 * 1024 * 1024));
        assert!(!queue.enqueue(&oversized).expect("overflow is handled"));
        assert_eq!(queue.dropped_count().expect("drop count reads"), 1);
        drop(queue);
        cleanup(&path);
    }
}
