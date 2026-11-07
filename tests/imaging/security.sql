-- Run after migration, entirely rolled back: no real patients or notifications.
begin;
create temp table imaging_test_context(k text primary key,v uuid);
insert into imaging_test_context values('admin',(select id from public.profiles where role::text='Administrator' and account_active limit 1)),('center',gen_random_uuid()),('other',gen_random_uuid()),('patient',gen_random_uuid()),('outsider',gen_random_uuid());
insert into public.centers(id,name,code) select v,'Imaging transaction test',case when k='center' then 'imaging-test-main' else 'imaging-test-other' end from imaging_test_context where k in ('center','other');
insert into auth.users(id,email,raw_user_meta_data) select v,v::text||'@example.invalid','{}' from imaging_test_context where k in ('patient','outsider');
update public.profiles set account_active=true,assigned_center_id=(select v from imaging_test_context where k='center'),date_of_birth='1950-01-01' where id=(select v from imaging_test_context where k='patient');
select set_config('request.jwt.claims',jsonb_build_object('sub',(select v from imaging_test_context where k='admin'),'role','authenticated','aal','aal2')::text,true);
do $$declare c uuid; p uuid; s jsonb; d uuid; lease uuid; result text; count_before integer;begin
 select v into c from imaging_test_context where k='center';select v into p from imaging_test_context where k='patient';
 s:=public.imaging_register_source(c,'Test source',true);
 if s->>'key' not like 'medi_%' then raise exception 'KEY_FAILED';end if;
 perform public.imaging_verify_identity(c,'HOSPITAL','MRN-1',p,null);
 begin perform public.imaging_verify_identity(c,'HOSPITAL','MRN-1',p,null);raise exception 'DUPLICATE_NOT_BLOCKED';exception when unique_violation then null;end;
 begin perform public.imaging_verify_identity((select v from imaging_test_context where k='other'),'HOSPITAL','MRN-2',p,null);raise exception 'CROSS_CENTER_ALLOWED';exception when others then if sqlerrm<>'PATIENT_NOT_IN_CENTER' then raise;end if;end;
 insert into public.imaging_deliveries(source_id,center_id,request_id,manifest,manifest_hash,status) values((s->>'id')::uuid,c,'test-1','{"issuer":"HOSPITAL","patient_id":"MRN-1","birth_date":"1950-01-01","title":"Test","final":true}',repeat('a',64),'queued') returning id into d;
 -- Claim cannot be stolen by an arbitrary lease token.
 select (public.imaging_claim()->>'lease_token')::uuid into lease;
 begin perform public.imaging_complete(d,gen_random_uuid(),'{"ok":true}','[]');raise exception 'LEASE_NOT_CHECKED';exception when others then if sqlerrm<>'INVALID_LEASE' then raise;end if;end;
 result:=public.imaging_complete(d,lease,'{"ok":true,"birth_date":"1950-01-01"}',jsonb_build_array(jsonb_build_object('path',d::text||'/test','kind','report','sha256',repeat('a',64),'bytes',20)));
 if result<>'published' then raise exception 'AUTO_PUBLICATION_FAILED: %',result;end if;
 select count(*) into count_before from public.notifications where patient_id=p;
 perform public.imaging_publish(d,p);
 if (select count(*) from public.notifications where patient_id=p)<>count_before then raise exception 'DUPLICATE_NOTIFICATION';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p,'role','authenticated','aal','aal1')::text,true);
 if jsonb_array_length(public.imaging_patient_list())<>1 then raise exception 'PATIENT_LIST_FAILED';end if;
 perform public.imaging_access(d);
 begin perform public.imaging_dashboard(c);raise exception 'PATIENT_MANAGER_BYPASS';exception when others then if sqlerrm<>'IMAGING_FORBIDDEN' then raise;end if;end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select v from imaging_test_context where k='outsider'),'role','authenticated','aal','aal1')::text,true);
 if jsonb_array_length(public.imaging_patient_list())<>0 then raise exception 'CROSS_PATIENT_LEAK';end if;
 begin perform public.imaging_access(d);raise exception 'ASSET_LEAK';exception when others then if sqlerrm<>'IMAGING_FORBIDDEN' then raise;end if;end;
 if has_table_privilege('authenticated','public.imaging_deliveries','SELECT') or has_function_privilege('authenticated','public.imaging_claim()','EXECUTE') or has_function_privilege('anon','public.imaging_register_source(uuid,text,boolean)','EXECUTE') then raise exception 'PRIVILEGE_LEAK';end if;
end$$;
rollback;
select 'PASS: verified identity, cross-center and cross-patient isolation, lease, auto publication, duplicate notification, patient access, private tables and worker privileges; fixtures rolled back' as result;
