-- Meditaly connected devices: read-only clinical display
create table if not exists public.patient_devices (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  device_type text not null check (device_type in ('blood_pressure_monitor','pulse_oximeter','scale','thermometer','glucometer','smartwatch','other')),
  display_name text not null,
  manufacturer text,
  model text,
  transport text not null default 'ble' check (transport in ('ble','health_connect','vendor_api','manual')),
  device_identifier text,
  paired_at timestamptz not null default now(),
  last_seen_at timestamptz,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists patient_devices_patient_id_idx on public.patient_devices(patient_id);
create unique index if not exists patient_devices_patient_identifier_uidx on public.patient_devices(patient_id, device_identifier) where device_identifier is not null;
alter table public.patient_devices enable row level security;
grant select, insert, update, delete on public.patient_devices to authenticated;
create policy "patient devices own select" on public.patient_devices for select to authenticated using ((select auth.uid()) = patient_id);
create policy "patient devices own insert" on public.patient_devices for insert to authenticated with check ((select auth.uid()) = patient_id);
create policy "patient devices own update" on public.patient_devices for update to authenticated using ((select auth.uid()) = patient_id) with check ((select auth.uid()) = patient_id);
create policy "patient devices clinician read assigned" on public.patient_devices for select to authenticated using (exists (select 1 from public.patient_clinicians pc where pc.patient_id=patient_devices.patient_id and pc.clinician_id=(select auth.uid()) and pc.active=true));

create table if not exists public.patient_device_measurements (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid references public.patient_devices(id) on delete set null,
  measurement_type text not null check (measurement_type in ('blood_pressure','heart_rate','spo2','weight','temperature','blood_glucose','steps','sleep','other')),
  systolic numeric, diastolic numeric, pulse numeric, value numeric, secondary_value numeric, unit text,
  measured_at timestamptz not null,
  received_at timestamptz not null default now(),
  source text not null default 'ble' check (source in ('ble','health_connect','vendor_api','manual')),
  raw_data jsonb not null default '{}'::jsonb
);
create index if not exists patient_device_measurements_patient_time_idx on public.patient_device_measurements(patient_id, measured_at desc);
create index if not exists patient_device_measurements_device_idx on public.patient_device_measurements(device_id);
alter table public.patient_device_measurements enable row level security;
grant select, insert on public.patient_device_measurements to authenticated;
create policy "device measurements patient select" on public.patient_device_measurements for select to authenticated using ((select auth.uid())=patient_id);
create policy "device measurements patient insert" on public.patient_device_measurements for insert to authenticated with check ((select auth.uid())=patient_id and (device_id is null or exists (select 1 from public.patient_devices d where d.id=patient_device_measurements.device_id and d.patient_id=(select auth.uid()))));
create policy "device measurements clinician read assigned" on public.patient_device_measurements for select to authenticated using (exists (select 1 from public.patient_clinicians pc where pc.patient_id=patient_device_measurements.patient_id and pc.clinician_id=(select auth.uid()) and pc.active=true));
