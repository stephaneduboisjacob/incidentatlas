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

  if (loading) return <div className="loading-screen">Opening the incident record…</div>;
  if (!user) {
    return <main className="auth-screen">
      <div className="auth-brand"><div className="brand-mark">IA</div><span>Incident<span>Atlas</span></span></div>
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
      <div className="brand"><div className="brand-mark">IA</div><span>Incident<span>Atlas</span></span></div>
      <div className="workspace-switch"><span className="workspace-dot" />{user.display_name}<span className="chevron">⌄</span></div>
      <div className="side-label">INVESTIGATE</div>
      <button className="nav-item active"><span className="nav-icon">⌁</span>Overview</button>
      <button className="nav-item" onClick={() => setSelectedIncident("")}><span className="nav-icon">◷</span>Change timeline</button>
      <button className="nav-item" onClick={() => document.getElementById("incident-select")?.focus()}><span className="nav-icon">◉</span>Incidents <span className="nav-count">{incidents.filter((item) => item.status !== "resolved" && item.status !== "closed").length}</span></button>
      <div className="side-label second">ENVIRONMENT</div>
      <button className="nav-item" onClick={() => setSelectedHost("")}><span className="nav-icon">⌂</span>Hosts <span className="nav-count">{hosts.length}</span></button>
      <button className="nav-item" onClick={() => setErrorMessage("Collector enrollment and health controls are being implemented.")}><span className="nav-icon">↯</span>Collectors</button>
      <div className="sidebar-bottom">
        <div className="collector-health"><span className="health-dot" /><div><strong>{hosts.length} hosts reporting</strong><small>Collector status</small></div><span className="side-arrow">›</span></div>
        <div className="privacy-note"><span>◇</span><p>Redaction runs on the monitored host before events are sent.</p></div>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar">
        <div className="breadcrumbs"><span>Workspace</span><b>/</b><strong>{activeIncident ? activeIncident.title : "Overview"}</strong></div>
        <div className="top-actions"><span className="secure-label"><i /> Evidence store healthy</span><button className="icon-button" title="Help">?</button><button className="avatar" title={user.email}>{user.display_name.slice(0, 1).toUpperCase()}</button><button className="text-button" onClick={() => void logout()}>Sign out</button></div>
      </header>

      <div className="page-content">
        <section className="page-heading">
          <div><div className="eyebrow">INCIDENT RESPONSE · {new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(new Date()).toUpperCase()}</div><h1>{activeIncident ? activeIncident.title : "Operational overview"}</h1><p>{activeIncident ? `Started ${displayDate(activeIncident.started_at)} · ${activeIncident.affected_services.join(", ") || "Services not specified"}` : "A concise record of what changed across your environment."}</p></div>
          <div className="heading-actions"><button className="button secondary" onClick={() => void loadWorkspace(selectedIncident || undefined)}>↻ <span>Refresh</span></button><button className="button primary" onClick={() => document.getElementById("new-incident-title")?.focus()}>＋ <span>Declare incident</span></button></div>
        </section>

        <section className="metric-grid">
          <div className="metric-card"><div className="metric-top"><span>OPEN INCIDENTS</span><span className="metric-icon red">◉</span></div><strong>{incidents.filter((item) => !["resolved", "closed"].includes(item.status)).length.toString().padStart(2, "0")}</strong><small>{incidents.length ? "Across this workspace" : "No active investigations"}</small></div>
          <div className="metric-card"><div className="metric-top"><span>RECENT CHANGES</span><span className="metric-icon blue">⌁</span></div><strong>{events.length.toString().padStart(2, "0")}</strong><small>Events in the current view</small></div>
          <div className="metric-card"><div className="metric-top"><span>HOSTS REPORTING</span><span className="metric-icon green">⌂</span></div><strong>{hosts.length.toString().padStart(2, "0")}</strong><small>Last seen within 24 hours</small></div>
          <div className="metric-card health-metric"><div className="metric-top"><span>INGESTION HEALTH</span><span className="health-dot" /></div><strong className="healthy-text">Healthy</strong><small>API and database connected</small></div>
        </section>

        {errorMessage && <div className="notice" role="status"><span>{errorMessage.replaceAll("_", " ")}</span><button onClick={() => setErrorMessage("")}>×</button></div>}

        <section className="investigation-grid">
          <div className="timeline-card panel">
            <div className="panel-heading"><div><div className="panel-title">Change timeline</div><p>{activeIncident ? "Changes in the incident window" : "Recent operational changes"}</p></div><div className="filter-row">
              <select id="incident-select" value={selectedIncident} onChange={(event) => void selectIncident(event.target.value)} aria-label="Incident window">
                <option value="">All recent events</option>{incidents.map((incident) => <option key={incident.id} value={incident.id}>{incident.title}</option>)}
              </select>
              <select value={selectedHost} onChange={(event) => setSelectedHost(event.target.value)} aria-label="Filter host"><option value="">All hosts</option>{hosts.map((host) => <option key={host.id} value={host.id}>{host.hostname}</option>)}</select>
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Filter category"><option value="all">All sources</option>{["deployment", "configuration", "process", "container", "database", "network", "authentication", "certificate", "resource", "security"].map((value) => <option key={value}>{value}</option>)}</select>
            </div></div>
            {visibleEvents.length === 0 ? <div className="empty-state"><div className="empty-icon">⌁</div><strong>No changes in this view</strong><p>Enroll a collector to start recording operational changes.</p></div> : <div className="timeline-list">
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
                <div className="evidence-summary"><span className={`tag ${selectedEvent.category}`}>{selectedEvent.category}</span><h3>{selectedEvent.summary}</h3><p>{displayDate(selectedEvent.occurred_at)}</p></div>
                <div className="detail-list"><div><span>Source</span><strong>{selectedEvent.source}</strong></div><div><span>Resource</span><strong>{selectedEvent.resource.name ?? selectedEvent.resource.id}</strong></div><div><span>Change</span><strong>{selectedEvent.change_kind}</strong></div><div><span>Severity</span><strong className={`text-${severityTone[selectedEvent.severity] ?? "quiet"}`}>{selectedEvent.severity}</strong></div></div>
                <div className="state-block"><div className="state-label">BEFORE</div><pre>{JSON.stringify(selectedEvent.before_state, null, 2)}</pre></div><div className="state-block"><div className="state-label">AFTER</div><pre>{JSON.stringify(selectedEvent.after_state, null, 2)}</pre></div>
                {selectedEvent.correlation && <div className="factor-block"><div className="state-label">WHY THIS EVENT IS RELEVANT</div>{selectedEvent.correlation.factors.map((factor) => <div className="factor" key={factor.key}><span className={factor.points ? "factor-plus" : "factor-zero"}>{factor.points ? `+${factor.points}` : "—"}</span><p>{factor.explanation}</p></div>)}</div>}
                <div className="digest-block"><span>SHA-256 EVENT DIGEST</span><code>{selectedEvent.event_digest}</code></div>
                {activeIncident && <form className="annotation-form" onSubmit={addAnnotation}><label htmlFor="event-note">Add an investigation note</label><textarea id="event-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Record what this evidence means…" rows={3} /><button className="button secondary full" disabled={!note.trim()}>Add note to incident</button></form>}
              </div>
            </div> : <div className="panel context-panel"><div className="panel-heading"><div><div className="panel-title">Evidence explorer</div><p>Select a change to inspect its provenance</p></div><span className="panel-symbol">◎</span></div><div className="context-empty"><div className="evidence-graphic"><span>EVENT</span><i /> <span>STATE</span><i /> <span>HASH</span></div><p>Every timeline entry links to its source record, before/after state, and integrity digest.</p></div></div>}

            {activeIncident ? <div className="panel hypotheses-panel">
              <div className="panel-heading"><div><div className="panel-title">Possible contributors</div><p>Evidence-linked deterministic suggestions</p></div><button className="icon-button small" title="Recalculate" onClick={() => void generateHypotheses()} disabled={busy}>↻</button></div>
              {hypotheses.length === 0 ? <div className="hypothesis-empty"><p>No hypotheses have been generated for this incident.</p><button className="button secondary full" onClick={() => void generateHypotheses()} disabled={busy}>{busy ? "Scoring evidence…" : "Analyze incident window"}</button></div> : <div className="hypothesis-list">{hypotheses.map((hypothesis) => <article className="hypothesis" key={hypothesis.id}><div className="hypothesis-score"><strong>{Math.round(hypothesis.confidence * 100)}%</strong><small>evidence score</small></div><div className="hypothesis-copy"><strong>{hypothesis.title}</strong><p>{hypothesis.description}</p><small>{hypothesis.evidence.length} supporting evidence link{hypothesis.evidence.length === 1 ? "" : "s"} · {hypothesis.status.replaceAll("_", " ")}</small><div className="feedback-actions"><button onClick={() => void updateHypothesis(hypothesis.id, "confirmed_by_human")}>Confirm</button><button onClick={() => void updateHypothesis(hypothesis.id, "rejected")}>Reject</button><button onClick={() => void updateHypothesis(hypothesis.id, "investigating")}>Investigate</button></div></div></article>)}</div>}
              <button className="button secondary full postmortem-button" onClick={() => void downloadPostmortem()} disabled={busy}>{busy ? "Preparing draft…" : "Download deterministic postmortem draft"}</button>
            </div> : <div className="panel incident-form-panel"><div className="panel-heading"><div><div className="panel-title">Start an investigation</div><p>Declare an incident to reconstruct its time window</p></div></div><form className="incident-form" onSubmit={createIncident}><label htmlFor="new-incident-title">Incident title</label><input id="new-incident-title" name="title" placeholder="e.g. API returning 502 errors" required /><div className="form-split"><label>Started at<input type="datetime-local" name="started_at" defaultValue={new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)} required /></label><label>Severity<select name="severity"><option value="medium">Medium</option><option value="low">Low</option><option value="high">High</option><option value="critical">Critical</option></select></label></div><label htmlFor="affected-services">Affected services <span>(comma separated)</span></label><input id="affected-services" name="affected_services" placeholder="api, checkout" /><button className="button primary full" disabled={busy}>Create incident window</button></form></div>}
          </aside>
        </section>
      </div>
    </main>
  </div>;
}
