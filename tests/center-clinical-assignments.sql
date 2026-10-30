begin;
-- Synthetic accounts and a separate center; every change is rolled back.
select set_config('mediapp.qa_admin',(select id::text from public.profiles where role::text='Administrator' and account_active limit 1),true);
select set_config('mediapp.qa_center',gen_random_uuid()::text,true);
create temp table fixture_accounts(kind text,id uuid default gen_random_uuid());
insert into fixture_accounts(kind) values('patient'),('doctor'),('manager'),('outside'),('revoked'),('inactive'),('disconnected');
insert into auth.users(id,email,raw_user_meta_data) select id,'clinical-qa-'||id||'@example.invalid',jsonb_build_object('full_name','MEDIapp verifica '||kind) from fixture_accounts;
insert into public.centers(id,name,code) values(current_setting('mediapp.qa_center')::uuid,'Centro di verifica temporaneo','QA-'||current_setting('mediapp.qa_center'));
update public.profiles p set role='Clinician',assigned_center_id=current_setting('mediapp.qa_center')::uuid,account_active=f.kind<>'inactive'
 from fixture_accounts f where p.id=f.id and f.kind in ('doctor','revoked','inactive','disconnected','outside');
-- A clinician without a center membership must not gain access.
insert into public.center_managers(center_id,user_id,active,mfa_required,granted_by)
 select current_setting('mediapp.qa_center')::uuid,id,kind<>'revoked',false,current_setting('mediapp.qa_admin')::uuid
 from fixture_accounts where kind in ('doctor','manager','revoked','inactive','disconnected');
insert into public.patient_clinicians(patient_id,clinician_id,active)
 select p.id,d.id,false from fixture_accounts p cross join fixture_accounts d where p.kind='patient' and d.kind='disconnected';
insert into public.patient_care_contacts(patient_id,test_support_admin_id,initial_choice,chosen_center_id,choice_completed_at)
 select id,current_setting('mediapp.qa_admin')::uuid,'center',current_setting('mediapp.qa_center')::uuid,now() from fixture_accounts where kind='patient'
 on conflict(patient_id) do update set initial_choice=excluded.initial_choice,chosen_center_id=excluded.chosen_center_id,chosen_clinician_id=null,choice_completed_at=excluded.choice_completed_at;
insert into public.patient_center_requests(patient_id,center_id)
 select id,current_setting('mediapp.qa_center')::uuid from fixture_accounts where kind='patient';
select set_config('mediapp.qa_patient',(select id::text from fixture_accounts where kind='patient'),true);
select set_config('mediapp.qa_request',(select r.id::text from public.patient_center_requests r where patient_id=current_setting('mediapp.qa_patient')::uuid),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from fixture_accounts where kind='manager'),'role','authenticated','aal','aal1')::text,true);
set local role authenticated;
select public.center_respond_patient_request(current_setting('mediapp.qa_request')::uuid,true);
do $$begin
 begin perform public.center_respond_patient_request(current_setting('mediapp.qa_request')::uuid,true);raise exception 'TEST_DUPLICATE_ACCEPTANCE';exception when others then if sqlerrm<>'REQUEST_ALREADY_PROCESSED' then raise;end if;end;
 begin perform public.center_management_dashboard(gen_random_uuid());raise exception 'TEST_CROSS_CENTER';exception when others then if sqlerrm<>'CENTER_MANAGER_AAL2_REQUIRED' then raise;end if;end;
end$$;
reset role;
do $$begin
 if (select count(*) from public.patient_clinicians where patient_id=current_setting('mediapp.qa_patient')::uuid and active)<>1 then raise exception 'TEST_EXACTLY_ONE_APPROVED_CLINICIAN';end if;
 if not exists(select 1 from public.patient_clinicians pc join fixture_accounts f on f.id=pc.clinician_id where pc.patient_id=current_setting('mediapp.qa_patient')::uuid and f.kind='doctor' and pc.active) then raise exception 'TEST_DOCTOR_LINK_MISSING';end if;
 if exists(select 1 from public.patient_clinicians pc join fixture_accounts f on f.id=pc.clinician_id where pc.patient_id=current_setting('mediapp.qa_patient')::uuid and f.kind in ('manager','outside','revoked','inactive')) then raise exception 'TEST_UNAUTHORIZED_LINK';end if;
 if not exists(select 1 from public.patient_clinicians pc join fixture_accounts f on f.id=pc.clinician_id where pc.patient_id=current_setting('mediapp.qa_patient')::uuid and f.kind='disconnected' and not pc.active) then raise exception 'TEST_DISCONNECTED_REACTIVATED';end if;
 if not exists(select 1 from public.profiles where id=current_setting('mediapp.qa_patient')::uuid and assigned_center_id=current_setting('mediapp.qa_center')::uuid) then raise exception 'TEST_CENTER_ASSIGNMENT_MISSING';end if;
end$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from fixture_accounts where kind='doctor'),'role','authenticated','aal','aal1')::text,true);
set local role authenticated;
do $$begin
 if not exists(select 1 from public.patient_clinicians where patient_id=current_setting('mediapp.qa_patient')::uuid and clinician_id=auth.uid() and active) then raise exception 'TEST_DOCTOR_WORKSPACE_RLS';end if;
 if not exists(select 1 from public.profiles where id=current_setting('mediapp.qa_patient')::uuid) then raise exception 'TEST_DOCTOR_PROFILE_RLS';end if;
end$$;
rollback;
select 'PASS: center acceptance links only active approved center clinicians; nonmedical managers gain no clinical role; absent/revoked/inactive memberships excluded; disconnected links preserved; clinical RLS verified; all fixtures rolled back' as result;
