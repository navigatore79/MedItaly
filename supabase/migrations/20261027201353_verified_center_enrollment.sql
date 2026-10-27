-- Preauthorize an exact verified email without creating passwords or sending mail.
create table private.center_manager_enrollments (
 center_id uuid not null references public.centers(id),
 email text not null check(email=lower(btrim(email)) and position('@' in email)>1),
 mfa_required boolean not null default true,
 granted_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 claimed_by uuid references public.profiles(id),
 claimed_at timestamptz,
 primary key(center_id,email),
 check((claimed_by is null and claimed_at is null) or (claimed_by is not null and claimed_at is not null))
);
alter table private.center_manager_enrollments enable row level security;
revoke all on private.center_manager_enrollments from public,anon,authenticated;

create or replace function public.list_my_managed_centers() returns table(id uuid,name text,mfa_required boolean)
language plpgsql volatile security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_email text;invitation record;
begin
 if v_user is null or not exists(select 1 from public.profiles p where p.id=v_user and p.account_active) then return;end if;
 -- Check the authoritative Auth record, not user-editable metadata or an email claim.
 select lower(u.email) into v_email from auth.users u where u.id=v_user and u.email_confirmed_at is not null;
 if v_email is not null then
  for invitation in select e.* from private.center_manager_enrollments e
   join public.profiles grantor on grantor.id=e.granted_by and grantor.role::text='Administrator' and grantor.account_active
   where e.email=v_email and e.claimed_by is null for update of e
  loop
   insert into public.center_managers(center_id,user_id,active,granted_by,mfa_required)
   values(invitation.center_id,v_user,true,invitation.granted_by,invitation.mfa_required)
   on conflict(center_id,user_id) do nothing;
   -- A consumed authorization cannot reactivate a later revoked membership.
   update private.center_manager_enrollments e set claimed_by=v_user,claimed_at=now()
    where e.center_id=invitation.center_id and e.email=invitation.email and e.claimed_by is null;
  end loop;
 end if;
 return query select c.id,c.name,case when p.role::text='Administrator' then true else m.mfa_required end
 from public.centers c cross join public.profiles p
 left join public.center_managers m on m.center_id=c.id and m.user_id=p.id and m.active
 where p.id=v_user and p.account_active and (p.role::text='Administrator' or m.user_id is not null)
 order by c.name,c.id;
end;$$;
revoke all on function public.list_my_managed_centers() from public,anon;
grant execute on function public.list_my_managed_centers() to authenticated;
