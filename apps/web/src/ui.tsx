import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

type Host = { id: string; hostname: string; operating_system: string; last_seen_at: string; event_count: number };
type EvidenceScore = { score: number; relationship: string; factors: Array<{ key: string; points: number; explanation: string }> };
type EventRecord = {
  id: string;
  host_id: string;
  occurred_at: string;
  source: string;
  category: string;
  event_type: string;
  severity: string;
  change_kind: string;
  resource: { type: string; id: string; name?: string };
  summary: string;
  before_state: Record<string, unknown>;
  after_state: Record<string, unknown>;
  attributes: Record<string, unknown>;
  event_digest: string;
  correlation?: EvidenceScore;
};
type Incident = {
  id: string;
  title: string;
  status: string;
  severity: string;
  started_at: string;
  affected_services: string[];
};
type Hypothesis = {
  id: string;
  title: string;
  description: string;
  status: string;
  confidence: number;
  evidence: Array<{ event_id: string; relationship: string; explanation: string; weight: number }>;
};
type User = { id: string; email: string; display_name: string; role: string };
type RetentionPolicy = { event_days: number; artifact_days: number; audit_days: number; ai_generation_days: number; updated_at?: string };
type LegalHold = { id: string; incident_id: string | null; incident_title: string | null; reason: string; created_at: string; released_at: string | null; release_reason: string | null };

type ApiError = Error & { code?: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const code = ((payload.error as Record<string, unknown> | undefined)?.code as string | undefined) ?? "request_failed";
    const error = new Error(code) as ApiError;
    error.code = code;
    throw error;
  }
  return payload as T;
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value));
}

function shortTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

const severityTone: Record<string, string> = {
  critical: "critical",
  error: "critical",
  high: "critical",
  warning: "warning",
  medium: "warning",
  info: "quiet",
  low: "quiet",
};

