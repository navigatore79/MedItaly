-- Additive delivery system: existing reports and permissions are untouched.
create table public.imaging_sources (
 id uuid primary key default gen_random_uuid(), center_id uuid not null references public.centers,
 name text not null check(length(name) between 1 and 100), key_hash text not null unique,
 active boolean not null default true, auto_publish boolean not null default false, created_by uuid not null references public.profiles,
 created_at timestamptz not null default now()
);
create table public.imaging_identities (
 center_id uuid not null references public.centers, issuer text not null,
 external_id text not null, patient_id uuid not null references public.profiles,
 fiscal_code text, verified_by uuid not null references public.profiles, verified_at timestamptz not null default now(),
 primary key(center_id,issuer,external_id),
 check(length(issuer) between 1 and 100 and length(external_id) between 1 and 100),
 check(fiscal_code is null or fiscal_code ~ '^[A-Z0-9]{16}$')
);
create unique index imaging_identity_cf on public.imaging_identities(center_id,fiscal_code) where fiscal_code is not null;
create table public.imaging_deliveries (
 id uuid primary key default gen_random_uuid(), source_id uuid not null references public.imaging_sources,
 center_id uuid not null references public.centers, request_id text not null check(length(request_id) between 1 and 100),
 manifest jsonb not null, manifest_hash text not null,
 status text not null default 'uploading' check(status in ('uploading','queued','processing','review','published','rejected','failed')),
 patient_id uuid references public.profiles, reason text, validation jsonb,
 lease_token uuid, lease_until timestamptz, attempts integer not null default 0,
 published_at timestamptz, opened_at timestamptz, created_at timestamptz not null default now(),
 unique(source_id,request_id)
);
create index imaging_queue on public.imaging_deliveries(status,created_at);
create table public.imaging_assets (
 id uuid primary key default gen_random_uuid(), delivery_id uuid not null references public.imaging_deliveries,
 path text not null unique, kind text not null check(kind in ('report','dicom','archive','manifest')),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'), bytes bigint not null check(bytes>0), metadata jsonb not null default '{}'
);
create index imaging_assets_delivery on public.imaging_assets(delivery_id);
create table public.imaging_audit (
 id bigint generated always as identity primary key, delivery_id uuid references public.imaging_deliveries,
 center_id uuid not null references public.centers, actor_id uuid, event text not null, created_at timestamptz not null default now()
);
create index imaging_audit_delivery on public.imaging_audit(delivery_id);
create table public.imaging_worker_health(id boolean primary key default true check(id),last_seen timestamptz not null);
alter table public.imaging_worker_health enable row level security;
revoke all on public.imaging_worker_health from public,anon,authenticated;
grant all on public.imaging_worker_health to service_role;
alter table public.imaging_sources enable row level security;
alter table public.imaging_identities enable row level security;
alter table public.imaging_deliveries enable row level security;
alter table public.imaging_assets enable row level security;
alter table public.imaging_audit enable row level security;
revoke all on public.imaging_sources,public.imaging_identities,public.imaging_deliveries,public.imaging_assets,public.imaging_audit from anon,authenticated;
grant all on public.imaging_sources,public.imaging_identities,public.imaging_deliveries,public.imaging_assets,public.imaging_audit to service_role;
grant usage,select on sequence public.imaging_audit_id_seq to service_role;
insert into storage.buckets(id,name,public,file_size_limit) values ('imaging-incoming','imaging-incoming',false,1073741824),('imaging-clinical','imaging-clinical',false,1073741824);
-- No client policies: access to either bucket is mediated by authenticated APIs.

