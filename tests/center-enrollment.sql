begin;
select set_config('mediapp.enroll_patient',gen_random_uuid()::text,true);
select set_config('mediapp.enroll_other',gen_random_uuid()::text,true);
select set_config('mediapp.enroll_email','center-enroll-'||current_setting('mediapp.enroll_patient')||'@example.invalid',true);
select set_config('mediapp.enroll_admin',(select id::text from public.profiles where role::text='Administrator' and account_active limit 1),true);
select set_config('mediapp.enroll_center',(select id::text from public.centers where code='0000'),true);
insert into auth.users(id,email,raw_user_meta_data) values(current_setting('mediapp.enroll_patient')::uuid,current_setting('mediapp.enroll_email'),'{}');
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values(current_setting('mediapp.enroll_other')::uuid,'center-other-'||current_setting('mediapp.enroll_other')||'@example.invalid',now(),jsonb_build_object('email',current_setting('mediapp.enroll_email')));
insert into private.center_manager_enrollments(center_id,email,mfa_required,granted_by) values(current_setting('mediapp.enroll_center')::uuid,current_setting('mediapp.enroll_email'),false,current_setting('mediapp.enroll_admin')::uuid);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('mediapp.enroll_other'),'role','authenticated','aal','aal1','email',current_setting('mediapp.enroll_email'))::text,true);
set local role authenticated;
do $$begin
 if has_table_privilege('authenticated','private.center_manager_enrollments','SELECT') or has_table_privilege('authenticated','private.center_manager_enrollments','INSERT') then raise exception 'TEST_ENROLLMENTS_EXPOSED';end if;
 if exists(select 1 from public.list_my_managed_centers()) then raise exception 'TEST_OTHER_EMAIL_CLAIM';end if;
end$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('mediapp.enroll_patient'),'role','authenticated','aal','aal1')::text,true);
do $$begin
 if exists(select 1 from public.list_my_managed_centers()) then raise exception 'TEST_UNVERIFIED_EMAIL_CLAIM';end if;
end$$;
reset role;
update auth.users set email_confirmed_at=now() where id=current_setting('mediapp.enroll_patient')::uuid;
set local role authenticated;
do $$declare d jsonb;begin
 if not exists(select 1 from public.list_my_managed_centers() c where c.id=current_setting('mediapp.enroll_center')::uuid and not c.mfa_required) then raise exception 'TEST_VERIFIED_CLAIM';end if;
 perform public.list_my_managed_centers();
 if (select count(*) from public.center_managers where user_id=auth.uid())<>1 then raise exception 'TEST_DUPLICATE_CLAIM';end if;
 if (select role::text from public.profiles where id=auth.uid())<>'Patient' then raise exception 'TEST_CLINICAL_ROLE_GRANTED';end if;
 d:=public.center_management_dashboard(current_setting('mediapp.enroll_center')::uuid);
 if d->>'code'<>'0000' then raise exception 'TEST_PASSWORD_ONLY_ACCESS';end if;
 begin perform public.center_management_dashboard(gen_random_uuid());raise exception 'TEST_CROSS_CENTER';exception when others then if sqlerrm<>'CENTER_MANAGER_AAL2_REQUIRED' then raise;end if;end;
end$$;
reset role;
update public.center_managers set active=false where user_id=current_setting('mediapp.enroll_patient')::uuid;
set local role authenticated;
do $$begin
 if exists(select 1 from public.list_my_managed_centers()) then raise exception 'TEST_REVOKED_REACTIVATION';end if;
end$$;
rollback;
select 'PASS: only authoritative verified email claims its authorization; private enrollments hidden; password-only access scoped to one center; no clinical role, duplicate claim or reactivation; fixtures rolled back' as result;
