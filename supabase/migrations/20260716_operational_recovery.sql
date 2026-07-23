create extension if not exists pgcrypto;

alter table email_events
  add column if not exists attempt_count integer not null default 0,
  add column if not exists next_retry_at timestamptz,
  add column if not exists last_error_summary text;

create index if not exists email_events_retry_idx
  on email_events(status, next_retry_at, updated_at)
  where status in ('failed', 'failed_retryable');

create table if not exists system_audit_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  entity_type text not null,
  entity_id text,
  actor_type text not null,
  actor_id text,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint system_audit_events_actor_type_check check (
    actor_type in ('system', 'admin', 'cron')
  )
);

create index if not exists system_audit_events_entity_idx
  on system_audit_events(entity_type, entity_id, created_at desc);

create index if not exists system_audit_events_type_idx
  on system_audit_events(event_type, created_at desc);

alter table system_audit_events enable row level security;

revoke all on table system_audit_events from anon, authenticated;
grant select, insert on table system_audit_events to service_role;
