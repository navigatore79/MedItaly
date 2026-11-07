-- Vercel receives only an imaging-scoped service credential, never the Supabase service-role key.
create table private.imaging_processor_settings (
 id boolean primary key default true check(id),
 url text not null check(url='https://med-italy.vercel.app/api/imaging-process'),
 secret text not null check(length(secret)>=64), enabled boolean not null default false
);
alter table private.imaging_processor_settings enable row level security;
revoke all on private.imaging_processor_settings from public,anon,authenticated;
grant all on private.imaging_processor_settings to service_role;
create function public.imaging_processor_config() returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(s)-'id' from private.imaging_processor_settings s where id and enabled;
$$;
create function public.imaging_claim_delivery(p_delivery uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.imaging_deliveries;begin
 select * into d from public.imaging_deliveries where id=p_delivery for update;
 if d.id is null then return null;end if;
 if d.status='processing' and d.lease_until<now() and d.attempts>=5 then
  update public.imaging_deliveries set status='failed',reason='RETRIES_EXHAUSTED',lease_token=null,lease_until=null where id=d.id;return null;
 end if;
 if not (d.status='queued' or (d.status='processing' and d.lease_until<now())) or d.attempts>=5 then return null;end if;
 if not exists(select 1 from public.imaging_sources where id=d.source_id and active) then return null;end if;
 update public.imaging_deliveries set status='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '8 minutes' where id=d.id returning * into d;
 return to_jsonb(d);
end$$;
revoke all on function public.imaging_processor_config(),public.imaging_claim_delivery(uuid) from public,anon,authenticated;
grant execute on function public.imaging_processor_config(),public.imaging_claim_delivery(uuid) to service_role;
