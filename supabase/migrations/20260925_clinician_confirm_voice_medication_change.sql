-- A voice transcript only prepares a draft. This RPC commits a clinician-reviewed replacement atomically.
create or replace function public.clinician_confirm_medication_replacement(
  p_patient uuid, p_old_medication uuid, p_new_name text, p_dose text,
  p_route text, p_times text[], p_starts_on date, p_ends_on date,
  p_instructions text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_clinician uuid := (select auth.uid());
  v_new uuid;
  v_time text;
begin
  if v_clinician is null or not exists (
    select 1 from public.profiles where id=v_clinician and role::text='Clinician' and account_active
  ) then raise exception 'CLINICIAN_REQUIRED'; end if;
  if not exists (
    select 1 from public.patient_clinicians where clinician_id=v_clinician and patient_id=p_patient and active
  ) then raise exception 'PATIENT_NOT_ASSIGNED'; end if;
  if not exists (
    select 1 from public.medications where id=p_old_medication and patient_id=p_patient and active
  ) then raise exception 'ACTIVE_MEDICATION_NOT_FOUND'; end if;
  if length(trim(coalesce(p_new_name,'')))<2 or length(trim(coalesce(p_dose,'')))<1
     or length(trim(coalesce(p_route,'')))<2
     or p_starts_on is null or p_ends_on is not null and p_ends_on<p_starts_on
     or cardinality(p_times) not between 1 and 6 then
    raise exception 'REVIEW_MEDICATION_FIELDS';
  end if;
  if exists (select 1 from unnest(p_times) t where t !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
     or (select count(distinct t) from unnest(p_times) t)<>cardinality(p_times) then
    raise exception 'INVALID_MEDICATION_TIMES';
  end if;

  insert into public.medications(patient_id,prescribed_by,name,dose,route,instructions,starts_on,ends_on,active)
  values (p_patient,v_clinician,trim(p_new_name),trim(p_dose),trim(coalesce(p_route,'')),
    nullif(trim(coalesce(p_instructions,'')),''),p_starts_on,p_ends_on,true)
  returning id into v_new;
  foreach v_time in array p_times loop
    insert into public.medication_schedules(medication_id,time_of_day,weekdays)
    values(v_new,v_time::time,array[0,1,2,3,4,5,6]::smallint[]);
  end loop;
  update public.medications set active=false,updated_at=now()
  where id=p_old_medication and patient_id=p_patient and active;
  insert into public.audit_logs(actor_id,patient_id,action,entity_table,entity_id,metadata)
  values(v_clinician,p_patient,'clinician_voice_medication_replacement','medications',v_new,
    jsonb_build_object('previous_medication_id',p_old_medication));
  return v_new;
end $$;
revoke all on function public.clinician_confirm_medication_replacement(uuid,uuid,text,text,text,text[],date,date,text)
  from public,anon;
grant execute on function public.clinician_confirm_medication_replacement(uuid,uuid,text,text,text,text[],date,date,text)
  to authenticated;
