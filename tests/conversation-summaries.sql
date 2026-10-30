begin;
-- Synthetic users and conversations only. Nothing is committed or delivered.
create temp table conversation_fixture(kind text,id uuid default gen_random_uuid());
insert into conversation_fixture(kind) values('doctor'),('other_doctor'),('busy'),('quiet'),('silent'),('disconnected'),('inactive'),('manager');
insert into auth.users(id,email,raw_user_meta_data)
 select id,'inbox-qa-'||id||'@example.invalid',jsonb_build_object('full_name','Verifica inbox '||kind) from conversation_fixture;
update public.profiles p set role='Clinician' from conversation_fixture f where p.id=f.id and f.kind in ('doctor','other_doctor');
update public.profiles p set account_active=false from conversation_fixture f where p.id=f.id and f.kind='inactive';
insert into public.patient_clinicians(patient_id,clinician_id,active)
 select p.id,d.id,p.kind<>'disconnected' from conversation_fixture p cross join conversation_fixture d
 where d.kind='doctor' and p.kind in ('busy','quiet','silent','disconnected','inactive');
insert into public.patient_clinicians(patient_id,clinician_id)
 select p.id,d.id from conversation_fixture p cross join conversation_fixture d where p.kind='busy' and d.kind='other_doctor';
insert into public.chat_messages(sender_id,recipient_id,body,sent_at,is_read)
 select p.id,d.id,'Comunicazione di verifica '||n,now()-interval '2 hours'+n*interval '1 second',false
 from conversation_fixture p cross join conversation_fixture d cross join generate_series(1,1205) n where p.kind='busy' and d.kind='doctor';
insert into public.chat_messages(sender_id,recipient_id,body,sent_at,is_read)
 select d.id,p.id,'Ultima comunicazione inviata',now()-interval '1 minute',false
 from conversation_fixture p cross join conversation_fixture d where p.kind='busy' and d.kind='doctor';
-- Metadata for a transaction-only audio fixture; no file is uploaded.
insert into storage.objects(bucket_id,name)
 select 'chat-voice',p.id||'/'||d.id||'/'||p.id||'.webm' from conversation_fixture p cross join conversation_fixture d where p.kind='quiet' and d.kind='doctor';
insert into public.chat_messages(sender_id,recipient_id,body,sent_at,is_read,audio_path,audio_mime,audio_duration_seconds)
 select p.id,d.id,'Messaggio vocale',now()-interval '20 days',false,p.id||'/'||d.id||'/'||p.id||'.webm','audio/webm',3
 from conversation_fixture p cross join conversation_fixture d where p.kind='quiet' and d.kind='doctor';
insert into public.chat_messages(sender_id,recipient_id,body,sent_at,is_read)
 select d.id,p.id,'Conversazione riservata al secondo medico',now(),false
 from conversation_fixture p cross join conversation_fixture d where p.kind='busy' and d.kind='other_doctor';
select set_config('inbox.qa_doctor',(select id::text from conversation_fixture where kind='doctor'),true);
select set_config('inbox.qa_other',(select id::text from conversation_fixture where kind='other_doctor'),true);
select set_config('inbox.qa_busy',(select id::text from conversation_fixture where kind='busy'),true);
select set_config('inbox.qa_quiet',(select id::text from conversation_fixture where kind='quiet'),true);
select set_config('inbox.qa_manager',(select id::text from conversation_fixture where kind='manager'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('inbox.qa_doctor'),'role','authenticated','aal','aal1')::text,true);
set local role authenticated;
do $$declare data jsonb;row jsonb;begin
 if has_function_privilege('anon','public.clinician_conversation_summaries()','EXECUTE') then raise exception 'TEST_ANON_PRIVILEGE';end if;
 data:=public.clinician_conversation_summaries();
 if jsonb_array_length(data)<>3 then raise exception 'TEST_ACTIVE_PATIENT_SET: %',data;end if;
 if data->0->>'patient_id'<>current_setting('inbox.qa_busy') then raise exception 'TEST_RECENT_ORDER';end if;
 if data->0->>'last_body'<>'Ultima comunicazione inviata' or data->0->>'last_sender_id'<>current_setting('inbox.qa_doctor') then raise exception 'TEST_PAIR_ISOLATION';end if;
 if (data->0->>'unread_count')::int<>1205 then raise exception 'TEST_UNREAD_TRUNCATION';end if;
 select value into row from jsonb_array_elements(data) where value->>'patient_id'=current_setting('inbox.qa_quiet');
 if row is null or (row->>'unread_count')::int<>1 or (row->>'has_audio')::boolean is not true then raise exception 'TEST_QUIET_AUDIO_PATIENT';end if;
 if data->2->>'last_sent_at' is not null then raise exception 'TEST_SILENT_PATIENT';end if;
end$$;
update public.chat_messages set is_read=true,read_at=now()
 where id=(select id from public.chat_messages where sender_id=current_setting('inbox.qa_busy')::uuid and recipient_id=auth.uid() and not is_read order by sent_at limit 1)
 and recipient_id=auth.uid();
do $$declare data jsonb;begin
 data:=public.clinician_conversation_summaries();
 if (data->0->>'unread_count')::int<>1204 then raise exception 'TEST_READ_RECEIPT_COUNT';end if;
end$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('inbox.qa_other'),'role','authenticated','aal','aal1')::text,true);
do $$declare data jsonb;begin
 data:=public.clinician_conversation_summaries();
 if jsonb_array_length(data)<>1 or data->0->>'last_body'<>'Conversazione riservata al secondo medico' or (data->0->>'unread_count')::int<>0 then raise exception 'TEST_OTHER_DOCTOR_ISOLATION';end if;
end$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('inbox.qa_busy'),'role','authenticated','aal','aal1')::text,true);
do $$begin if public.clinician_conversation_summaries()<>'[]'::jsonb then raise exception 'TEST_PATIENT_ACCESS';end if;end$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('inbox.qa_manager'),'role','authenticated','aal','aal1')::text,true);
do $$begin if public.clinician_conversation_summaries()<>'[]'::jsonb then raise exception 'TEST_NONMEDICAL_ACCESS';end if;end$$;
reset role;
update public.profiles set account_active=false where id=current_setting('inbox.qa_doctor')::uuid;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('inbox.qa_doctor'),'role','authenticated','aal','aal1')::text,true);
set local role authenticated;
do $$begin if public.clinician_conversation_summaries()<>'[]'::jsonb then raise exception 'TEST_INACTIVE_DOCTOR_ACCESS';end if;end$$;
rollback;
select 'PASS: exact unread counts over 1200 messages; quiet and no-message patients retained; latest incoming/outgoing pair only; audio summarized; disconnected/inactive patients excluded; doctor, patient and nonmedical role isolation enforced; fixtures rolled back' as result;