create function private.imaging_manager(c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.can_manage_center(c) and exists(select 1 from public.profiles where id=auth.uid() and account_active and role::text in ('Clinician','Administrator'));
$$;
revoke all on function private.imaging_manager(uuid) from public,anon,authenticated;

create function public.imaging_register_source(p_center uuid,p_name text,p_auto_publish boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare secret text; sid uuid;begin
 if not private.imaging_manager(p_center) then raise exception 'IMAGING_FORBIDDEN';end if;
 secret:='medi_'||encode(extensions.gen_random_bytes(32),'hex');
 insert into public.imaging_sources(center_id,name,key_hash,created_by,auto_publish) values(p_center,btrim(p_name),encode(extensions.digest(secret,'sha256'),'hex'),auth.uid(),coalesce(p_auto_publish,false)) returning id into sid;
 insert into public.imaging_audit(center_id,actor_id,event) values(p_center,auth.uid(),'source_created');
 return jsonb_build_object('id',sid,'key',secret);
end$$;
create function public.imaging_revoke_source(p_source uuid) returns void
language plpgsql security definer set search_path='' as $$declare c uuid;begin
 select center_id into c from public.imaging_sources where id=p_source;
 if not private.imaging_manager(c) then raise exception 'IMAGING_FORBIDDEN';end if;
 update public.imaging_sources set active=false where id=p_source;
 insert into public.imaging_audit(center_id,actor_id,event) values(c,auth.uid(),'source_revoked');
end$$;
create function public.imaging_verify_identity(p_center uuid,p_issuer text,p_external_id text,p_patient uuid,p_fiscal_code text default null) returns void
language plpgsql security definer set search_path='' as $$begin
 if not private.imaging_manager(p_center) then raise exception 'IMAGING_FORBIDDEN';end if;
 if not exists(select 1 from public.profiles where id=p_patient and role::text='Patient' and account_active and assigned_center_id=p_center) then raise exception 'PATIENT_NOT_IN_CENTER';end if;
 -- No silent reassignment of an existing external identifier.
 insert into public.imaging_identities(center_id,issuer,external_id,patient_id,fiscal_code,verified_by)
 values(p_center,btrim(p_issuer),btrim(p_external_id),p_patient,nullif(upper(btrim(p_fiscal_code)),''),auth.uid());
 insert into public.imaging_audit(center_id,actor_id,event) values(p_center,auth.uid(),'identity_verified');
end$$;
create function public.imaging_dashboard(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if not private.imaging_manager(p_center) then raise exception 'IMAGING_FORBIDDEN';end if;
 return jsonb_build_object(
 'sources',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active,'auto_publish',auto_publish)) from public.imaging_sources where center_id=p_center),'[]'),
 'patients',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',full_name,'dob',date_of_birth)) from public.profiles where assigned_center_id=p_center and account_active and role::text='Patient'),'[]'),
 'identities',coalesce((select jsonb_agg(jsonb_build_object('issuer',issuer,'external_id',external_id,'patient_id',patient_id,'verified_at',verified_at)) from public.imaging_identities where center_id=p_center),'[]'),
 'deliveries',coalesce((select jsonb_agg(to_jsonb(d)) from (select id,status,reason,patient_id,manifest,created_at,published_at from public.imaging_deliveries where center_id=p_center order by created_at desc limit 100) d),'[]'));
end$$;

-- Internal queue operations have no end-user grants.
create function public.imaging_claim() returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.imaging_deliveries;begin
 insert into public.imaging_worker_health(id,last_seen) values(true,now()) on conflict(id) do update set last_seen=excluded.last_seen;
 update public.imaging_deliveries set status='failed',reason='RETRIES_EXHAUSTED',lease_token=null where status='processing' and lease_until<now() and attempts>=5;
 select * into d from public.imaging_deliveries where (status='queued' or (status='processing' and lease_until<now())) and attempts<5 order by created_at for update skip locked limit 1;
 if d.id is null then return null;end if;
 update public.imaging_deliveries set status='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '30 minutes' where id=d.id returning * into d;
 return to_jsonb(d);
end$$;