export function IncidentAtlas(): React.JSX.Element {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User>();
  const [csrf, setCsrf] = useState("");
  const [setupAvailable, setSetupAvailable] = useState(false);
  const [initialized, setInitialized] = useState(true);
  const [authError, setAuthError] = useState("");
  const [hosts, setHosts] = useState<Host[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([]);
  const [selectedHost, setSelectedHost] = useState("");
  const [selectedIncident, setSelectedIncident] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<EventRecord>();
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [errorMessage, setErrorMessage] = useState("");
  const [note, setNote] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "setup">("login");
  const [busy, setBusy] = useState(false);
  const [activePage, setActivePage] = useState<"overview" | "settings">("overview");
  const [retentionPolicy, setRetentionPolicy] = useState<RetentionPolicy>();
  const [legalHolds, setLegalHolds] = useState<LegalHold[]>([]);

  const loadWorkspace = useCallback(async (incidentId?: string) => {
    const [hostResult, incidentResult, eventResult] = await Promise.all([
      api<{ hosts: Host[] }>("/api/v1/hosts"),
      api<{ incidents: Incident[] }>("/api/v1/incidents"),
      api<{ events: EventRecord[] }>("/api/v1/events?limit=200"),
    ]);
    setHosts(hostResult.hosts);
    setIncidents(incidentResult.incidents);
    setEvents(eventResult.events);
    if (incidentId) {
      const result = await api<{ incident: Incident; events: EventRecord[] }>(`/api/v1/incidents/${incidentId}/timeline`);
      setEvents(result.events);
      const hypothesisResult = await api<{ hypotheses: Hypothesis[] }>(`/api/v1/incidents/${incidentId}/hypotheses`);
      setHypotheses(hypothesisResult.hypotheses);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const status = await api<{ initialized: boolean; setup_available: boolean }>("/api/v1/auth/status");
        setInitialized(status.initialized);
        setSetupAvailable(status.setup_available);
        if (!status.initialized) setAuthMode("setup");
        if (status.initialized) {
          try {
            const result = await api<{ user: User; csrf_token: string }>("/api/v1/auth/me");
            setUser(result.user);
            setCsrf(result.csrf_token);
            await loadWorkspace();
          } catch {
            setUser(undefined);
          }
        }
      } catch {
        setAuthError("IncidentAtlas API is unavailable. Check the server and database health.");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadWorkspace]);

  const visibleEvents = useMemo(() => events
    .filter((event) => !selectedHost || event.host_id === selectedHost)
    .filter((event) => categoryFilter === "all" || event.category === categoryFilter)
    .slice()
    .sort((left, right) => Date.parse(left.occurred_at) - Date.parse(right.occurred_at)), [events, selectedHost, categoryFilter]);

  async function submitAuth(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setAuthError("");
    const form = new FormData(event.currentTarget);
    const body = authMode === "setup"
      ? {
          setup_token: String(form.get("setup_token") ?? ""),
          organization_name: String(form.get("organization_name") ?? ""),
          email: String(form.get("email") ?? ""),
          display_name: String(form.get("display_name") ?? ""),
          password: String(form.get("password") ?? ""),
        }
      : { email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") };
    try {
      const result = await api<{ user: User; csrf_token: string }>(`/api/v1/auth/${authMode}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      setUser(result.user);
      setCsrf(result.csrf_token);
      await loadWorkspace();
    } catch (caught) {
      setAuthError((caught as ApiError).code ?? "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }

  async function createIncident(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const result = await api<{ incident: Incident }>("/api/v1/incidents", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({
          title: form.get("title"),
          started_at: new Date(String(form.get("started_at"))).toISOString(),
          severity: form.get("severity"),
          affected_services: String(form.get("affected_services") ?? "").split(",").map((value) => value.trim()).filter(Boolean),
        }),
      });
      setSelectedIncident(result.incident.id);
      await loadWorkspace(result.incident.id);
    } catch (caught) {
      setErrorMessage((caught as ApiError).code ?? "Incident creation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function selectIncident(id: string): Promise<void> {
    setSelectedIncident(id);
    if (!id) {
      setHypotheses([]);
      const result = await api<{ events: EventRecord[] }>("/api/v1/events?limit=200");
      setEvents(result.events);
      return;
    }
    try {
      const [timeline, candidateResult] = await Promise.all([
        api<{ events: EventRecord[] }>(`/api/v1/incidents/${id}/timeline`),
        api<{ hypotheses: Hypothesis[] }>(`/api/v1/incidents/${id}/hypotheses`),
      ]);
      setEvents(timeline.events);
      setHypotheses(candidateResult.hypotheses);
    } catch (caught) {
      setErrorMessage((caught as ApiError).code ?? "Timeline could not be loaded.");
    }
  }

  async function generateHypotheses(): Promise<void> {
    if (!selectedIncident) return;
    setBusy(true);
    try {
      await api(`/api/v1/incidents/${selectedIncident}/hypotheses/generate`, {
        method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: "{}",
      });
      const result = await api<{ hypotheses: Hypothesis[] }>(`/api/v1/incidents/${selectedIncident}/hypotheses`);
      setHypotheses(result.hypotheses);
    } catch (caught) {
      setErrorMessage((caught as ApiError).code ?? "Correlation could not be generated.");
    } finally {
      setBusy(false);
    }
  }

  async function downloadPostmortem(): Promise<void> {
    if (!selectedIncident) return;
    setBusy(true);
    try {
      const result = await api<{ markdown: string }>(`/api/v1/incidents/${selectedIncident}/postmortem`, {
        method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: "{}",
      });
      const fileUrl = URL.createObjectURL(new Blob([result.markdown], { type: "text/markdown;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = fileUrl;
      link.download = `incidentatlas-${selectedIncident}-postmortem.md`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(fileUrl), 1_000);
    } catch (caught) {
      setErrorMessage((caught as ApiError).code ?? "Postmortem draft could not be generated.");
    } finally {
      setBusy(false);
    }
  }

  async function updateHypothesis(hypothesisId: string, status: string): Promise<void> {
    if (!selectedIncident) return;
    try {
      await api(`/api/v1/incidents/${selectedIncident}/hypotheses/${hypothesisId}/feedback`, {
        method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ status }),
      });
      const result = await api<{ hypotheses: Hypothesis[] }>(`/api/v1/incidents/${selectedIncident}/hypotheses`);
      setHypotheses(result.hypotheses);
    } catch (caught) {
      setErrorMessage((caught as ApiError).code ?? "Feedback could not be saved.");
    }
  }

  async function addAnnotation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedIncident || !note.trim()) return;
    try {
      await api(`/api/v1/incidents/${selectedIncident}/annotations`, {
        method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ body: note, ...(selectedEvent ? { event_id: selectedEvent.id } : {}) }),
      });
      setNote("");
      setErrorMessage("");
    } catch (caught) {
      setErrorMessage((caught as ApiError).code ?? "Annotation could not be saved.");
    }
  }

  async function logout(): Promise<void> {
    try {
      await api("/api/v1/auth/logout", { method: "POST", headers: { "x-csrf-token": csrf } });
    } finally {
      setUser(undefined);
      setCsrf("");
    }
  }

  async function loadRetentionSettings(): Promise<void> {
    const [policyResult, holdsResult] = await Promise.all([
      api<{ policy: RetentionPolicy }>("/api/v1/settings/retention"),
      api<{ legal_holds: LegalHold[] }>("/api/v1/legal-holds"),
    ]);
    setRetentionPolicy(policyResult.policy);
    setLegalHolds(holdsResult.legal_holds);
  }

  async function saveRetention(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const policy = {
      event_days: Number(form.get("event_days")),
      artifact_days: Number(form.get("artifact_days")),
      audit_days: Number(form.get("audit_days")),
      ai_generation_days: Number(form.get("ai_generation_days")),
      confirm_immediate_expiry: false,
    };
    setBusy(true);
    try {
      try {
        await api("/api/v1/settings/retention", {
          method: "PUT", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify(policy),
        });
      } catch (caught) {
        if ((caught as ApiError).code !== "retention_reduction_confirmation_required") throw caught;
        const confirmed = window.confirm("Shorter retention will immediately delete evidence older than the new limits, except evidence under a legal hold. Continue?");
        if (!confirmed) return;
        await api("/api/v1/settings/retention", {
          method: "PUT", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ ...policy, confirm_immediate_expiry: true }),
        });
      }
      await loadRetentionSettings();
    } catch (caught) {
      setErrorMessage((caught as ApiError).code ?? "Retention policy could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function createLegalHold(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const incidentId = String(form.get("incident_id") ?? "");
    setBusy(true);
    try {
      await api("/api/v1/legal-holds", {
        method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ ...(incidentId ? { incident_id: incidentId } : {}), reason: form.get("reason") }),
      });
      formElement.reset();
      await loadRetentionSettings();
    } catch (caught) {
      setErrorMessage((caught as ApiError).code ?? "Legal hold could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function releaseLegalHold(hold: LegalHold): Promise<void> {
    if (!window.confirm("Release this legal hold? Retention may then remove the covered evidence.")) return;
    const reason = window.prompt("Reason for releasing this legal hold:");
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      await api(`/api/v1/legal-holds/${hold.id}/release`, {
        method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ reason }),
      });
      await loadRetentionSettings();
    } catch (caught) {
      setErrorMessage((caught as ApiError).code ?? "Legal hold could not be released.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="loading-screen">Opening the incident record…</div>;
  if (!user) {
    return <main className="auth-screen">
      <div className="auth-brand"><img className="brand-mark" src="/assets/incidentatlas/16-incidentatlas-app-mark-256.png" srcSet="/assets/incidentatlas/16-incidentatlas-app-mark-256.png 256w, /assets/incidentatlas/16-incidentatlas-app-mark-512.png 512w, /assets/incidentatlas/16-incidentatlas-app-mark-1024.png 1024w" sizes="36px" alt="" /><span>Incident<span>Atlas</span></span></div>
      <section className="auth-card">
        <div className="eyebrow">OPERATIONAL CHANGE RECORDER</div>
        <h1>{initialized ? "Welcome back" : "Create your workspace"}</h1>
        <p className="muted">Reconstruct the changes around an incident, with evidence attached.</p>
        {!initialized && !setupAvailable ? <div className="callout">Initial setup is disabled. Configure the server setup token to create the first account.</div> : <form onSubmit={submitAuth} className="stack-form">
          {!initialized && <>
            <label>One-time setup token<input name="setup_token" type="password" autoComplete="off" required /></label>
            <label>Organization<input name="organization_name" placeholder="Acme Operations" required /></label>
            <label>Your name<input name="display_name" autoComplete="name" required /></label>
          </>}
          <label>Email<input name="email" type="email" autoComplete="username" required /></label>
          <label>Password<input name="password" type="password" autoComplete={initialized ? "current-password" : "new-password"} minLength={initialized ? 1 : 12} required /></label>
          {authError && <div className="error-text">{authError.replaceAll("_", " ")}</div>}
          <button className="button primary full" disabled={busy}>{busy ? "Please wait…" : initialized ? "Sign in" : "Create account"}</button>
        </form>}
        {initialized && <button className="text-button auth-switch" onClick={() => setAuthMode(authMode === "login" ? "setup" : "login")}>First time here? Check setup status</button>}
      </section>
      <p className="auth-foot">Your operational evidence stays in your IncidentAtlas installation.</p>
    </main>;
  }

  const activeIncident = incidents.find((incident) => incident.id === selectedIncident);

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><img className="brand-mark" src="/assets/incidentatlas/16-incidentatlas-app-mark-256.png" srcSet="/assets/incidentatlas/16-incidentatlas-app-mark-256.png 256w, /assets/incidentatlas/16-incidentatlas-app-mark-512.png 512w, /assets/incidentatlas/16-incidentatlas-app-mark-1024.png 1024w" sizes="32px" alt="" /><span>Incident<span>Atlas</span></span></div>
      <div className="workspace-switch"><span className="workspace-dot" />{user.display_name}<span className="chevron">⌄</span></div>
      <div className="side-label">INVESTIGATE</div>
      <button className={`nav-item ${activePage === "overview" ? "active" : ""}`} onClick={() => setActivePage("overview")}><span className="nav-icon nav-icon-overview" aria-hidden="true" />Overview</button>
      <button className="nav-item" onClick={() => { setActivePage("overview"); setSelectedIncident(""); }}><span className="nav-icon nav-icon-timeline" aria-hidden="true" />Change timeline</button>
      <button className="nav-item" onClick={() => document.getElementById("incident-select")?.focus()}><span className="nav-icon nav-icon-incident" aria-hidden="true" />Incidents <span className="nav-count">{incidents.filter((item) => item.status !== "resolved" && item.status !== "closed").length}</span></button>
      <div className="side-label second">ENVIRONMENT</div>
      <button className="nav-item" onClick={() => setSelectedHost("")}><span className="nav-icon nav-icon-hosts" aria-hidden="true" />Hosts <span className="nav-count">{hosts.length}</span></button>
      <button className="nav-item" onClick={() => setErrorMessage("Collector enrollment and health controls are being implemented.")}><span className="nav-icon nav-icon-collector" aria-hidden="true" />Collectors</button>
      <div className="side-label second">ADMINISTRATION</div>
      <button className={`nav-item ${activePage === "settings" ? "active" : ""}`} onClick={() => { setActivePage("settings"); void loadRetentionSettings().catch((caught: unknown) => setErrorMessage((caught as ApiError).code ?? "Settings could not be loaded.")); }}><span className="nav-icon nav-icon-retention" aria-hidden="true" />Retention & holds</button>
      <div className="sidebar-bottom">
        <div className="collector-health"><span className="health-icon" aria-hidden="true" /><div><strong>{hosts.length} hosts reporting</strong><small>Collector status</small></div><span className="side-arrow">›</span></div>
        <div className="privacy-note"><span>◇</span><p>Redaction runs on the monitored host before events are sent.</p></div>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar">
        <div className="breadcrumbs"><span>Workspace</span><b>/</b><strong>{activeIncident ? activeIncident.title : "Overview"}</strong></div>
        <div className="top-actions"><span className="secure-label"><i /> Evidence store healthy</span><button className="icon-button" title="Help">?</button><button className="avatar" title={user.email}>{user.display_name.slice(0, 1).toUpperCase()}</button><button className="text-button" onClick={() => void logout()}>Sign out</button></div>
      </header>

      <div className="page-content">
        <section className={`page-heading ${activePage === "settings" ? "page-heading-settings" : activeIncident ? "page-heading-incident" : "page-heading-overview"}`}>
          <div className="page-heading-copy"><div className="eyebrow">{activePage === "settings" ? "DATA LIFECYCLE" : `INCIDENT RESPONSE · ${new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(new Date()).toUpperCase()}`}</div><h1>{activePage === "settings" ? "Retention and legal holds" : activeIncident ? activeIncident.title : "Operational overview"}</h1><p>{activePage === "settings" ? "Control how long operational evidence is retained and preserve investigations under legal hold." : activeIncident ? `Started ${displayDate(activeIncident.started_at)} · ${activeIncident.affected_services.join(", ") || "Services not specified"}` : "A concise record of what changed across your environment."}</p></div>
          {activePage === "overview" && <div className="heading-actions"><button className="button secondary" onClick={() => void loadWorkspace(selectedIncident || undefined)}>↻ <span>Refresh</span></button><button className="button primary" onClick={() => document.getElementById("new-incident-title")?.focus()}>＋ <span>Declare incident</span></button></div>}
        </section>

        {activePage === "overview" && <section className="metric-grid">
          <div className="metric-card"><div className="metric-top"><span>OPEN INCIDENTS</span><span className="metric-icon red">◉</span></div><strong>{incidents.filter((item) => !["resolved", "closed"].includes(item.status)).length.toString().padStart(2, "0")}</strong><small>{incidents.length ? "Across this workspace" : "No active investigations"}</small></div>
          <div className="metric-card"><div className="metric-top"><span>RECENT CHANGES</span><span className="metric-icon blue">⌁</span></div><strong>{events.length.toString().padStart(2, "0")}</strong><small>Events in the current view</small></div>
          <div className="metric-card hosts-metric"><img className="metric-art hosts-art" src="/assets/incidentatlas/09-host-fleet-field-map.webp" alt="" loading="lazy" /><div className="metric-top"><span>HOSTS REPORTING</span><span className="metric-icon green">⌂</span></div><strong>{hosts.length.toString().padStart(2, "0")}</strong><small>Last seen within 24 hours</small></div>
          <div className="metric-card health-metric"><img className="metric-art collector-art" src="/assets/incidentatlas/10-collector-queue-server.webp" alt="" loading="lazy" /><div className="metric-top"><span>INGESTION HEALTH</span><span className="health-dot" /></div><strong className="healthy-text">Healthy</strong><small>API and database connected</small></div>
        </section>}

        {errorMessage && <div className="notice" role="status"><span>{errorMessage.replaceAll("_", " ")}</span><button onClick={() => setErrorMessage("")}>×</button></div>}

        {activePage === "settings" ? <section className="settings-grid">
          <div className="panel settings-panel">
            <div className="panel-heading"><div><div className="panel-title">Retention policy</div><p>Days retained independently by evidence class</p></div></div>
            {retentionPolicy ? <form className="settings-form" onSubmit={saveRetention}>
              {([ ["event_days", "Operational events", "Normalized timeline records"], ["artifact_days", "Evidence artifacts", "Sanitized snapshots and diffs"], ["audit_days", "Audit history", "Administrative action records"], ["ai_generation_days", "AI generations", "Draft output and provenance"] ] as const).map(([name, label, description]) => <label key={name}>{label}<small>{description}</small><div><input name={name} type="number" min="1" max="3650" defaultValue={retentionPolicy[name]} required /><span>days</span></div></label>)}
              <p className="settings-help">Shortening a limit requires confirmation and queues cleanup. Each worker batch handles at most 100 records; active legal holds are preserved.</p>
              {user.role === "owner" || user.role === "admin" ? <button className="button primary" disabled={busy}>Save retention policy</button> : <p className="settings-help">An organization owner or admin can change these settings.</p>}
            </form> : <div className="settings-loading">Loading retention policy…</div>}
          </div>
          <div className="panel settings-panel">
            <div className="panel-heading"><div><div className="panel-title">Legal holds</div><p>Preserve all events or a selected incident window</p></div></div>
            {(user.role === "owner" || user.role === "admin") && <form className="settings-form" onSubmit={createLegalHold}>
              <label>Coverage<small>A global hold covers all organization evidence</small><select name="incident_id"><option value="">Entire organization</option>{incidents.map((incident) => <option key={incident.id} value={incident.id}>{incident.title}</option>)}</select></label>
              <label>Reason<small>Recorded in the audit history</small><textarea name="reason" rows={3} maxLength={2000} required placeholder="Why must this evidence be preserved?" /></label>
              <button className="button secondary" disabled={busy}>Enable legal hold</button>
            </form>}
            {!legalHolds.length ? <div className="settings-loading">No legal holds have been recorded.</div> : <div className="hold-list">{legalHolds.map((hold) => <article className="hold-item" key={hold.id}><div><strong>{hold.incident_title ?? "Entire organization"}</strong><small>{displayDate(hold.created_at)} · {hold.released_at ? `Released ${displayDate(hold.released_at)}` : "Active"}</small><p>{hold.reason}</p>{hold.release_reason && <small>Release reason: {hold.release_reason}</small>}</div>{!hold.released_at && (user.role === "owner" || user.role === "admin") && <button className="button secondary" disabled={busy} onClick={() => void releaseLegalHold(hold)}>Release</button>}</article>)}</div>}
          </div>
        </section> : <section className="investigation-grid">
          <div className="timeline-card panel">
            <div className="panel-heading"><div><div className="panel-title">Change timeline</div><p>{activeIncident ? "Changes in the incident window" : "Recent operational changes"}</p></div><div className="filter-row">
              <select id="incident-select" value={selectedIncident} onChange={(event) => void selectIncident(event.target.value)} aria-label="Incident window">
                <option value="">All recent events</option>{incidents.map((incident) => <option key={incident.id} value={incident.id}>{incident.title}</option>)}
              </select>
              <select value={selectedHost} onChange={(event) => setSelectedHost(event.target.value)} aria-label="Filter host"><option value="">All hosts</option>{hosts.map((host) => <option key={host.id} value={host.id}>{host.hostname}</option>)}</select>
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Filter category"><option value="all">All sources</option>{["deployment", "configuration", "process", "container", "database", "network", "authentication", "certificate", "resource", "security"].map((value) => <option key={value}>{value}</option>)}</select>
            </div></div>
            {visibleEvents.length === 0 ? <div className="empty-state"><img className="empty-state-art" src="/assets/incidentatlas/05-empty-incident-timeline.webp" alt="" /><strong>No changes in this view</strong><p>Enroll a collector to start recording operational changes.</p></div> : <div className="timeline-list">
              {visibleEvents.map((event, index) => <button className={`timeline-event ${selectedEvent?.id === event.id ? "selected" : ""}`} key={event.id} onClick={() => setSelectedEvent(event)}>
                <div className="timeline-time">{shortTime(event.occurred_at)}<small>{new Date(event.occurred_at).toLocaleDateString()}</small></div>
                <div className="timeline-rail"><span className={`event-dot ${severityTone[event.severity] ?? "quiet"}`} />{index < visibleEvents.length - 1 && <i />}</div>
                <div className="event-copy"><div className="event-tags"><span className={`tag ${event.category}`}>{event.category}</span><span className="tag source-tag">{event.source}</span><span className={`severity ${severityTone[event.severity] ?? "quiet"}`}>{event.severity}</span></div><strong>{event.summary}</strong><small>{event.resource.name ?? event.resource.id} <span>·</span> {hosts.find((host) => host.id === event.host_id)?.hostname ?? "Unknown host"}</small></div>
                {event.correlation && <div className="score-chip" title="Explainable correlation score">{event.correlation.score} pts</div>}
              </button>)}
            </div>}
            <div className="panel-footer"><span>Showing {visibleEvents.length} events</span><span>All times shown in local timezone</span></div>
          </div>

          <aside className="right-column">
            {selectedEvent ? <div className="panel evidence-panel">
              <div className="panel-heading"><div><div className="panel-title">Evidence detail</div><p>Source record and integrity</p></div><button className="close-button" onClick={() => setSelectedEvent(undefined)}>×</button></div>
              <div className="evidence-body">
                <div className="evidence-summary"><img className="evidence-art" src="/assets/incidentatlas/06-evidence-provenance-prism.webp" alt="" loading="lazy" /><span className={`tag ${selectedEvent.category}`}>{selectedEvent.category}</span><h3>{selectedEvent.summary}</h3><p>{displayDate(selectedEvent.occurred_at)}</p></div>
                <div className="detail-list"><div><span>Source</span><strong>{selectedEvent.source}</strong></div><div><span>Resource</span><strong>{selectedEvent.resource.name ?? selectedEvent.resource.id}</strong></div><div><span>Change</span><strong>{selectedEvent.change_kind}</strong></div><div><span>Severity</span><strong className={`text-${severityTone[selectedEvent.severity] ?? "quiet"}`}>{selectedEvent.severity}</strong></div></div>
                <div className="state-block"><div className="state-label">BEFORE</div><pre>{JSON.stringify(selectedEvent.before_state, null, 2)}</pre></div><div className="state-block"><div className="state-label">AFTER</div><pre>{JSON.stringify(selectedEvent.after_state, null, 2)}</pre></div>
                {selectedEvent.correlation && <div className="factor-block"><div className="state-label">WHY THIS EVENT IS RELEVANT</div>{selectedEvent.correlation.factors.map((factor) => <div className="factor" key={factor.key}><span className={factor.points ? "factor-plus" : "factor-zero"}>{factor.points ? `+${factor.points}` : "—"}</span><p>{factor.explanation}</p></div>)}</div>}
                <div className="digest-block"><span>SHA-256 EVENT DIGEST</span><code>{selectedEvent.event_digest}</code></div>
                {activeIncident && <form className="annotation-form" onSubmit={addAnnotation}><label htmlFor="event-note">Add an investigation note</label><textarea id="event-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Record what this evidence means…" rows={3} /><button className="button secondary full" disabled={!note.trim()}>Add note to incident</button></form>}
              </div>
            </div> : <div className="panel context-panel"><div className="panel-heading"><div><div className="panel-title">Evidence explorer</div><p>Select a change to inspect its provenance</p></div><span className="panel-symbol">◎</span></div><div className="context-empty"><img className="provenance-art" src="/assets/incidentatlas/06-evidence-provenance-prism.webp" alt="" loading="lazy" /><div className="evidence-graphic"><span>EVENT</span><i /> <span>STATE</span><i /> <span>HASH</span></div><p>Every timeline entry links to its source record, before/after state, and integrity digest.</p></div></div>}

            {activeIncident ? <div className="panel hypotheses-panel">
              <img className="hypothesis-art" src="/assets/incidentatlas/07-hypothesis-evidence-map.webp" alt="" loading="lazy" />
              <div className="panel-heading"><div><div className="panel-title">Possible contributors</div><p>Evidence-linked deterministic suggestions</p></div><button className="icon-button small" title="Recalculate" onClick={() => void generateHypotheses()} disabled={busy}>↻</button></div>
              {hypotheses.length === 0 ? <div className="hypothesis-empty"><p>No hypotheses have been generated for this incident.</p><button className="button secondary full" onClick={() => void generateHypotheses()} disabled={busy}>{busy ? "Scoring evidence…" : "Analyze incident window"}</button></div> : <div className="hypothesis-list">{hypotheses.map((hypothesis) => <article className="hypothesis" key={hypothesis.id}><div className="hypothesis-score"><strong>{Math.round(hypothesis.confidence * 100)}%</strong><small>evidence score</small></div><div className="hypothesis-copy"><strong>{hypothesis.title}</strong><p>{hypothesis.description}</p><small>{hypothesis.evidence.length} supporting evidence link{hypothesis.evidence.length === 1 ? "" : "s"} · {hypothesis.status.replaceAll("_", " ")}</small><div className="feedback-actions"><button onClick={() => void updateHypothesis(hypothesis.id, "confirmed_by_human")}>Confirm</button><button onClick={() => void updateHypothesis(hypothesis.id, "rejected")}>Reject</button><button onClick={() => void updateHypothesis(hypothesis.id, "investigating")}>Investigate</button></div></div></article>)}</div>}
              <img className="postmortem-art" src="/assets/incidentatlas/15-postmortem-draft.webp" alt="" loading="lazy" />
              <button className="button secondary full postmortem-button" onClick={() => void downloadPostmortem()} disabled={busy}>{busy ? "Preparing draft…" : "Download deterministic postmortem draft"}</button>
            </div> : <div className="panel incident-form-panel"><div className="panel-heading"><div><div className="panel-title">Start an investigation</div><p>Declare an incident to reconstruct its time window</p></div><img className="incident-declaration-art" src="/assets/incidentatlas/14-incident-declaration-window.webp" alt="" loading="lazy" /></div><form className="incident-form" onSubmit={createIncident}><label htmlFor="new-incident-title">Incident title</label><input id="new-incident-title" name="title" placeholder="e.g. API returning 502 errors" required /><div className="form-split"><label>Started at<input type="datetime-local" name="started_at" defaultValue={new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)} required /></label><label>Severity<select name="severity"><option value="medium">Medium</option><option value="low">Low</option><option value="high">High</option><option value="critical">Critical</option></select></label></div><label htmlFor="affected-services">Affected services <span>(comma separated)</span></label><input id="affected-services" name="affected_services" placeholder="api, checkout" /><button className="button primary full" disabled={busy}>Create incident window</button></form></div>}
          </aside>
        </section>}
      </div>
    </main>
  </div>;
}
