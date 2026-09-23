-- Create the profile before its dependent clinician application in one auth trigger.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), 'Patient')
  on conflict (id) do nothing;

  if coalesce(new.raw_user_meta_data->>'requested_role', '') = 'Clinician' then
    insert into public.clinician_applications (
      user_id, full_name, phone, professional_registration_no, center_code, notes
    )
    values (
      new.id,
      coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), 'Medico'),
      nullif(new.raw_user_meta_data->>'phone', ''),
      coalesce(nullif(new.raw_user_meta_data->>'professional_registration_no', ''), 'DA_VERIFICARE'),
      nullif(new.raw_user_meta_data->>'center_code', ''),
      'Richiesta creata automaticamente dalla registrazione medico.'
    )
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$function$;

drop trigger if exists on_auth_user_clinician_application on auth.users;
drop function if exists private.handle_clinician_application_signup();
