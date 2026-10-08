-- Étape « essai terminé » de l'entonnoir : quand un testeur remplit la demande de son essai.
create function public.log_tester_test_completed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_tester uuid;
begin
  if new.form_submitted_at is not null and old.form_submitted_at is null then
    select id into v_tester from public.testers where artisan_id = new.artisan_id;
    if v_tester is not null then
      insert into public.funnel_events (tester_id, step, session_id) values (v_tester, 'test_completed', 'tester-' || v_tester);
    end if;
  end if;
  return new;
end $$;
create trigger leads_tester_test_completed after update of form_submitted_at on public.leads
  for each row execute function public.log_tester_test_completed();

-- Validation manuelle d'un SIRET (après avoir regardé la photo de devis), à lancer dans le SQL Editor :
--   select public.admin_validate_siret('<tester_id>', true, 'NOM OFFICIEL');   -- ou false pour refuser
create function public.admin_validate_siret(p_tester uuid, p_ok boolean, p_company text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_artisan uuid;
begin
  select artisan_id into v_artisan from public.testers where id = p_tester;
  if v_artisan is null then return 'testeur introuvable'; end if;
  if p_ok then
    update public.artisans set siret_verified_at = now(), siret_company_name = coalesce(p_company, siret_company_name) where id = v_artisan;
    update public.testers set siret_status = 'verified' where id = p_tester;
    return 'SIRET validé';
  end if;
  update public.testers set siret_status = 'rejected' where id = p_tester;
  return 'SIRET refusé';
end $$;
revoke execute on function public.admin_validate_siret(uuid, boolean, text) from public, anon, authenticated;
