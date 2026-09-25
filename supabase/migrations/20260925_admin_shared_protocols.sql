-- Modelli condivisi dall'amministratore per i medici della dashboard clinica.
-- I medici creano una propria copia prima della conferma clinica al paziente.
alter table public.monitoring_protocols
  add column if not exists is_shared boolean not null default false;

create or replace function private.validate_admin_shared_protocol()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_shared and not exists (
    select 1 from public.profiles p
    where p.id = new.clinician_id and p.role::text = 'Administrator' and p.account_active
  ) then
    raise exception 'Only active administrators may share protocols';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_admin_shared_protocol() from public, anon, authenticated;
drop trigger if exists validate_admin_shared_protocol on public.monitoring_protocols;
create trigger validate_admin_shared_protocol
  before insert or update of is_shared,clinician_id on public.monitoring_protocols
  for each row execute function private.validate_admin_shared_protocol();

drop policy if exists "monitoring shared read" on public.monitoring_protocols;
create policy "monitoring shared read" on public.monitoring_protocols for select to authenticated
using (
  is_shared and is_active and private.my_role()::text in ('Clinician','Administrator')
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.account_active
  )
);
