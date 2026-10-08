-- Bilan du mois par SMS, le 1er à 9 h (heure de Paris). Même interrupteur que le récap du soir (daily_recap).

alter table public.artisans add column last_monthly_report text; -- mois (« AAAA-MM ») du dernier bilan envoyé

create function public.invoke_monthly_report() returns void language plpgsql security definer set search_path = '' as $$
declare
  project_url text := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url');
  cron_secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret');
begin
  if project_url is null or cron_secret is null then
    return;
  end if;
  perform net.http_post(
    url := project_url || '/functions/v1/monthly-report',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', cron_secret),
    body := '{}'::jsonb
  );
end $$;
revoke execute on function public.invoke_monthly_report() from public, anon, authenticated;

-- Le 1er du mois, toutes les 15 min entre 7 h et 8 h UTC (= 9 h à Paris en été comme en hiver).
select cron.schedule('monthly-report', '*/15 7-8 1 * *', 'select public.invoke_monthly_report()');
