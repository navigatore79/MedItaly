create or replace function public.admin_review_clinician_application(
  p_application uuid, p_approve boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid;
  v_status public.clinician_application_status;
begin
  if private.my_role() is distinct from 'Administrator'::public.user_role then
    raise exception 'ADMIN_REQUIRED';
  end if;

  select user_id, status into v_user, v_status
  from public.clinician_applications
  where id = p_application
  for update;

  if v_user is null then
    raise exception 'APPLICATION_NOT_FOUND';
  end if;
  if v_status <> 'Pending'::public.clinician_application_status then
    raise exception 'APPLICATION_ALREADY_REVIEWED';
  end if;

  update public.clinician_applications
  set status = case
      when p_approve then 'Approved'::public.clinician_application_status
      else 'Rejected'::public.clinician_application_status
    end,
    reviewed_by = auth.uid(),
    reviewed_at = now()
  where id = p_application;

  if p_approve then
    update public.profiles
    set role = 'Clinician'::public.user_role, updated_at = now()
    where id = v_user;
    if not found then
      raise exception 'PROFILE_NOT_FOUND';
    end if;
  end if;
end;
$function$;

revoke all on function public.admin_review_clinician_application(uuid, boolean) from public, anon;
grant execute on function public.admin_review_clinician_application(uuid, boolean) to authenticated;
