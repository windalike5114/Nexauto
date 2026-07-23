import { createSupabaseAdminClient } from "@/lib/supabase";

export type AuditEventInput = {
  eventType: string;
  entityType: string;
  entityId?: string | null;
  actorType: "system" | "admin" | "cron";
  actorId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
};

export async function writeSystemAuditEvent(input: AuditEventInput) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) return;

  await supabase.from("system_audit_events").insert({
    event_type: input.eventType,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    actor_type: input.actorType,
    actor_id: input.actorId ?? null,
    summary: input.summary,
    metadata: sanitizeMetadata(input.metadata ?? {})
  });
}

function sanitizeMetadata(metadata: Record<string, unknown>) {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (/secret|token|key|payload|address/i.test(key)) continue;
    sanitized[key] = value;
  }
  return sanitized;
}
