-- Messaggi del contatto Test Medico: solo ai pazienti che lo hanno scelto.
-- La scrittura di conversazione, notifica e coda push è una sola transazione.
create or replace function private.test_support_send_message_push_impl(p_patient uuid,p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := (select auth.uid());
  v_notification uuid;
  v_outbox uuid;
begin
  if v_admin is null or not exists (
    select 1 from public.profiles a
    where a.id=v_admin and a.role::text='Administrator' and a.account_active
  ) then raise exception 'TEST_SUPPORT_ADMIN_REQUIRED'; end if;
  if not exists (
    select 1 from public.patient_care_contacts c
    join public.profiles p on p.id=c.patient_id
    where c.patient_id=p_patient and c.test_support_admin_id=v_admin
      and c.initial_choice='test' and c.choice_completed_at is not null
      and p.role::text='Patient' and p.account_active
  ) then raise exception 'TEST_PATIENT_CHOICE_REQUIRED'; end if;
  if p_body is null or length(btrim(p_body))=0 or length(p_body)>4000
    then raise exception 'INVALID_MESSAGE_BODY'; end if;

  insert into public.chat_messages(sender_id,recipient_id,body)
    values(v_admin,p_patient,btrim(p_body));
  insert into public.notifications(patient_id,sender_id,title,message,notification_type,is_read)
    values(p_patient,v_admin,'Nuovo messaggio',btrim(p_body),'Custom Message'::public.notification_type,false)
    returning id into v_notification;
  insert into public.push_outbox(user_id,notification_id,title,body,status)
    values(p_patient,v_notification,'Meditaly','Hai un messaggio su Meditaly','pending')
    returning id into v_outbox;
  return v_outbox;
end $$;
revoke all on function private.test_support_send_message_push_impl(uuid,text) from public,anon,authenticated;
grant execute on function private.test_support_send_message_push_impl(uuid,text) to authenticated;
create or replace function public.test_support_send_message_push(p_patient uuid,p_body text)
returns uuid language sql set search_path = '' as $$
  select private.test_support_send_message_push_impl(p_patient,p_body)
$$;
revoke all on function public.test_support_send_message_push(uuid,text) from public,anon;
grant execute on function public.test_support_send_message_push(uuid,text) to authenticated;

create policy "test support reads own opted in notifications"
on public.notifications for select to authenticated using (
  sender_id=(select auth.uid()) and exists (
    select 1 from public.patient_care_contacts c
    where c.patient_id=notifications.patient_id
      and c.test_support_admin_id=(select auth.uid())
      and c.initial_choice='test' and c.choice_completed_at is not null
  )
);
create policy "test support reads own opted in push outcomes"
on public.push_outbox for select to authenticated using (
  exists (
    select 1 from public.notifications n
    join public.patient_care_contacts c on c.patient_id=n.patient_id
    where n.id=push_outbox.notification_id and n.sender_id=(select auth.uid())
      and n.patient_id=push_outbox.user_id and c.test_support_admin_id=(select auth.uid())
      and c.initial_choice='test' and c.choice_completed_at is not null
  )
);
