begin;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from public.profiles where role::text='Administrator' and account_active limit 1),'role','authenticated','aal','aal2')::text,true);
select set_config('meditaly.test_admin',(auth.uid())::text,true);
select set_config('meditaly.test_patient','a5b26902-c819-41ec-a154-0e00f5fb2f7f',true);
set local role authenticated;
select set_config('meditaly.test_center',public.admin_create_center('Centro verifica transazionale')::text,true);
select set_config('meditaly.other_center',public.admin_create_center('Altro centro verifica transazionale')::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('meditaly.test_patient'),'role','authenticated','aal','aal2')::text,true);
do $$begin
 begin perform public.center_management_dashboard(current_setting('meditaly.test_center')::uuid);raise exception 'TEST_FAILED_UNAUTHORIZED_MANAGER';exception when others then if sqlerrm<>'CENTER_MANAGER_AAL2_REQUIRED' then raise;end if;end;
 begin perform public.patient_choose_initial_doctor(null);raise exception 'TEST_FAILED_EMPTY_REFERENCE';exception when others then if sqlerrm<>'DOCTOR_OR_CENTER_REQUIRED' then raise;end if;end;
 perform public.patient_choose_initial_center(current_setting('meditaly.test_center')::uuid);
end$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('meditaly.test_admin'),'role','authenticated','aal','aal2')::text,true);
select public.admin_set_center_manager(current_setting('meditaly.test_center')::uuid,current_setting('meditaly.test_patient')::uuid,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('meditaly.test_patient'),'role','authenticated','aal','aal2')::text,true);
do $$declare d jsonb; r uuid;begin
 d:=public.center_management_dashboard(current_setting('meditaly.test_center')::uuid);
 if jsonb_array_length(d->'requests')<>1 then raise exception 'TEST_FAILED_REQUEST';end if;
 r:=(d->'requests'->0->>'id')::uuid;perform public.center_respond_patient_request(r,true);
 d:=public.center_management_dashboard(current_setting('meditaly.test_center')::uuid);
 if jsonb_array_length(d->'patients')<>1 then raise exception 'TEST_FAILED_ACCEPTANCE';end if;
 begin perform public.center_management_dashboard(current_setting('meditaly.other_center')::uuid);raise exception 'TEST_FAILED_CROSS_CENTER';exception when others then if sqlerrm<>'CENTER_MANAGER_AAL2_REQUIRED' then raise;end if;end;
end$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('meditaly.test_patient'),'role','authenticated','aal','aal1')::text,true);
do $$begin
 begin perform public.center_management_dashboard(current_setting('meditaly.test_center')::uuid);raise exception 'TEST_FAILED_AAL1';exception when others then if sqlerrm<>'CENTER_MANAGER_AAL2_REQUIRED' then raise;end if;end;
 if has_table_privilege('authenticated','public.clinician_patient_activity','SELECT') then raise exception 'TEST_FAILED_ACTIVITY_VISIBLE';end if;
end$$;
rollback;
select 'PASS: empty reference, unauthorized manager, nonmedical manager, center acceptance, cross-center rejection, MFA and private audit; all fixture changes rolled back' as result;
