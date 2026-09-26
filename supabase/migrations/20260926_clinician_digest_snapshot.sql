-- Congela il contenuto del riepilogo prima di inviarlo: i tentativi Resend
-- con lo stesso Idempotency-Key hanno sempre lo stesso payload.
alter table public.clinician_email_outbox
  add column if not exists payload_subject text,
  add column if not exists payload_text text,
  add column if not exists payload_html text;

-- La tabella era già riservata al backend; manteniamo RLS esplicitamente attiva.
alter table public.clinician_email_outbox enable row level security;
