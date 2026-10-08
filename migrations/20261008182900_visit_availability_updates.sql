create table public.visit_availability_updates(clinician_id uuid primary key references public.profiles(id) on delete cascade,revision bigint not null default 1);
alter table public.visit_availability_updates enable row level security;
revoke all on public.visit_availability_updates from anon,authenticated;
grant select on public.visit_availability_updates to authenticated;
create policy linked_visit_updates on public.visit_availability_updates for select to authenticated using(private.visit_link_allowed(clinician_id));
create function private.bump_visit_availability() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op<>'DELETE' then insert into public.visit_availability_updates(clinician_id) values(new.clinician_id) on conflict(clinician_id) do update set revision=public.visit_availability_updates.revision+1;end if;
 if tg_op='DELETE' or (tg_op='UPDATE' and old.clinician_id<>new.clinician_id) then
  if exists(select 1 from public.profiles where id=old.clinician_id) then insert into public.visit_availability_updates(clinician_id) values(old.clinician_id) on conflict(clinician_id) do update set revision=public.visit_availability_updates.revision+1;end if;
 end if;return null;
end $$;
revoke all on function private.bump_visit_availability() from public,anon,authenticated;
create trigger visit_appointment_updates after insert or update or delete on public.appointments for each row execute function private.bump_visit_availability();
create trigger visit_settings_updates after insert or update or delete on public.clinician_visit_settings for each row execute function private.bump_visit_availability();
alter publication supabase_realtime add table public.visit_availability_updates;
