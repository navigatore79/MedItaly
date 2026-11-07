begin;
do $$begin
 if has_function_privilege('anon','public.imaging_processor_config()','EXECUTE') or has_function_privilege('authenticated','public.imaging_processor_config()','EXECUTE') or has_table_privilege('authenticated','private.imaging_processor_settings','SELECT') or has_function_privilege('authenticated','public.imaging_claim_delivery(uuid)','EXECUTE') then raise exception 'PROCESSOR_PRIVILEGE_LEAK';end if;
 if public.imaging_processor_config() is not null then raise exception 'PROCESSOR_UNEXPECTEDLY_ENABLED';end if;
 if public.imaging_claim_delivery('00000000-0000-0000-0000-000000000000') is not null then raise exception 'UNKNOWN_JOB_CLAIMED';end if;
end$$;
rollback;
select 'PASS: processor configuration and job claims private; processor disabled; unknown job not claimed' as result;
