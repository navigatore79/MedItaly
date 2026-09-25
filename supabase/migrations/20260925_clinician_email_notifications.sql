-- Mail delivery is queued in the database; no Resend credentials or patient notes are stored here.
create table if not exists public.clinician_email_outbox (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  clinician_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('red_checkin','daily_report')),
  report_day date not null,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  resend_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists clinician_email_outbox_pending on public.clinician_email_outbox(next_attempt_at)
  where status in ('pending','processing');
alter table public.clinician_email_outbox enable row level security;
revoke all on public.clinician_email_outbox from public, anon, authenticated;
grant select, insert, update on public.clinician_email_outbox to service_role;

create or replace function private.enqueue_red_checkin_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'red' and (tg_op = 'INSERT' or old.status is distinct from 'red') then
    insert into public.clinician_email_outbox(event_key, clinician_id, kind, report_day)
    select 'red:' || new.id::text || ':' || pc.clinician_id::text,
      pc.clinician_id, 'red_checkin', new.checkin_date
    from public.patient_clinicians pc
    join public.profiles p on p.id = pc.clinician_id
    where pc.patient_id = new.patient_id and pc.active and p.account_active
      and p.role in ('Clinician','Administrator')
    on conflict (event_key) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_clinician_red_checkin_email on public.patient_daily_checkins;
create trigger trg_clinician_red_checkin_email
after insert or update of status on public.patient_daily_checkins
for each row execute function private.enqueue_red_checkin_email();

create or replace function public.enqueue_clinician_daily_email_reports()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Europe/Rome')::date;
declare v_count integer;
begin
  if (now() at time zone 'Europe/Rome')::time < time '20:00'
     or (now() at time zone 'Europe/Rome')::time >= time '21:00' then
    return 0;
  end if;
  insert into public.clinician_email_outbox(event_key, clinician_id, kind, report_day)
  select 'daily:' || v_today::text || ':' || pc.clinician_id::text,
    pc.clinician_id, 'daily_report', v_today
  from public.patient_clinicians pc
  join public.profiles p on p.id = pc.clinician_id
  where pc.active and p.account_active and p.role in ('Clinician','Administrator')
  group by pc.clinician_id
  on conflict (event_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.enqueue_clinician_daily_email_reports() from public, anon, authenticated;
grant execute on function public.enqueue_clinician_daily_email_reports() to service_role;

create or replace function public.claim_clinician_email_outbox()
returns setof public.clinician_email_outbox language sql security definer set search_path = '' as $$
  update public.clinician_email_outbox o
     set status='processing', attempts=o.attempts+1, next_attempt_at=now()+interval '10 minutes'
   where o.id in (
     select id from public.clinician_email_outbox
     where ((status='pending' and next_attempt_at<=now())
         or (status='processing' and next_attempt_at<=now()))
       and attempts<8
     order by created_at limit 25 for update skip locked
   )
   returning o.*;
$$;
revoke all on function public.claim_clinician_email_outbox() from public, anon, authenticated;
grant execute on function public.claim_clinician_email_outbox() to service_role;

-- Reuse the existing server-only scheduler secret without exposing it to the browser.
select cron.schedule('meditaly-clinician-email', '* * * * *', $job$
  select net.http_post(
    url := 'https://ejlhgtodmcadmdhbujkf.supabase.co/functions/v1/dispatch-clinician-email',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-meditaly-cron-secret',(
        select secret_value from public.internal_job_secrets where name='daily-checkin')),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
$job$);
