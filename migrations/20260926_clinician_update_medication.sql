-- Modifica atomica del piano terapeutico con notifica al paziente.
-- Le assunzioni storiche restano collegate agli ID degli orari; quelli eliminati hanno ora NULL.
create or replace function public.clinician_update_medication(
  p_patient uuid, p_item uuid, p_name text, p_dose text, p_route text,
  p_instructions text, p_starts_on date, p_ends_on date, p_times text[]
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_old public.medications%rowtype;
  v_times text[];
  v_existing text[];
  v_time text;
  v_schedule record;
  v_index integer := 0;
  v_outbox uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p
    join public.patient_clinicians pc on pc.clinician_id=p.id
    where p.id=auth.uid() and p.role='Clinician' and p.account_active=true
      and pc.patient_id=p_patient and pc.active=true
  ) then raise exception 'MEDICO_NON_AUTORIZZATO' using errcode='42501'; end if;
  if nullif(btrim(p_name),'') is null or coalesce(array_length(p_times,1),0)=0
    or (p_starts_on is not null and p_ends_on is not null and p_ends_on<p_starts_on)
  then raise exception 'PIANO_NON_VALIDO' using errcode='22023'; end if;
  select * into v_old from public.medications
  where id=p_item and patient_id=p_patient and active=true for update;
  if not found then raise exception 'TERAPIA_NON_TROVATA' using errcode='P0002'; end if;
  select array_agg(x order by x) into v_times from unnest(p_times) x;
  if exists(select 1 from unnest(p_times) x where x !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
    or (select count(*) from unnest(p_times))<>(select count(distinct x) from unnest(p_times) x)
  then raise exception 'ORARI_NON_VALIDI' using errcode='22023'; end if;
  select array_agg(to_char(s.time_of_day,'HH24:MI') order by s.time_of_day) into v_existing
    from public.medication_schedules s where s.medication_id=p_item and s.time_of_day is not null;
  update public.medications set name=btrim(p_name),dose=coalesce(p_dose,''),route=coalesce(p_route,''),
    instructions=coalesce(p_instructions,''),starts_on=p_starts_on,ends_on=p_ends_on,updated_at=now()
  where id=p_item and patient_id=p_patient and active=true;
  if v_times is distinct from v_existing then
    for v_schedule in select id from public.medication_schedules
      where medication_id=p_item and time_of_day is not null order by created_at,id loop
      v_index:=v_index+1;
      if v_index<=cardinality(p_times) then
        update public.medication_schedules set time_of_day=p_times[v_index]::time,
          weekdays=array[0,1,2,3,4,5,6] where id=v_schedule.id;
      else
        -- Mantiene l'ID per lo storico, ma nessun promemoria futuro lo considera.
        update public.medication_schedules set time_of_day=null,weekdays='{}'::smallint[]
          where id=v_schedule.id;
      end if;
    end loop;
    while v_index<cardinality(p_times) loop
      v_index:=v_index+1;
      insert into public.medication_schedules(medication_id,time_of_day,weekdays)
      values(p_item,p_times[v_index]::time,array[0,1,2,3,4,5,6]);
    end loop;
  end if;
  v_outbox:=public.clinician_send_patient_notice(p_patient,'Terapia aggiornata',
    'Il medico ha modificato la terapia '||btrim(p_name)||'. Apri Meditaly per controllare dose e orari aggiornati.',
    'Custom Message');
  if v_outbox is null then raise exception 'NOTIFICA_NON_REGISTRATA'; end if;
  return v_outbox;
end $$;
revoke all on function public.clinician_update_medication(uuid,uuid,text,text,text,text,date,date,text[]) from public,anon;
grant execute on function public.clinician_update_medication(uuid,uuid,text,text,text,text,date,date,text[]) to authenticated;
