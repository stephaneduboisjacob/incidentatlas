use std::sync::OnceLock;

use regex::Regex;
use serde_json::Value;

use crate::config::RedactionConfig;
use crate::model::OperationalEvent;

static RULES: OnceLock<Vec<(&'static str, Regex, &'static str)>> = OnceLock::new();

fn rules() -> &'static [(&'static str, Regex, &'static str)] {
    RULES.get_or_init(|| {
        [
            ("private_key", r"(?s)-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?-----END [A-Z0-9 ]*PRIVATE KEY-----", "[REDACTED:PRIVATE_KEY]"),
            ("database_password", r"(?i)(postgres(?:ql)?://[^:/@\s]+:)[^@/\s]+(@)", "$1[REDACTED]$2"),
            ("bearer_token", r"(?i)(authorization\s*:\s*bearer\s+)[A-Za-z0-9._~+/-]+=*", "$1[REDACTED:BEARER]"),
            ("password_or_token", r#"(?i)((?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["']?)[^\s"'&,;]+"#, "$1[REDACTED:SECRET]"),
            ("jwt", r"\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b", "[REDACTED:JWT]"),
            ("github_token", r"\bgh[pousr]_[A-Za-z0-9_]{20,}\b", "[REDACTED:GITHUB_TOKEN]"),
            ("aws_access_key", r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b", "[REDACTED:AWS_KEY]"),
            ("cookie", r"(?i)((?:set-cookie|cookie)\s*:\s*)[^;\s]+", "$1[REDACTED:COOKIE]"),
        ]
        .into_iter()
        .map(|(name, pattern, replacement)| (name, Regex::new(pattern).expect("static redaction regex is valid"), replacement))
        .collect()
    })
}

pub fn redact_text(input: &str, config: &RedactionConfig) -> (String, Vec<String>) {
    let mut output = input.to_owned();
    let mut changed = Vec::new();
    for (name, regex, replacement) in rules() {
        let next = regex.replace_all(&output, *replacement).into_owned();
        if next != output {
            output = next;
            changed.push((*name).to_owned());
        }
    }
    if config.redact_email_addresses {
        let regex = Regex::new(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b")
            .expect("static email regex is valid");
        let next = regex.replace_all(&output, "[REDACTED:EMAIL]").into_owned();
        if next != output {
            output = next;
            changed.push("email".to_owned());
        }
    }
    if config.redact_ip_addresses {
        let regex = Regex::new(r"\b(?:\d{1,3}\.){3}\d{1,3}\b").expect("static IPv4 regex is valid");
        let next = regex.replace_all(&output, "[REDACTED:IP]").into_owned();
        if next != output {
            output = next;
            changed.push("ip_address".to_owned());
        }
    }
    for pattern in &config.custom_patterns {
        let Ok(regex) = Regex::new(&pattern.regex) else {
            continue;
        };
        let next = regex
            .replace_all(&output, pattern.replacement.as_str())
            .into_owned();
        if next != output {
            output = next;
            changed.push(format!("custom:{}", pattern.name));
        }
    }
    (output, changed)
}

pub fn redact_event(
    event: &mut OperationalEvent,
    config: &RedactionConfig,
) -> Result<Vec<String>, serde_json::Error> {
    let serialized = serde_json::to_string(event)?;
    let (redacted, changed) = redact_text(&serialized, config);
    let mut value: Value = serde_json::from_str(&redacted)?;
    let ruleset = if config.preset == "strict" {
        "strict-v1"
    } else {
        "credentials-v1"
    };
    if let Some(privacy) = value.get_mut("privacy") {
        privacy["redaction_applied"] = Value::Bool(true);
        privacy["redaction_ruleset"] = Value::String(ruleset.to_owned());
    }
    *event = serde_json::from_value(value)?;
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strict_config() -> RedactionConfig {
        RedactionConfig::default()
    }

    #[test]
    fn removes_fake_credentials_and_private_keys() {
        let input = concat!(
            "password=hunter2 Authorization: Bearer fake_token_value ",
            "postgres://fakeuser:fakepass@example/db fake@example.com ",
            "-----BEGIN PRIVATE KEY-----\nfake-key-material\n-----END PRIVATE KEY-----"
        );
        let (output, changed) = redact_text(input, &strict_config());
        assert!(!output.contains("hunter2"));
        assert!(!output.contains("fake_token_value"));
        assert!(!output.contains("fakepass"));
        assert!(!output.contains("fake@example.com"));
        assert!(!output.contains("fake-key-material"));
        assert!(changed.len() >= 5);
    }

    #[test]
    fn recognizes_jwt_github_and_aws_style_tokens() {
        let input = "ghp_123456789012345678901234567890123456 AKIAABCDEFGHIJKLMNOP abcdefghij.abcdefghij.abcdefghij";
        let (output, _) = redact_text(input, &strict_config());
        assert!(!output.contains("ghp_"));
        assert!(!output.contains("AKIA"));
        assert!(!output.contains("abcdefghij.abcdefghij"));
    }
}
