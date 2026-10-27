begin;
-- Synthetic accounts and all their changes disappear on rollback.
select set_config('mediapp.fixture_patient',gen_random_uuid()::text,true);
select set_config('mediapp.fixture_manager',gen_random_uuid()::text,true);
select set_config('mediapp.fixture_admin',(select id::text from public.profiles where role::text='Administrator' and account_active limit 1),true);
insert into auth.users(id,email,raw_user_meta_data) values
 (current_setting('mediapp.fixture_patient')::uuid,'center-patient-'||current_setting('mediapp.fixture_patient')||'@example.invalid','{"full_name":"MEDIapp verifica paziente"}'),
 (current_setting('mediapp.fixture_manager')::uuid,'center-manager-'||current_setting('mediapp.fixture_manager')||'@example.invalid','{"full_name":"MEDIapp verifica responsabile"}');
insert into public.patient_care_contacts(patient_id,test_support_admin_id) values(current_setting('mediapp.fixture_patient')::uuid,current_setting('mediapp.fixture_admin')::uuid) on conflict do nothing;
select set_config('mediapp.fixture_center',(select id::text from public.centers where code='0000'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('mediapp.fixture_patient'),'role','authenticated','aal','aal1')::text,true);
set local role authenticated;
do $$declare result text;begin
 if has_function_privilege('anon','public.patient_request_center_by_code(text)','EXECUTE') then raise exception 'TEST_ANON_ACCESS'; end if;
 if has_function_privilege('anon','public.list_my_managed_centers()','EXECUTE') or has_function_privilege('anon','public.admin_set_center_manager_mfa(uuid,uuid,boolean)','EXECUTE') then raise exception 'TEST_ANON_POLICY';end if;
 begin perform public.admin_set_center_manager_mfa(current_setting('mediapp.fixture_center')::uuid,auth.uid(),false);raise exception 'TEST_SELF_MFA_EXEMPTION';exception when others then if sqlerrm<>'ADMIN_AAL2_REQUIRED' then raise;end if;end;
 begin perform public.patient_request_center_by_code('0');raise exception 'TEST_INVALID_CODE'; exception when others then if sqlerrm<>'CENTER_CODE_INVALID' then raise;end if;end;
 result:=public.patient_request_center_by_code(' 0000 ');
 if result<>'pending' then raise exception 'TEST_NOT_PENDING';end if;
 perform public.patient_request_center_by_code('0000');
 if (select count(*) from public.patient_center_requests where patient_id=auth.uid() and status='pending')<>1 then raise exception 'TEST_DUPLICATE_REQUEST';end if;
 if (select assigned_center_id from public.profiles where id=auth.uid()) is not null then raise exception 'TEST_AUTO_MEMBERSHIP';end if;
 begin perform public.center_management_dashboard(current_setting('mediapp.fixture_center')::uuid);raise exception 'TEST_PATIENT_DASHBOARD';exception when others then if sqlerrm<>'CENTER_MANAGER_AAL2_REQUIRED' then raise;end if;end;
end$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('mediapp.fixture_admin'),'role','authenticated','aal','aal2')::text,true);
select public.admin_set_center_manager(current_setting('mediapp.fixture_center')::uuid,current_setting('mediapp.fixture_manager')::uuid,true);
select public.admin_set_center_manager_mfa(current_setting('mediapp.fixture_center')::uuid,current_setting('mediapp.fixture_manager')::uuid,false);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('mediapp.fixture_manager'),'role','authenticated','aal','aal1')::text,true);
do $$begin
 if not exists(select 1 from public.list_my_managed_centers() where id=current_setting('mediapp.fixture_center')::uuid and not mfa_required) then raise exception 'TEST_ACCESS_POLICY';end if;
 perform public.center_management_dashboard(current_setting('mediapp.fixture_center')::uuid);
end$$;
-- Restore MFA only for the synthetic membership, leaving other accounts unchanged.
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('mediapp.fixture_admin'),'role','authenticated','aal','aal2')::text,true);
select public.admin_set_center_manager_mfa(current_setting('mediapp.fixture_center')::uuid,current_setting('mediapp.fixture_manager')::uuid,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('mediapp.fixture_manager'),'role','authenticated','aal','aal1')::text,true);
do $$begin
 begin perform public.center_management_dashboard(current_setting('mediapp.fixture_center')::uuid);raise exception 'TEST_MFA_BYPASS';exception when others then if sqlerrm<>'CENTER_MANAGER_AAL2_REQUIRED' then raise;end if;end;
end$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('mediapp.fixture_manager'),'role','authenticated','aal','aal2')::text,true);
do $$declare d jsonb;request_id uuid;begin
 d:=public.center_management_dashboard(current_setting('mediapp.fixture_center')::uuid);
 if d->>'code'<>'0000' then raise exception 'TEST_LEADING_ZEROS';end if;
 select (r->>'id')::uuid into request_id from jsonb_array_elements(d->'requests') r where r->>'name'='MEDIapp verifica paziente';
 if request_id is null then raise exception 'TEST_MANAGER_REQUEST_LIST';end if;
 perform public.center_respond_patient_request(request_id,true);
 d:=public.center_management_dashboard(current_setting('mediapp.fixture_center')::uuid);
 if not exists(select 1 from jsonb_array_elements(d->'patients') p where p->>'id'=current_setting('mediapp.fixture_patient')) then raise exception 'TEST_ACCEPTANCE';end if;
 begin perform public.center_management_dashboard(gen_random_uuid());raise exception 'TEST_CROSS_CENTER';exception when others then if sqlerrm<>'CENTER_MANAGER_AAL2_REQUIRED' then raise;end if;end;
end$$;
rollback;
select 'PASS: 0000 preserved; authenticated request stays pending; duplicate prevented; individual password-only exception works; default MFA and cross-center checks enforced; nonmedical manager can approve; fixtures rolled back' as result;
