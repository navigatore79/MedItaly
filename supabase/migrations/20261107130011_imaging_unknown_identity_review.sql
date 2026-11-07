-- An unknown account has no date to contradict: hold for identity verification.
create or replace function public.imaging_complete(p_delivery uuid,p_lease uuid,p_validation jsonb,p_assets jsonb) returns text
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
 if mapped is not null and nullif(d.manifest->>'birth_date','') is not null and (p.date_of_birth is null or p.date_of_birth::text<>d.manifest->>'birth_date') then conflict:=true;end if;
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

