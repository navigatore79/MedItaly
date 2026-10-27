-- Authorized initial center configuration. Code is an identifier, not a password.
do $$begin
 if exists(select 1 from public.centers where code='0000' and name<>'Laboratorio di Emodinamica - PO Santa Maria delle Grazie di Pozzuoli - ASL NA 2 Nord') then
  raise exception 'CENTER_CODE_ALREADY_IN_USE';
 end if;
 insert into public.centers(name,code) values('Laboratorio di Emodinamica - PO Santa Maria delle Grazie di Pozzuoli - ASL NA 2 Nord','0000') on conflict(code) do nothing;
end$$;
