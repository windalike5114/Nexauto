drop index if exists email_events_dedupe_key_uidx;

create unique index if not exists email_events_dedupe_key_uidx
  on email_events(dedupe_key);

revoke execute on function public.claim_stripe_webhook_event(text, text, text, text, interval)
  from public, anon, authenticated;

revoke execute on function public.complete_stripe_webhook_event(text, text, uuid, text, boolean)
  from public, anon, authenticated;

revoke execute on function public.claim_email_event(text, text, text, text, uuid, uuid, interval)
  from public, anon, authenticated;

grant execute on function public.claim_stripe_webhook_event(text, text, text, text, interval)
  to service_role;

grant execute on function public.complete_stripe_webhook_event(text, text, uuid, text, boolean)
  to service_role;

grant execute on function public.claim_email_event(text, text, text, text, uuid, uuid, interval)
  to service_role;
