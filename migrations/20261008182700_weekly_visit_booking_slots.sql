create table public.clinician_visit_settings (
 clinician_id uuid primary key references public.profiles(id) on delete cascade,
 enabled boolean not null default false,
 duration_minutes integer not null default 30 check(duration_minutes between 5 and 180),
 notice_hours integer not null default 2 check(notice_hours between 0 and 168),
 horizon_days integer not null default 30 check(horizon_days between 7 and 90),
 location_type text not null default 'in_person' check(location_type in ('in_person','phone','video')),
 location_label text not null default '' check(length(location_label)<=300),
 weekly_windows jsonb not null default '[]' check(jsonb_typeof(weekly_windows)='array'),
 blocked_dates jsonb not null default '[]' check(jsonb_typeof(blocked_dates)='array'),
 updated_at timestamptz not null default now()
);
alter table public.clinician_visit_settings enable row level security;
create policy visit_settings_own_read on public.clinician_visit_settings for select to authenticated using(clinician_id=(select auth.uid()));
revoke all on public.clinician_visit_settings from anon,authenticated;
grant select on public.clinician_visit_settings to authenticated;
alter table public.appointments add column booked_slot boolean not null default false;
create index appointments_visit_busy on public.appointments(clinician_id,proposed_start) where status in ('Proposed','Confirmed');

create function private.visit_link_allowed(p_clinician uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles c where c.id=p_clinician and c.role='Clinician' and c.account_active)
 and exists(select 1 from public.profiles u where u.id=auth.uid() and u.account_active)
 and (auth.uid()=p_clinician or exists(select 1 from public.patient_clinicians l where l.patient_id=auth.uid() and l.clinician_id=p_clinician and l.active))
$$;
revoke all on function private.visit_link_allowed(uuid) from public,anon;
grant execute on function private.visit_link_allowed(uuid) to authenticated;

