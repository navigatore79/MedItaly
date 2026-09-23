create or replace function public.apply_reviewed_protocol_to_patient(
  p_patient uuid,
  p_protocol uuid,
  p_procedure_date date,
  p_medication_plan jsonb,
  p_followup_plan jsonb,
  p_note text default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_protocol public.monitoring_protocols%rowtype;
  v_assignment uuid;
  v_item jsonb;
  v_med uuid;
  v_time text;
  v_start date;
  v_end date;
  v_followups int := 0;
  v_meds int := 0;
  v_notification uuid;
  v_outbox uuid;
begin
  if v_uid is null or not private.is_clinician_aal2() then
    raise exception 'Accesso medico autorizzato richiesto';
  end if;
  if not exists(select 1 from public.patient_clinicians where patient_id=p_patient and clinician_id=v_uid and active) then
    raise exception 'Paziente non associato al medico';
  end if;
  select * into v_protocol from public.monitoring_protocols where id=p_protocol and clinician_id=v_uid and is_active;
  if v_protocol.id is null then raise exception 'Protocollo non disponibile'; end if;
  if p_procedure_date is null or p_procedure_date>current_date or p_procedure_date<date '2000-01-01' then
    raise exception 'Data della prestazione non valida';
  end if;
  if jsonb_typeof(p_medication_plan) is distinct from 'array' or jsonb_typeof(p_followup_plan) is distinct from 'array'
     or jsonb_array_length(p_medication_plan)>30 or jsonb_array_length(p_followup_plan)>30 then
    raise exception 'Piano clinico non valido';
  end if;
  -- Il medico conferma il piano esplicito: non si prescrivono farmaci da un template non revisionato.
  perform public.assign_monitoring_protocol(p_patient,p_protocol);
  insert into public.patient_protocol_assignments(patient_id,clinician_id,protocol_id,clinician_note)
  values(p_patient,v_uid,p_protocol,left(coalesce(p_note,''),2000)) returning id into v_assignment;
  for v_item in select value from jsonb_array_elements(p_medication_plan)
  loop
    if nullif(trim(v_item->>'name'),'') is null then continue; end if;
    if (v_item->>'starts_in_days') is null or (v_item->>'starts_in_days') !~ '^[0-9]{1,4}$'
       or (v_item->>'duration_days' is not null and (v_item->>'duration_days') !~ '^[1-9][0-9]{0,3}$')
       or jsonb_typeof(coalesce(v_item->'times','[]'::jsonb)) <> 'array' then
      raise exception 'Dati terapia non validi';
    end if;
    v_start := p_procedure_date + (v_item->>'starts_in_days')::int;
    v_end := case when v_item->>'duration_days' is null then null else v_start + (v_item->>'duration_days')::int - 1 end;
    insert into public.medications(patient_id,prescribed_by,name,dose,route,instructions,starts_on,ends_on,active,source_protocol_id,source_protocol_assignment_id)
    values(p_patient,v_uid,left(v_item->>'name',250),left(v_item->>'dose',150),left(v_item->>'route',100),left(v_item->>'instructions',2000),v_start,v_end,true,p_protocol,v_assignment)
    returning id into v_med;
    v_meds := v_meds+1;
    for v_time in select value from jsonb_array_elements_text(coalesce(v_item->'times','[]'::jsonb))
    loop
      if v_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Orario terapia non valido'; end if;
      insert into public.medication_schedules(medication_id,time_of_day,weekdays)
      values(v_med,v_time::time,array[0,1,2,3,4,5,6]::smallint[]);
    end loop;
  end loop;
  for v_item in select value from jsonb_array_elements(p_followup_plan)
  loop
    if nullif(trim(v_item->>'label'),'') is null then continue; end if;
    if (v_item->>'after_days') is null or (v_item->>'after_days') !~ '^[0-9]{1,4}$'
       or jsonb_typeof(coalesce(v_item->'reminder_offsets','[7,1,0]'::jsonb)) <> 'array' then
      raise exception 'Dati controllo non validi';
    end if;
    insert into public.followup_milestones(patient_id,milestone_label,milestone_type,due_date,notes,created_by,reminder_offsets,notifications_enabled,source_protocol_id,source_protocol_assignment_id)
    values(p_patient,left(v_item->>'label',250),left(coalesce(nullif(v_item->>'type',''),'controllo'),100),p_procedure_date+(v_item->>'after_days')::int,left(v_item->>'notes',2000),v_uid,
      coalesce((select array_agg(value::smallint) from jsonb_array_elements_text(coalesce(v_item->'reminder_offsets','[7,1,0]'::jsonb)) where value ~ '^[0-9]{1,3}$'),array[7,1,0]::smallint[]),true,p_protocol,v_assignment);
    v_followups := v_followups+1;
  end loop;
  insert into public.notifications(patient_id,sender_id,title,message,notification_type,created_at,is_read)
  values(p_patient,v_uid,'Percorso aggiornato',format('Il medico ha confermato %s: %s terapie e %s controlli.',v_protocol.name,v_meds,v_followups),'Guideline Update'::public.notification_type,now(),false)
  returning id into v_notification;
  insert into public.push_outbox(user_id,notification_id,title,body,status,created_at)
  values(p_patient,v_notification,'Meditaly','Il tuo percorso di cura è stato aggiornato','pending',now()) returning id into v_outbox;
  return jsonb_build_object('assignment_id',v_assignment,'medications_created',v_meds,'followups_created',v_followups,'outbox_id',v_outbox);
end;
$$;
revoke all on function public.apply_reviewed_protocol_to_patient(uuid,uuid,date,jsonb,jsonb,text) from public, anon;
grant execute on function public.apply_reviewed_protocol_to_patient(uuid,uuid,date,jsonb,jsonb,text) to authenticated;
