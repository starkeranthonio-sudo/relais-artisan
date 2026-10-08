-- SMS récapitulatif de 18 h.

alter table public.artisans
  add column daily_recap boolean not null default true,  -- l'artisan peut le désactiver dans ses Réglages
  add column last_recap_on date;                         -- jour (Paris) du dernier récap traité : un seul par jour
grant update (daily_recap) on public.artisans to authenticated;

create function public.invoke_daily_recap() returns void language plpgsql security definer set search_path = '' as $$
declare
  project_url text := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url');
  cron_secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret');
begin
  if project_url is null or cron_secret is null then
    return;
  end if;
  perform net.http_post(
    url := project_url || '/functions/v1/daily-recap',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', cron_secret),
    body := '{}'::jsonb
  );
end $$;
revoke execute on function public.invoke_daily_recap() from public, anon, authenticated;

-- Toutes les 15 min entre 15 h et 18 h UTC : couvre 18 h à Paris en heure d'été (UTC+2) comme d'hiver (UTC+1).
-- La fonction n'envoie qu'entre 18 h et 19 h heure de Paris, et une seule fois par jour.
select cron.schedule('daily-recap', '*/15 15-18 * * 1-6', 'select public.invoke_daily_recap()');
