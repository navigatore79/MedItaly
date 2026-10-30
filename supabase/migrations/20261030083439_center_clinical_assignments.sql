-- Keep accepted center patients available in the existing full clinical workspace.
-- Only approved, active clinicians assigned to this center receive a clinical link.
create or replace function public.center_respond_patient_request(p_request uuid,p_accept boolean) returns void
language plpgsql security definer set search_path='' as $$declare r public.patient_center_requests;begin
 select * into r from public.patient_center_requests where id=p_request for update;
 if r.id is null or not private.can_manage_center(r.center_id) then raise exception 'CENTER_MANAGER_AAL2_REQUIRED';end if;
 if r.status<>'pending' then raise exception 'REQUEST_ALREADY_PROCESSED';end if;
 if p_accept then
  if not exists(select 1 from public.patient_care_contacts where patient_id=r.patient_id and initial_choice='center' and chosen_center_id=r.center_id) then raise exception 'PATIENT_CHOICE_CHANGED';end if;
  update public.profiles set assigned_center_id=r.center_id where id=r.patient_id and role::text='Patient' and account_active;
  if not found then raise exception 'ACTIVE_PATIENT_REQUIRED';end if;
  insert into public.patient_clinicians(patient_id,clinician_id)
   select r.patient_id,p.id from public.profiles p
   join public.center_managers m on m.user_id=p.id and m.center_id=r.center_id and m.active
   where p.role::text='Clinician' and p.account_active and p.assigned_center_id=r.center_id
   -- An explicitly disconnected clinical link must remain disconnected.
   on conflict(patient_id,clinician_id) do nothing;
 end if;
 update public.patient_center_requests set status=case when p_accept then 'accepted' else 'declined' end,responded_at=now(),responded_by=auth.uid() where id=r.id;
end;$$;
revoke all on function public.center_respond_patient_request(uuid,boolean) from public,anon;
grant execute on function public.center_respond_patient_request(uuid,boolean) to authenticated;
