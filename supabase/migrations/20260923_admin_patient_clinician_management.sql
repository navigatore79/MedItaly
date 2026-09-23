-- L'amministratore consulta le richieste senza assumere l'identità del medico.
create policy "admin reads clinician link requests" on public.patient_clinician_requests
  for select to authenticated
  using (private.my_role()::text = 'Administrator');

create or replace function public.admin_set_patient_clinician_link(
  p_patient uuid, p_clinician uuid, p_active boolean
) returns text language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_changed integer;
  v_requests integer := 0;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p where p.id = v_actor
      and p.role::text = 'Administrator' and p.account_active
  ) then raise exception 'ADMIN_REQUIRED'; end if;

  if p_patient is null or p_clinician is null or p_active is null then
    raise exception 'PATIENT_CLINICIAN_AND_ACTION_REQUIRED';
  end if;
  if not exists (
    select 1 from public.profiles p where p.id=p_patient
      and p.role::text='Patient' and p.account_active
  ) then raise exception 'ACTIVE_PATIENT_REQUIRED'; end if;
  if not exists (
    select 1 from public.profiles p where p.id=p_clinician
      and p.role::text='Clinician' and p.account_active
  ) then raise exception 'ACTIVE_CLINICIAN_REQUIRED'; end if;

  if p_active then
    insert into public.patient_clinicians(patient_id,clinician_id,active,assigned_at)
    values(p_patient,p_clinician,true,now())
    on conflict(patient_id,clinician_id) do update
      set active=true, assigned_at=excluded.assigned_at
      where not public.patient_clinicians.active;
    get diagnostics v_changed = row_count;

    update public.patient_clinician_requests set status='Accepted',
      clinician_note='Associazione attivata dall’amministratore',
      reviewed_at=now(), updated_at=now()
    where patient_id=p_patient and clinician_id=p_clinician and status='Pending';
    get diagnostics v_requests = row_count;
  else
    update public.patient_clinicians set active=false
      where patient_id=p_patient and clinician_id=p_clinician and active;
    get diagnostics v_changed = row_count;
  end if;

  if v_changed > 0 then
    insert into public.audit_logs(actor_id,patient_id,action,entity_table,entity_id,metadata)
    values(v_actor,p_patient,
      case when p_active then 'admin_link_activated' else 'admin_link_deactivated' end,
      'patient_clinicians',p_clinician,
      jsonb_build_object('clinician_id',p_clinician,'requests_accepted',v_requests));
  end if;
  return case when v_changed > 0 then 'updated' else 'unchanged' end;
end $$;

revoke all on function public.admin_set_patient_clinician_link(uuid,uuid,boolean) from public, anon;
grant execute on function public.admin_set_patient_clinician_link(uuid,uuid,boolean) to authenticated;
