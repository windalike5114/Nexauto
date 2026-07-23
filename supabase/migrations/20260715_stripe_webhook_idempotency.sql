create extension if not exists pgcrypto;

create table if not exists stripe_webhook_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  event_type text not null,
  status text not null default 'received',
  attempt_count integer not null default 0,
  first_received_at timestamptz not null default now(),
  last_attempted_at timestamptz,
  processed_at timestamptz,
  related_order_id uuid references orders(id) on delete set null,
  stripe_session_id text,
  stripe_payment_intent_id text,
  error_summary text,
  retryable boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stripe_webhook_events_status_check check (
    status in ('received', 'processing', 'processed', 'failed_retryable', 'failed_terminal', 'processed_deferred')
  )
);

create index if not exists stripe_webhook_events_status_idx
  on stripe_webhook_events(status, last_attempted_at desc);

create index if not exists stripe_webhook_events_order_idx
  on stripe_webhook_events(related_order_id);

alter table order_items
  add column if not exists source_line_key text;

create unique index if not exists order_items_order_source_line_uidx
  on order_items(order_id, source_line_key);

alter table email_events
  add column if not exists dedupe_key text,
  add column if not exists claimed_at timestamptz,
  add column if not exists last_attempted_at timestamptz;

alter table email_events
  drop constraint if exists email_events_status_check;

alter table email_events
  add constraint email_events_status_check check (
    status in ('queued', 'pending', 'sending', 'sent', 'delivered', 'delayed', 'failed', 'failed_retryable', 'bounced', 'complained')
  );

create unique index if not exists email_events_dedupe_key_uidx
  on email_events(dedupe_key)
  where dedupe_key is not null;

create or replace function claim_stripe_webhook_event(
  p_stripe_event_id text,
  p_event_type text,
  p_stripe_session_id text default null,
  p_stripe_payment_intent_id text default null,
  p_processing_lease interval default interval '10 minutes'
)
returns table (
  claim_status text,
  event_id uuid,
  current_status text
)
language plpgsql
security definer
as $$
declare
  v_event stripe_webhook_events%rowtype;
begin
  insert into stripe_webhook_events (
    stripe_event_id,
    event_type,
    status,
    attempt_count,
    last_attempted_at,
    stripe_session_id,
    stripe_payment_intent_id
  )
  values (
    p_stripe_event_id,
    p_event_type,
    'processing',
    1,
    now(),
    p_stripe_session_id,
    p_stripe_payment_intent_id
  )
  on conflict (stripe_event_id) do nothing
  returning * into v_event;

  if found then
    return query select 'claimed'::text, v_event.id, v_event.status;
    return;
  end if;

  update stripe_webhook_events
  set
    status = 'processing',
    attempt_count = attempt_count + 1,
    last_attempted_at = now(),
    stripe_session_id = coalesce(p_stripe_session_id, stripe_session_id),
    stripe_payment_intent_id = coalesce(p_stripe_payment_intent_id, stripe_payment_intent_id),
    error_summary = null,
    retryable = true,
    updated_at = now()
  where stripe_event_id = p_stripe_event_id
    and (
      status in ('received', 'failed_retryable')
      or (
        status = 'processing'
        and coalesce(last_attempted_at, first_received_at) < now() - p_processing_lease
      )
    )
  returning * into v_event;

  if found then
    return query select 'claimed'::text, v_event.id, v_event.status;
    return;
  end if;

  select * into v_event
  from stripe_webhook_events
  where stripe_event_id = p_stripe_event_id;

  if v_event.status = 'processed' or v_event.status = 'processed_deferred' then
    return query select 'already_processed'::text, v_event.id, v_event.status;
  elsif v_event.status = 'failed_terminal' then
    return query select 'terminal'::text, v_event.id, v_event.status;
  elsif v_event.status = 'processing' then
    return query select 'already_processing'::text, v_event.id, v_event.status;
  else
    return query select 'not_claimed'::text, v_event.id, v_event.status;
  end if;
end;
$$;

create or replace function complete_stripe_webhook_event(
  p_stripe_event_id text,
  p_status text,
  p_related_order_id uuid default null,
  p_error_summary text default null,
  p_retryable boolean default true
)
returns void
language plpgsql
security definer
as $$
begin
  update stripe_webhook_events
  set
    status = p_status,
    related_order_id = coalesce(p_related_order_id, related_order_id),
    error_summary = p_error_summary,
    retryable = p_retryable,
    processed_at = case
      when p_status in ('processed', 'processed_deferred') then now()
      else processed_at
    end,
    updated_at = now()
  where stripe_event_id = p_stripe_event_id;
end;
$$;

create or replace function claim_email_event(
  p_dedupe_key text,
  p_type text,
  p_recipient text,
  p_subject text default null,
  p_order_id uuid default null,
  p_customer_id uuid default null,
  p_processing_lease interval default interval '10 minutes'
)
returns table (
  claim_status text,
  email_event_id uuid,
  current_status text
)
language plpgsql
security definer
as $$
declare
  v_email email_events%rowtype;
begin
  insert into email_events (
    dedupe_key,
    type,
    recipient,
    subject,
    order_id,
    customer_id,
    status,
    claimed_at,
    last_attempted_at
  )
  values (
    p_dedupe_key,
    p_type,
    p_recipient,
    p_subject,
    p_order_id,
    p_customer_id,
    'sending',
    now(),
    now()
  )
  on conflict (dedupe_key) do nothing
  returning * into v_email;

  if found then
    return query select 'claimed'::text, v_email.id, v_email.status;
    return;
  end if;

  update email_events
  set
    status = 'sending',
    type = p_type,
    recipient = p_recipient,
    subject = coalesce(p_subject, subject),
    order_id = coalesce(p_order_id, order_id),
    customer_id = coalesce(p_customer_id, customer_id),
    claimed_at = now(),
    last_attempted_at = now(),
    error_code = null,
    updated_at = now()
  where dedupe_key = p_dedupe_key
    and (
      status in ('pending', 'queued', 'failed', 'failed_retryable')
      or (
        status = 'sending'
        and coalesce(last_attempted_at, claimed_at, created_at) < now() - p_processing_lease
      )
    )
  returning * into v_email;

  if found then
    return query select 'claimed'::text, v_email.id, v_email.status;
    return;
  end if;

  select * into v_email
  from email_events
  where dedupe_key = p_dedupe_key;

  if v_email.status in ('sent', 'delivered') then
    return query select 'already_sent'::text, v_email.id, v_email.status;
  elsif v_email.status = 'sending' then
    return query select 'already_sending'::text, v_email.id, v_email.status;
  else
    return query select 'not_claimed'::text, v_email.id, v_email.status;
  end if;
end;
$$;
