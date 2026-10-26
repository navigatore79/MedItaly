-- Center management is a separate membership, not a clinical role.
create table public.center_managers (
 center_id uuid not null references public.centers(id),
 user_id uuid not null references public.profiles(id),
 active boolean not null default true,
 granted_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 primary key(center_id,user_id)
);
alter table public.center_managers enable row level security;
revoke all on public.center_managers from anon,authenticated;
grant select on public.center_managers to authenticated;
create policy "manager reads own memberships" on public.center_managers for select to authenticated using(user_id=(select auth.uid()));
create table public.patient_center_requests (
 id uuid primary key default gen_random_uuid(),
 patient_id uuid not null references public.profiles(id),
 center_id uuid not null references public.centers(id),
 status text not null default 'pending' check(status in ('pending','accepted','declined')),
 created_at timestamptz not null default now(),
 responded_at timestamptz,
 responded_by uuid references public.profiles(id)
);
create unique index patient_center_pending on public.patient_center_requests(patient_id,center_id) where status='pending';
alter table public.patient_center_requests enable row level security;
revoke all on public.patient_center_requests from anon,authenticated;
grant select on public.patient_center_requests to authenticated;
create policy "patient reads own center requests" on public.patient_center_requests for select to authenticated using(patient_id=(select auth.uid()));
alter table public.patient_care_contacts add column chosen_center_id uuid references public.centers(id);
do $$declare c record;begin
 for c in select conname from pg_constraint where conrelid='public.patient_care_contacts'::regclass and contype='c' and pg_get_constraintdef(oid) like '%initial_choice%' loop
 execute format('alter table public.patient_care_contacts drop constraint %I',c.conname);end loop;
end $$;
alter table public.patient_care_contacts add constraint care_reference_choice check(
 (initial_choice is null and choice_completed_at is null and chosen_clinician_id is null and chosen_center_id is null)
 or(initial_choice='test' and choice_completed_at is not null and chosen_clinician_id is null and chosen_center_id is null)
 or(initial_choice='clinician' and choice_completed_at is not null and chosen_clinician_id is not null and chosen_center_id is null)
 or(initial_choice='center' and choice_completed_at is not null and chosen_center_id is not null and chosen_clinician_id is null));

create function public.list_patient_centers() returns table(id uuid,name text)
language sql stable security definer set search_path='' as $$
 select c.id,c.name from public.centers c where auth.uid() is not null order by c.name;
$$;
create function public.patient_choose_initial_center(p_center uuid) returns text
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();begin
 if not exists(select 1 from public.profiles where id=u and role::text='Patient' and account_active) then raise exception 'PATIENT_REQUIRED';end if;
 if p_center is null or not exists(select 1 from public.centers where id=p_center) then raise exception 'CENTER_REQUIRED';end if;
 if not exists(select 1 from public.patient_care_contacts where patient_id=u) then raise exception 'CARE_CONTACT_MISSING';end if;
 if exists(select 1 from public.profiles where id=u and assigned_center_id=p_center) then
  update public.patient_care_contacts set initial_choice='center',chosen_center_id=p_center,chosen_clinician_id=null,choice_completed_at=now(),updated_at=now() where patient_id=u;
  return 'connected';
 end if;
 insert into public.patient_center_requests(patient_id,center_id) values(u,p_center) on conflict(patient_id,center_id) where status='pending' do nothing;
 update public.patient_care_contacts set initial_choice='center',chosen_center_id=p_center,chosen_clinician_id=null,choice_completed_at=now(),updated_at=now() where patient_id=u;
 return 'pending';end;$$;

create function public.admin_set_center_manager(p_center uuid,p_user uuid,p_active boolean) returns void
language plpgsql security definer set search_path='' as $$begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role::text='Administrator' and account_active) or (auth.jwt()->>'aal') is distinct from 'aal2' then raise exception 'ADMIN_AAL2_REQUIRED';end if;
 if not exists(select 1 from public.profiles where id=p_user and account_active) then raise exception 'ACTIVE_ACCOUNT_REQUIRED';end if;
 insert into public.center_managers(center_id,user_id,active,granted_by) values(p_center,p_user,p_active,auth.uid()) on conflict(center_id,user_id) do update set active=excluded.active,granted_by=excluded.granted_by;
