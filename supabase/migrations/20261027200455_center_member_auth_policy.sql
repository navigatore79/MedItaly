-- MFA exceptions are individual center memberships. Existing memberships keep MFA.
alter table public.center_managers add column mfa_required boolean not null default true;

create or replace function private.can_manage_center(p_center uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=auth.uid() and p.account_active and (
  (p.role::text='Administrator' and (auth.jwt()->>'aal')='aal2')
  or (p.role::text<>'Administrator' and exists(select 1 from public.center_managers m
   where m.user_id=p.id and m.center_id=p_center and m.active
    and (not m.mfa_required or (auth.jwt()->>'aal')='aal2')))
 ));
$$;
revoke all on function private.can_manage_center(uuid) from public,anon,authenticated;

create function public.list_my_managed_centers() returns table(id uuid,name text,mfa_required boolean)
language sql stable security definer set search_path='' as $$
 select c.id,c.name,case when p.role::text='Administrator' then true else m.mfa_required end
 from public.centers c cross join public.profiles p
 left join public.center_managers m on m.center_id=c.id and m.user_id=p.id and m.active
 where p.id=auth.uid() and p.account_active and (p.role::text='Administrator' or m.user_id is not null)
 order by c.name,c.id;
$$;
revoke all on function public.list_my_managed_centers() from public,anon;
grant execute on function public.list_my_managed_centers() to authenticated;

create function public.admin_set_center_manager_mfa(p_center uuid,p_user uuid,p_required boolean) returns void
language plpgsql security definer set search_path='' as $$begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role::text='Administrator' and account_active)
  or (auth.jwt()->>'aal') is distinct from 'aal2' then raise exception 'ADMIN_AAL2_REQUIRED';end if;
 if p_required is null then raise exception 'MFA_POLICY_REQUIRED';end if;
 if not exists(select 1 from public.profiles where id=p_user and account_active and role::text<>'Administrator') then raise exception 'ACTIVE_CENTER_MEMBER_REQUIRED';end if;
 update public.center_managers set mfa_required=p_required where center_id=p_center and user_id=p_user and active;
 if not found then raise exception 'ACTIVE_CENTER_MEMBER_REQUIRED';end if;
end;$$;
revoke all on function public.admin_set_center_manager_mfa(uuid,uuid,boolean) from public,anon;
grant execute on function public.admin_set_center_manager_mfa(uuid,uuid,boolean) to authenticated;
-- No exception is enabled by this migration. The named account must be verified first.
