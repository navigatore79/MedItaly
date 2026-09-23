create or replace function public.review_link_with_care(
  p_request uuid,
  p_procedure_code text,
  p_procedure_label text,
  p_performed_on date,
  p_protocol uuid,
  p_medication_plan jsonb,
  p_followup_plan jsonb,
  p_note text default null
) returns jsonb
language plpgsql
set search_path = public, private
as $$
declare
  v_patient uuid;
  v_clinician uuid := auth.uid();
  v_template public.monitoring_protocols%rowtype;
  v_personalized uuid;
  v_result jsonb;
  v_delta integer;
begin
  if v_clinician is null then raise exception 'Accesso richiesto'; end if;
  select patient_id into v_patient
  from public.patient_clinician_requests
  where id = p_request and clinician_id = v_clinician and status = 'Pending'
  for update;
  if v_patient is null then raise exception 'Richiesta non disponibile'; end if;
  if nullif(btrim(p_procedure_label),'') is null or p_performed_on is null
     or p_performed_on > (now() at time zone 'Europe/Rome')::date or p_performed_on < date '1900-01-01'
     or length(p_procedure_label)>500 or length(coalesce(p_procedure_code,''))>60 then
    raise exception 'Prestazione e data non valide';
  end if;
  if jsonb_typeof(p_medication_plan) <> 'array' or jsonb_array_length(p_medication_plan)>30
    or jsonb_typeof(p_followup_plan) <> 'array' or jsonb_array_length(p_followup_plan)>50 then
    raise exception 'Piano non valido';
  end if;
  if p_protocol is not null then
    select * into v_template from public.monitoring_protocols
    where id=p_protocol and clinician_id=v_clinician and is_active=true;
    if v_template.id is null then raise exception 'Protocollo non disponibile'; end if;
  end if;
  insert into public.monitoring_protocols(
    clinician_id,name,description,checkin_enabled,checkin_time,checkin_frequency,
    checkin_weekdays,reasons_catalog,alert_on_yellow,alert_on_red,
    missed_checkin_alert,medication_reminder_enabled,followup_reminder_offsets,
    medication_plan,followup_plan,source_reference
  ) values (
    v_clinician,
    left(coalesce(v_template.name,'Follow-up personalizzato') || ' · ' || to_char(now(),'YYYY-MM-DD HH24:MI'),180),
    coalesce(v_template.description,'Piano rivisto dal medico prima dell’invio al paziente'),
    coalesce(v_template.checkin_enabled,true),coalesce(v_template.checkin_time,time '09:00'),
    coalesce(v_template.checkin_frequency,'daily'),
    coalesce(v_template.checkin_weekdays,array[0,1,2,3,4,5,6]::smallint[]),
    coalesce(v_template.reasons_catalog,array['Altro']::text[]),
    coalesce(v_template.alert_on_yellow,false),coalesce(v_template.alert_on_red,true),
    coalesce(v_template.missed_checkin_alert,false),coalesce(v_template.medication_reminder_enabled,true),
    coalesce(v_template.followup_reminder_offsets,array[7,1,0]::smallint[]),
    p_medication_plan,p_followup_plan,v_template.source_reference
  ) returning id into v_personalized;

  perform public.clinician_review_link_request(p_request,true,p_note);
  select public.apply_protocol_to_patient(v_patient,v_personalized,p_note) into v_result;
  v_delta := p_performed_on - current_date;
  update public.medications
    set starts_on=starts_on+v_delta,
        ends_on=case when ends_on is null then null else ends_on+v_delta end,
        active=case when ends_on is null then true else ends_on+v_delta>=current_date end
    where source_protocol_assignment_id=(v_result->>'assignment_id')::uuid;
  update public.followup_milestones
    set due_date=due_date+v_delta
    where source_protocol_assignment_id=(v_result->>'assignment_id')::uuid;
  update public.patient_clinician_requests
    set procedure_code=nullif(btrim(p_procedure_code),''),
        procedure_label=btrim(p_procedure_label),
        performed_on=p_performed_on,
        applied_protocol_id=v_personalized,
        protocol_assignment_id=(v_result->>'assignment_id')::uuid
    where id=p_request;
  return v_result;
end $$;