create function public.imaging_complete(p_delivery uuid,p_lease uuid,p_validation jsonb,p_assets jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare d public.imaging_deliveries; a jsonb; mapped uuid; cf_patient uuid; p public.profiles; conflict boolean:=false; source public.imaging_sources;begin
 select * into d from public.imaging_deliveries where id=p_delivery for update;
 if d.id is null or d.status<>'processing' or d.lease_token is distinct from p_lease or d.lease_until<now() then raise exception 'INVALID_LEASE';end if;
 if not exists(select 1 from public.imaging_sources where id=d.source_id and active) then raise exception 'SOURCE_REVOKED';end if;
 if p_validation->>'ok' is distinct from 'true' then
  update public.imaging_deliveries set status='rejected',reason=left(p_validation->>'reason',200),validation=p_validation,lease_token=null,lease_until=null where id=d.id;
  return 'rejected';
 end if;
 select patient_id into mapped from public.imaging_identities where center_id=d.center_id and issuer=d.manifest->>'issuer' and external_id=d.manifest->>'patient_id';
 if nullif(d.manifest->>'fiscal_code','') is not null then
  select patient_id into cf_patient from public.imaging_identities where center_id=d.center_id and fiscal_code=d.manifest->>'fiscal_code';
  if cf_patient is null or (mapped is not null and cf_patient<>mapped) then conflict:=true;end if;
 end if;
 mapped:=coalesce(mapped,cf_patient);
 select * into p from public.profiles where id=mapped and role::text='Patient' and account_active and assigned_center_id=d.center_id;
 if p.id is null then mapped:=null;end if;
 if nullif(d.manifest->>'birth_date','') is not null and (p.date_of_birth is null or p.date_of_birth::text<>d.manifest->>'birth_date') then conflict:=true;end if;
 if nullif(p_validation->>'birth_date','') is not null and (p.date_of_birth is null or p.date_of_birth::text<>p_validation->>'birth_date') and mapped is not null then conflict:=true;end if;
 -- DICOM identity checks are performed by the worker against this same manifest.
 if jsonb_array_length(p_assets)=0 then raise exception 'EMPTY_ASSETS';end if;
 for a in select * from jsonb_array_elements(p_assets) loop
  if a->>'path' not like d.id::text||'/%' then raise exception 'INVALID_ASSET_PATH';end if;
  insert into public.imaging_assets(delivery_id,path,kind,sha256,bytes,metadata) values(d.id,a->>'path',a->>'kind',a->>'sha256',(a->>'bytes')::bigint,coalesce(a->'metadata','{}'));
 end loop;
 update public.imaging_deliveries set status='review',patient_id=case when conflict then null else mapped end,
 reason=case when conflict then 'IDENTITY_CONFLICT' when mapped is null then 'IDENTITY_NOT_VERIFIED' else 'READY_FOR_RELEASE' end,
 validation=p_validation,lease_token=null,lease_until=null where id=d.id;
 insert into public.imaging_audit(delivery_id,center_id,event) values(d.id,d.center_id,'validation_completed');
 select * into source from public.imaging_sources where id=d.source_id;
 if mapped is not null and not conflict and source.auto_publish and exists(select 1 from public.profiles operator where operator.id=source.created_by and operator.account_active and (operator.role::text='Administrator' or (operator.role::text='Clinician' and exists(select 1 from public.center_managers m where m.user_id=operator.id and m.center_id=d.center_id and m.active)))) then
  update public.imaging_deliveries set status='published',published_at=now(),reason=null where id=d.id;
  insert into public.notifications(patient_id,sender_id,title,message,notification_type) values(mapped,source.created_by,'Nuova prestazione disponibile','Apri MEDIapp per consultare i documenti del centro.','Custom Message');
  insert into public.imaging_audit(delivery_id,center_id,event) values(d.id,d.center_id,'auto_published');
  return 'published';
 end if;
 return 'review';
end$$;

create function public.imaging_publish(p_delivery uuid,p_patient uuid) returns void
language plpgsql security definer set search_path='' as $$declare d public.imaging_deliveries;begin
 select * into d from public.imaging_deliveries where id=p_delivery for update;
 if d.id is null or not private.imaging_manager(d.center_id) then raise exception 'IMAGING_FORBIDDEN';end if;
 if d.status='published' and d.patient_id=p_patient then return;end if;
 if d.status<>'review' or d.validation->>'ok' is distinct from 'true' or d.reason='IDENTITY_CONFLICT' then raise exception 'NOT_READY';end if;
 if not exists(select 1 from public.profiles where id=p_patient and assigned_center_id=d.center_id and role::text='Patient' and account_active) then raise exception 'PATIENT_NOT_IN_CENTER';end if;
 if d.patient_id is not null and d.patient_id<>p_patient then raise exception 'PATIENT_MISMATCH';end if;
 -- Unknown identity must be verified first, then submitted again; never override conflicts here.
 if d.patient_id is null and not exists(select 1 from public.imaging_identities where center_id=d.center_id and issuer=d.manifest->>'issuer' and external_id=d.manifest->>'patient_id' and patient_id=p_patient and (nullif(d.manifest->>'fiscal_code','') is null or fiscal_code=d.manifest->>'fiscal_code')) then raise exception 'IDENTITY_NOT_VERIFIED';end if;
 if nullif(d.manifest->>'birth_date','') is not null and not exists(select 1 from public.profiles where id=p_patient and date_of_birth::text=d.manifest->>'birth_date') then raise exception 'BIRTH_DATE_MISMATCH';end if;
 if nullif(d.validation->>'birth_date','') is not null and not exists(select 1 from public.profiles where id=p_patient and date_of_birth::text=d.validation->>'birth_date') then raise exception 'BIRTH_DATE_MISMATCH';end if;
 update public.imaging_deliveries set status='published',patient_id=p_patient,published_at=now(),reason=null where id=d.id;
 insert into public.notifications(patient_id,sender_id,title,message,notification_type) values(p_patient,auth.uid(),'Nuova prestazione disponibile','Apri MEDIapp per consultare i documenti del centro.','Custom Message');
 insert into public.imaging_audit(delivery_id,center_id,actor_id,event) values(d.id,d.center_id,auth.uid(),'published');
end$$;

create function public.imaging_patient_list() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'title',d.manifest->>'title','study_date',d.manifest->>'study_date','center',c.name,'published_at',d.published_at,'opened_at',d.opened_at)),'[]') from public.imaging_deliveries d join public.centers c on c.id=d.center_id join public.profiles p on p.id=d.patient_id where d.patient_id=auth.uid() and p.account_active and d.status='published';
$$;
create function public.imaging_access(p_delivery uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare d public.imaging_deliveries;begin
 select * into d from public.imaging_deliveries where id=p_delivery;
 if d.id is null or auth.uid() is null or not (private.imaging_manager(d.center_id) or (d.status='published' and d.patient_id=auth.uid() and exists(select 1 from public.profiles where id=auth.uid() and account_active))) then raise exception 'IMAGING_FORBIDDEN';end if;
 if d.patient_id=auth.uid() then update public.imaging_deliveries set opened_at=coalesce(opened_at,now()) where id=d.id;end if;
 insert into public.imaging_audit(delivery_id,center_id,actor_id,event) values(d.id,d.center_id,auth.uid(),'access_requested');
 return jsonb_build_object('delivery',d.id,'assets',coalesce((select jsonb_agg(to_jsonb(a)) from public.imaging_assets a where delivery_id=d.id),'[]'));
end$$;
revoke all on function public.imaging_register_source(uuid,text,boolean),public.imaging_revoke_source(uuid),public.imaging_verify_identity(uuid,text,text,uuid,text),public.imaging_dashboard(uuid),public.imaging_publish(uuid,uuid),public.imaging_patient_list(),public.imaging_access(uuid),public.imaging_claim(),public.imaging_complete(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.imaging_register_source(uuid,text,boolean),public.imaging_revoke_source(uuid),public.imaging_verify_identity(uuid,text,text,uuid,text),public.imaging_dashboard(uuid),public.imaging_publish(uuid,uuid),public.imaging_patient_list(),public.imaging_access(uuid) to authenticated;
grant execute on function public.imaging_claim(),public.imaging_complete(uuid,uuid,jsonb,jsonb) to service_role;
