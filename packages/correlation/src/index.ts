import type { IncidentEvent } from "@incidentatlas/event-schema";

export interface IncidentContext {
  id: string;
  startedAt: string;
  windowBeforeMinutes: number;
  windowAfterMinutes: number;
  affectedServices: string[];
}

export interface ScoreFactor {
  key: "temporal_proximity" | "resource_relationship" | "change_significance" | "symptom_alignment";
  points: number;
  explanation: string;
}

export interface ScoredEvidence {
  eventId: string;
  relationship: "supporting" | "contradicting" | "contextual";
  score: number;
  factors: ScoreFactor[];
}

const SIGNIFICANCE: Record<string, number> = {
  deployment: 24,
  "container.image_changed": 28,
  "container.health_changed": 26,
  "database.connection_saturation": 30,
  "database.deadlock": 22,
  "systemd.service_state_changed": 20,
  "nginx.config_changed": 15,
  "certificate.changed": 13,
};

function text(value: unknown): string {
  if (typeof value === "string") return value.toLowerCase();
  if (typeof value === "number" || typeof value === "boolean") return String(value).toLowerCase();
  return "";
}

function resourceMatch(event: IncidentEvent, incident: IncidentContext): string | undefined {
  const resource = `${event.resource.id} ${event.resource.name ?? ""}`.toLowerCase();
  return incident.affectedServices.find((service) => {
    const candidate = service.toLowerCase();
    return candidate.length > 0 && (resource.includes(candidate) || candidate.includes(resource));
  });
}

export function scoreEvent(event: IncidentEvent, incident: IncidentContext): ScoredEvidence {
  const incidentMs = Date.parse(incident.startedAt);
  const eventMs = Date.parse(event.occurred_at);
  const deltaMinutes = (eventMs - incidentMs) / 60_000;
  const inWindow = deltaMinutes >= -incident.windowBeforeMinutes && deltaMinutes <= incident.windowAfterMinutes;
  const points = Math.max(0, Math.round((28 - Math.abs(deltaMinutes) * 0.7) * 100) / 100);
  const factors: ScoreFactor[] = [{
    key: "temporal_proximity",
    points: inWindow ? points : 0,
    explanation: inWindow
      ? `Occurred ${Math.abs(deltaMinutes).toFixed(1)} minutes ${deltaMinutes <= 0 ? "before" : "after"} the incident start.`
      : "Occurred outside the configured incident window.",
  }];

  const matchingService = resourceMatch(event, incident);
  factors.push({
    key: "resource_relationship",
    points: matchingService ? 30 : 0,
    explanation: matchingService
      ? `Resource matches affected service “${matchingService}”.`
      : "No direct affected-service match was identified.",
  });

  const significance = SIGNIFICANCE[event.type] ?? (event.category === "deployment" ? 20 : event.category === "configuration" ? 5 : 8);
  factors.push({
    key: "change_significance",
    points: significance,
    explanation: `The ${event.type} change has a baseline significance of ${significance} points.`,
  });

  const symptomText = `${event.type} ${event.summary} ${text(event.after.state)} ${text(event.after.health)}`;
  const symptomAligned = /fail|saturat|unhealthy|error|restart|degraded|timeout/.test(symptomText);
  factors.push({
    key: "symptom_alignment",
    points: symptomAligned ? 18 : 0,
    explanation: symptomAligned
      ? "Event describes a failure, saturation, unhealthy state, or service symptom."
      : "No direct failure or symptom language was identified.",
  });

  const score = factors.reduce((total, factor) => total + factor.points, 0);
  const relationship = !inWindow ? "contextual" : deltaMinutes > 0 && event.change_kind === "recovery" ? "contradicting" : "supporting";
  return { eventId: event.event_id, relationship, score, factors };
}

export function rankEvents(events: IncidentEvent[], incident: IncidentContext): ScoredEvidence[] {
  return events
    .map((event) => scoreEvent(event, incident))
    .sort((a, b) => b.score - a.score || a.eventId.localeCompare(b.eventId));
}
