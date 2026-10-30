-- The inbox is read-only and follows the caller's existing table RLS.
-- No global recent-message limit: quiet patients and all unread counts remain visible.
create function public.clinician_conversation_summaries() returns jsonb
language sql stable security invoker set search_path='' as $$
 with caller as (
  select p.id from public.profiles p where p.id=(select auth.uid())
   and p.account_active and p.role::text in ('Clinician','Administrator')
 ), conversations as (
  select pc.patient_id,p.full_name,last_message.body as last_body,
   last_message.sent_at as last_sent_at,last_message.sender_id as last_sender_id,
   coalesce(last_message.has_audio,false) as has_audio,
   (select count(*) from public.chat_messages unread
     where unread.sender_id=pc.patient_id and unread.recipient_id=c.id and not unread.is_read) as unread_count
  from caller c join public.patient_clinicians pc on pc.clinician_id=c.id and pc.active
  join public.profiles p on p.id=pc.patient_id and p.account_active
   and p.role::text in ('Patient','Administrator') and p.id<>c.id
  left join lateral (
   select recent.id,recent.body,recent.sent_at,recent.sender_id,recent.has_audio from (
    (select m.id,left(m.body,240) as body,m.sent_at,m.sender_id,m.audio_path is not null as has_audio
     from public.chat_messages m where m.sender_id=c.id and m.recipient_id=pc.patient_id
     order by m.sent_at desc,m.id desc limit 1)
    union all
    (select m.id,left(m.body,240) as body,m.sent_at,m.sender_id,m.audio_path is not null as has_audio
     from public.chat_messages m where m.sender_id=pc.patient_id and m.recipient_id=c.id
     order by m.sent_at desc,m.id desc limit 1)
   ) recent order by recent.sent_at desc,recent.id desc limit 1
  ) last_message on true
 )
 select coalesce(jsonb_agg(to_jsonb(conversations) order by last_sent_at desc nulls last,lower(full_name),patient_id),'[]'::jsonb)
 from conversations;
$$;
revoke all on function public.clinician_conversation_summaries() from public,anon;
grant execute on function public.clinician_conversation_summaries() to authenticated;
