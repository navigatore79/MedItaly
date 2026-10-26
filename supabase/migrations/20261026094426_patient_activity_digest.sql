-- Delivery metadata only: private diary contents and clinical answers are never copied.
create table public.clinician_patient_activity (
 id bigint generated always as identity primary key,
 clinician_id uuid not null references public.profiles(id),
 patient_id uuid not null references public.profiles(id),
 kind text not null,
 record_id text not null,
 occurred_at timestamptz not null default now()
);
create index clinician_activity_window on public.clinician_patient_activity(clinician_id,occurred_at);
alter table public.clinician_patient_activity enable row level security;
revoke all on public.clinician_patient_activity from public,anon,authenticated;
grant select,insert on public.clinician_patient_activity to service_role;
create function private.record_patient_activity() returns trigger
language plpgsql security definer set search_path='' as $$
declare j jsonb:=to_jsonb(new); old_j jsonb; patient uuid; recipient uuid; k text;begin
 if tg_op='UPDATE' then old_j:=to_jsonb(old);if old_j=j then return new;end if;end if;
 k:=tg_table_name;patient:=nullif(j->>'patient_id','')::uuid;
 if k='patient_journal_entries' then
  recipient:=nullif(j->>'shared_with','')::uuid;
  if recipient is null or j->>'shared_at' is null then return new;end if;
  if tg_op='UPDATE' and old_j->>'shared_at' is not distinct from j->>'shared_at' and old_j->>'shared_with' is not distinct from j->>'shared_with' then return new;end if;
 elsif k='chat_messages' then
  patient:=nullif(j->>'sender_id','')::uuid;recipient:=nullif(j->>'recipient_id','')::uuid;
  if tg_op<>'INSERT' then return new;end if;
 elsif k='care_questionnaire_responses' then
  select clinician_id into recipient from public.care_questionnaire_assignments where id=(j->>'assignment_id')::uuid;
 elsif k in ('appointments','patient_daily_checkins') then
  recipient:=nullif(j->>'clinician_id','')::uuid;
 end if;
 if auth.uid() is distinct from patient then return new;end if;
 if not exists(select 1 from public.profiles where id=patient and role::text in ('Patient','Administrator')) then return new;end if;
 insert into public.clinician_patient_activity(clinician_id,patient_id,kind,record_id)
 select pc.clinician_id,patient,k,coalesce(j->>'id',j->>'vaccine_code','record') from public.patient_clinicians pc join public.profiles p on p.id=pc.clinician_id
 where pc.patient_id=patient and pc.active and p.account_active and p.role::text in ('Clinician','Administrator') and (recipient is null or pc.clinician_id=recipient);
 return new;end;$$;
revoke all on function private.record_patient_activity() from public,anon,authenticated;
do $$declare t text;begin
 foreach t in array array['patient_daily_checkins','medication_intakes','care_questionnaire_responses','medical_reports','patient_vaccine_declarations','appointments','patient_journal_entries','chat_messages'] loop
 execute format('create trigger patient_activity_digest after insert or update on public.%I for each row execute function private.record_patient_activity()',t);
 end loop;end;$$;
-- Each report covers [20:00 previous day, 20:00 report day), with automatic DST.
-- It includes delayed offline uploads at their server receipt time.
alter table public.clinician_email_outbox add column last_error text,add column last_error_at timestamptz;
do $$declare c record;begin
 for c in select conname from pg_constraint where conrelid='public.clinician_email_outbox'::regclass and contype='c' and pg_get_constraintdef(oid) like '%status%' loop
 execute format('alter table public.clinician_email_outbox drop constraint %I',c.conname);end loop;
end $$;
alter table public.clinician_email_outbox add constraint clinician_email_delivery_status check(status in ('pending','processing','sent','failed','skipped'));
