use std::collections::BTreeMap;

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OperationalEvent {
    pub schema_version: u8,
    pub event_id: String,
    pub occurred_at: String,
    pub observed_at: String,
    pub source: String,
    pub category: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub severity: String,
    pub change_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor: Option<Actor>,
    pub resource: Resource,
    pub summary: String,
    pub before: BTreeMap<String, Value>,
    pub after: BTreeMap<String, Value>,
    pub attributes: BTreeMap<String, Value>,
    pub evidence: Vec<EvidenceReference>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correlation: Option<Correlation>,
    pub privacy: Privacy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Actor {
    #[serde(rename = "type")]
    pub actor_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Resource {
    #[serde(rename = "type")]
    pub resource_type: String,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceReference {
    pub artifact_id: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Correlation {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Privacy {
    pub redaction_applied: bool,
    pub redaction_ruleset: String,
}

#[derive(Debug, Serialize)]
pub struct EventBatch<'a> {
    pub schema_version: u8,
    pub events: &'a [OperationalEvent],
}

impl OperationalEvent {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        source: &str,
        category: &str,
        event_type: &str,
        severity: &str,
        change_kind: &str,
        resource: Resource,
        summary: String,
        occurred_at: String,
        before: BTreeMap<String, Value>,
        after: BTreeMap<String, Value>,
        attributes: BTreeMap<String, Value>,
    ) -> Self {
        Self {
            schema_version: 1,
            event_id: Uuid::new_v4().to_string(),
            occurred_at,
            observed_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            source: source.to_owned(),
            category: category.to_owned(),
            event_type: event_type.to_owned(),
            severity: severity.to_owned(),
            change_kind: change_kind.to_owned(),
            actor: None,
            resource,
            summary,
            before,
            after,
            attributes,
            evidence: Vec::new(),
            correlation: None,
            privacy: Privacy {
                redaction_applied: false,
                redaction_ruleset: "pending".to_owned(),
            },
        }
    }
}

pub fn now_rfc3339() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