end;$$;
create function private.can_manage_center(p_center uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select (auth.jwt()->>'aal')='aal2' and exists(select 1 from public.profiles p where p.id=auth.uid() and p.account_active and (p.role::text='Administrator' or exists(select 1 from public.center_managers m where m.user_id=p.id and m.center_id=p_center and m.active)));
$$;
revoke all on function private.can_manage_center(uuid) from public,anon,authenticated;
create function public.center_management_dashboard(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if not private.can_manage_center(p_center) then raise exception 'CENTER_MANAGER_AAL2_REQUIRED';end if;
 return jsonb_build_object('center',(select name from public.centers where id=p_center),
 'requests',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',p.full_name,'created_at',r.created_at)) from public.patient_center_requests r join public.profiles p on p.id=r.patient_id where r.center_id=p_center and r.status='pending'),'[]'::jsonb),
 'patients',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name)) from public.profiles p where p.role::text='Patient' and p.assigned_center_id=p_center and p.account_active),'[]'::jsonb));end;$$;
create function public.center_respond_patient_request(p_request uuid,p_accept boolean) returns void
language plpgsql security definer set search_path='' as $$declare r public.patient_center_requests;begin
 select * into r from public.patient_center_requests where id=p_request for update;
 if r.id is null or not private.can_manage_center(r.center_id) then raise exception 'CENTER_MANAGER_AAL2_REQUIRED';end if;
 if r.status<>'pending' then raise exception 'REQUEST_ALREADY_PROCESSED';end if;
 if p_accept then
  if not exists(select 1 from public.patient_care_contacts where patient_id=r.patient_id and initial_choice='center' and chosen_center_id=r.center_id) then raise exception 'PATIENT_CHOICE_CHANGED';end if;
  update public.profiles set assigned_center_id=r.center_id where id=r.patient_id and role::text='Patient' and account_active;
  if not found then raise exception 'ACTIVE_PATIENT_REQUIRED';end if;
 end if;
 update public.patient_center_requests set status=case when p_accept then 'accepted' else 'declined' end,responded_at=now(),responded_by=auth.uid() where id=r.id;
end;$$;
revoke all on function public.list_patient_centers(),public.patient_choose_initial_center(uuid),public.admin_set_center_manager(uuid,uuid,boolean),public.center_management_dashboard(uuid),public.center_respond_patient_request(uuid,boolean) from public,anon;
grant execute on function public.list_patient_centers(),public.patient_choose_initial_center(uuid),public.admin_set_center_manager(uuid,uuid,boolean),public.center_management_dashboard(uuid),public.center_respond_patient_request(uuid,boolean) to authenticated;
CREATE OR REPLACE FUNCTION public.patient_choose_initial_doctor(p_clinician uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid := (select auth.uid()); v_result text;
begin
  if v_user is null or not exists(
    select 1 from public.profiles p where p.id=v_user and p.role::text='Patient' and p.account_active
  ) then raise exception 'PATIENT_REQUIRED'; end if;
  if not exists(select 1 from public.patient_care_contacts where patient_id=v_user)
    then raise exception 'CARE_CONTACT_MISSING'; end if;
  if p_clinician is null then raise exception 'DOCTOR_OR_CENTER_REQUIRED'; end if;
  if not exists(
    select 1 from public.clinician_directory d join public.profiles p on p.id=d.clinician_id
    where d.clinician_id=p_clinician and d.directory_visible and d.accepting_requests
      and p.role::text='Clinician' and p.account_active
  ) then raise exception 'CLINICIAN_NOT_AVAILABLE'; end if;
  if not exists(
    select 1 from public.patient_clinicians pc
    where pc.patient_id=v_user and pc.clinician_id=p_clinician and pc.active
  ) and not exists(
    select 1 from public.patient_clinician_requests r
    where r.patient_id=v_user and r.clinician_id=p_clinician and r.status='Pending'
  ) then
    insert into public.patient_clinician_requests(patient_id,clinician_id,status,patient_note)
      values(v_user,p_clinician,'Pending','Richiesta dal primo accesso');
  end if;
  update public.patient_care_contacts set initial_choice='clinician',
    chosen_clinician_id=p_clinician,chosen_center_id=null,choice_completed_at=now(),updated_at=now()
  where patient_id=v_user;
  select case when exists(
    select 1 from public.patient_clinicians pc
    where pc.patient_id=v_user and pc.clinician_id=p_clinician and pc.active
  ) then 'connected' else 'pending' end into v_result;
  return v_result;
end $function$