create function private.save_visit_settings_impl(p_settings jsonb) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); w jsonb; b jsonb; windows jsonb:=coalesce(p_settings->'weekly_windows','[]');blocks jsonb:=coalesce(p_settings->'blocked_dates','[]'); day integer;st integer;en integer;
begin
 if u is null or not exists(select 1 from public.profiles where id=u and role='Clinician' and account_active) then raise exception 'Solo il medico può configurare la propria agenda';end if;
 if jsonb_typeof(windows)<>'array' or jsonb_array_length(windows)>28 or jsonb_typeof(blocks)<>'array' or jsonb_array_length(blocks)>180 then raise exception 'Configurazione non valida';end if;
 for w in select value from jsonb_array_elements(windows) loop
  day:=(w->>'day')::int;st:=(w->>'start')::int;en:=(w->>'end')::int;
  if day is null or st is null or en is null or day not between 0 and 6 or st<0 or en>1440 or st>=en or en-st<(p_settings->>'duration_minutes')::int then raise exception 'Controlla giorno e orari delle fasce';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(windows) with ordinality a(w,n),jsonb_array_elements(windows) with ordinality b(w,n) where a.n<b.n and (a.w->>'day')::int=(b.w->>'day')::int and (a.w->>'start')::int<(b.w->>'end')::int and (b.w->>'start')::int<(a.w->>'end')::int) then raise exception 'Le fasce dello stesso giorno si sovrappongono';end if;
 for b in select value from jsonb_array_elements(blocks) loop perform (b#>>'{}')::date;end loop;
 if coalesce((p_settings->>'enabled')::boolean,false) and jsonb_array_length(windows)=0 then raise exception 'Aggiungi almeno una fascia settimanale';end if;
 perform pg_advisory_xact_lock(hashtextextended('meditaly-visits:'||u::text,0));
 insert into public.clinician_visit_settings(clinician_id,enabled,duration_minutes,notice_hours,horizon_days,location_type,location_label,weekly_windows,blocked_dates)
 values(u,coalesce((p_settings->>'enabled')::boolean,false),coalesce((p_settings->>'duration_minutes')::int,30),coalesce((p_settings->>'notice_hours')::int,2),coalesce((p_settings->>'horizon_days')::int,30),coalesce(p_settings->>'location_type','in_person'),coalesce(p_settings->>'location_label',''),windows,blocks)
 on conflict(clinician_id) do update set enabled=excluded.enabled,duration_minutes=excluded.duration_minutes,notice_hours=excluded.notice_hours,horizon_days=excluded.horizon_days,location_type=excluded.location_type,location_label=excluded.location_label,weekly_windows=excluded.weekly_windows,blocked_dates=excluded.blocked_dates,updated_at=now();
end $$;
create function public.save_visit_settings(p_settings jsonb) returns void language sql set search_path='' as $$select private.save_visit_settings_impl(p_settings)$$;

create function private.free_visit_slots_impl(p_clinician uuid,p_from date,p_days integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.clinician_visit_settings;today date:=(now() at time zone 'Europe/Rome')::date;slots jsonb;
begin
 if not private.visit_link_allowed(p_clinician) then raise exception 'Medico non collegato al tuo account';end if;
 if p_from is null or p_from<today or p_from>today+90 or p_days is null or p_days not between 1 and 14 then raise exception 'Intervallo di ricerca non valido';end if;
 select * into cfg from public.clinician_visit_settings where clinician_id=p_clinician;
 if cfg.clinician_id is null or not cfg.enabled then return jsonb_build_object('enabled',false,'slots','[]'::jsonb);end if;
 select coalesce(jsonb_agg(jsonb_build_object('start',s,'end',s+make_interval(mins=>cfg.duration_minutes)) order by s),'[]'::jsonb) into slots from (
 select distinct t.s from generate_series(0,p_days-1) off(n)
 cross join jsonb_array_elements(cfg.weekly_windows) w
 cross join lateral generate_series(((p_from+off.n)::timestamp+make_interval(mins=>(w->>'start')::int)) at time zone 'Europe/Rome',(((p_from+off.n)::timestamp+make_interval(mins=>(w->>'end')::int)) at time zone 'Europe/Rome')-make_interval(mins=>cfg.duration_minutes),make_interval(mins=>cfg.duration_minutes)) t(s)
 where extract(dow from p_from+off.n)::int=(w->>'day')::int and p_from+off.n<=today+cfg.horizon_days
 and not cfg.blocked_dates @> jsonb_build_array((p_from+off.n)::text)
 and t.s>=now()+make_interval(hours=>cfg.notice_hours)
 and not exists(select 1 from public.appointments a where a.clinician_id=p_clinician and a.status in ('Proposed','Confirmed') and a.proposed_start<t.s+make_interval(mins=>cfg.duration_minutes) and a.proposed_start+make_interval(mins=>a.duration_minutes)>t.s)
 ) free(s);
 return jsonb_build_object('enabled',true,'slots',slots,'duration_minutes',cfg.duration_minutes,'horizon_days',cfg.horizon_days,'location_type',cfg.location_type,'location_label',cfg.location_label,'timezone','Europe/Rome');
end $$;
create function public.get_free_visit_slots(p_clinician uuid,p_from date,p_days integer default 7) returns jsonb language sql set search_path='' as $$select private.free_visit_slots_impl(p_clinician,p_from,p_days)$$;

create function private.visit_appointment_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare cfg public.clinician_visit_settings;available jsonb;
begin
 if tg_op='UPDATE' and old.booked_slot then
  if new.patient_id<>old.patient_id or new.clinician_id<>old.clinician_id or new.created_by<>old.created_by or new.proposed_start is distinct from old.proposed_start or new.duration_minutes<>old.duration_minutes or not new.booked_slot then raise exception 'Per cambiare orario annulla e prenota nuovamente';end if;
  if auth.uid()=old.patient_id and new.status<>old.status and new.status<>'Cancelled' then raise exception 'Il paziente può soltanto annullare la prenotazione';end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('meditaly-visits:'||new.clinician_id::text,0));
 if tg_op='INSERT' and new.booked_slot then
  if auth.uid() is distinct from new.patient_id or new.created_by<>auth.uid() or new.request_origin<>'patient' or new.status<>'Confirmed' or not private.visit_link_allowed(new.clinician_id) then raise exception 'Prenotazione non autorizzata';end if;
  select * into cfg from public.clinician_visit_settings where clinician_id=new.clinician_id;
  available:=private.free_visit_slots_impl(new.clinician_id,(new.proposed_start at time zone 'Europe/Rome')::date,1);
  if not exists(select 1 from jsonb_array_elements(available->'slots') x where (x->>'start')::timestamptz=new.proposed_start) or new.duration_minutes<>cfg.duration_minutes or new.location_type<>cfg.location_type or new.location_label is distinct from cfg.location_label then raise exception 'Questo orario non è più disponibile. Aggiorna gli orari e scegli un altro slot';end if;
 end if;
 if tg_op='INSERT' and auth.uid()=new.patient_id and new.request_origin='patient' and not new.booked_slot and (new.status<>'Requested' or new.proposed_start is not null) then raise exception 'Usa gli orari disponibili per prenotare';end if;
 if new.status in ('Proposed','Confirmed') and new.proposed_start is not null and (tg_op='INSERT' or new.status is distinct from old.status or new.proposed_start is distinct from old.proposed_start or new.duration_minutes<>old.duration_minutes) then
  if exists(select 1 from public.appointments a where a.id<>new.id and a.clinician_id=new.clinician_id and a.status in ('Proposed','Confirmed') and a.proposed_start<new.proposed_start+make_interval(mins=>new.duration_minutes) and a.proposed_start+make_interval(mins=>a.duration_minutes)>new.proposed_start) then raise exception 'Il medico ha già un appuntamento in questo orario';end if;
 end if;
 return new;
end $$;
revoke all on function private.visit_appointment_guard() from public,anon,authenticated;
create trigger visit_appointment_guard before insert or update on public.appointments for each row execute function private.visit_appointment_guard();

create function private.book_visit_slot_impl(p_clinician uuid,p_start timestamptz,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.clinician_visit_settings;uid uuid:=auth.uid();aid uuid;nid uuid;outid uuid;
begin
 if uid=p_clinician or not private.visit_link_allowed(p_clinician) then raise exception 'Medico non collegato al tuo account';end if;
 if p_start is null or length(coalesce(p_reason,''))>500 then raise exception 'Dati della prenotazione non validi';end if;
 perform pg_advisory_xact_lock(hashtextextended('meditaly-visits:'||p_clinician::text,0));
 select * into cfg from public.clinician_visit_settings where clinician_id=p_clinician;
 insert into public.appointments(patient_id,clinician_id,created_by,request_origin,status,reason,proposed_start,duration_minutes,location_type,location_label,booked_slot)
 values(uid,p_clinician,uid,'patient','Confirmed',nullif(btrim(p_reason),''),p_start,cfg.duration_minutes,cfg.location_type,cfg.location_label,true) returning id into aid;
 insert into public.notifications(patient_id,sender_id,title,message,notification_type,scheduled_for,related_appointment_id,is_read)
 values(uid,uid,'Visita prenotata',format('Visita confermata per %s.',to_char(p_start at time zone 'Europe/Rome','DD/MM/YYYY HH24:MI')),'Appointment Alert',p_start,aid,false) returning id into nid;
 insert into public.push_outbox(user_id,notification_id,title,body,status) values(uid,nid,'Meditaly','La tua visita è stata prenotata','pending') returning id into outid;
 return jsonb_build_object('appointment_id',aid,'outbox_id',outid);
end $$;
create function public.book_visit_slot(p_clinician uuid,p_start timestamptz,p_reason text default null) returns jsonb language sql set search_path='' as $$select private.book_visit_slot_impl(p_clinician,p_start,p_reason)$$;

create function private.change_visit_booking_impl(p_appointment uuid,p_action text) returns void language plpgsql security definer set search_path='' as $$
declare a public.appointments;u uuid:=auth.uid();
begin
 select * into a from public.appointments where id=p_appointment;
 if u is null or not a.booked_slot or a.id is null or u not in(a.patient_id,a.clinician_id) or not private.visit_link_allowed(a.clinician_id) then raise exception 'Prenotazione non accessibile';end if;
 perform pg_advisory_xact_lock(hashtextextended('meditaly-visits:'||a.clinician_id::text,0));
 select * into a from public.appointments where id=p_appointment for update;
 if a.status<>'Confirmed' then raise exception 'Prenotazione già chiusa';end if;
 if p_action='cancel' then
  if u=a.patient_id and a.proposed_start<=now() then raise exception 'La visita è già iniziata: contatta il medico';end if;
  update public.appointments set status='Cancelled',updated_at=now() where id=a.id;
 elsif p_action='complete' and u=a.clinician_id then update public.appointments set status='Completed',updated_at=now() where id=a.id;
 else raise exception 'Azione non autorizzata';end if;
end $$;
create function public.change_visit_booking(p_appointment uuid,p_action text) returns void language sql set search_path='' as $$select private.change_visit_booking_impl(p_appointment,p_action)$$;

revoke all on function private.save_visit_settings_impl(jsonb),private.free_visit_slots_impl(uuid,date,integer),private.book_visit_slot_impl(uuid,timestamptz,text),private.change_visit_booking_impl(uuid,text) from public,anon;
revoke all on function public.save_visit_settings(jsonb),public.get_free_visit_slots(uuid,date,integer),public.book_visit_slot(uuid,timestamptz,text),public.change_visit_booking(uuid,text) from public,anon;
grant execute on function private.save_visit_settings_impl(jsonb),private.free_visit_slots_impl(uuid,date,integer),private.book_visit_slot_impl(uuid,timestamptz,text),private.change_visit_booking_impl(uuid,text) to authenticated;
grant execute on function public.save_visit_settings(jsonb),public.get_free_visit_slots(uuid,date,integer),public.book_visit_slot(uuid,timestamptz,text),public.change_visit_booking(uuid,text) to authenticated;
