create function public.admin_create_center(p_name text) returns uuid
language plpgsql security definer set search_path='' as $$declare v uuid;begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role::text='Administrator' and account_active) or (auth.jwt()->>'aal') is distinct from 'aal2' then raise exception 'ADMIN_AAL2_REQUIRED';end if;
 if p_name is null or length(trim(p_name))<2 or length(trim(p_name))>120 then raise exception 'CENTER_NAME_REQUIRED';end if;
 insert into public.centers(name,code) values(trim(p_name),upper(replace(gen_random_uuid()::text,'-',''))) returning id into v;
 return v;end;$$;
revoke all on function public.admin_create_center(text) from public,anon;
grant execute on function public.admin_create_center(text) to authenticated;
