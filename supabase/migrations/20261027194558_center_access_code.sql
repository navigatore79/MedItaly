-- A center code identifies the destination; it never grants membership.
create function public.patient_request_center_by_code(p_code text) returns text
language plpgsql security invoker set search_path='' as $$
declare v_center uuid;
begin
 if auth.uid() is null then raise exception 'PATIENT_REQUIRED'; end if;
 if p_code is null or length(btrim(p_code))<4 or length(btrim(p_code))>32 then raise exception 'CENTER_CODE_INVALID'; end if;
 select id into v_center from public.centers where code=upper(btrim(p_code));
 if v_center is null then raise exception 'CENTER_CODE_INVALID'; end if;
 return public.patient_choose_initial_center(v_center);
end;$$;
revoke all on function public.patient_request_center_by_code(text) from public,anon;
grant execute on function public.patient_request_center_by_code(text) to authenticated;

create or replace function public.center_management_dashboard(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if not private.can_manage_center(p_center) then raise exception 'CENTER_MANAGER_AAL2_REQUIRED'; end if;
 return jsonb_build_object('center',(select name from public.centers where id=p_center),'code',(select code from public.centers where id=p_center),
 'requests',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',p.full_name,'created_at',r.created_at) order by r.created_at,r.id) from public.patient_center_requests r join public.profiles p on p.id=r.patient_id where r.center_id=p_center and r.status='pending'),'[]'::jsonb),
 'patients',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name) order by p.full_name,p.id) from public.profiles p where p.role::text='Patient' and p.assigned_center_id=p_center and p.account_active),'[]'::jsonb));
end;$$;
revoke all on function public.center_management_dashboard(uuid) from public,anon;
grant execute on function public.center_management_dashboard(uuid) to authenticated;
