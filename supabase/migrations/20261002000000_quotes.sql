-- Étape 3 : relance automatique des devis à J+3, J+7, J+14 (arrêt dès que le client répond).

create table public.quotes (
  id                 uuid primary key default gen_random_uuid(),
  artisan_id         uuid not null references public.artisans (id) on delete cascade,
  lead_id            uuid not null unique references public.leads (id) on delete cascade, -- un devis par demande en V1
  amount_cents       int check (amount_cents >= 0),        -- montant HT, sert au bilan du mois
  status             text not null default 'pending' check (status in ('pending', 'won', 'lost')),
  sent_at            timestamptz not null default now(),   -- date d'envoi du devis au client (déclarée par l'artisan)
  followups_sent     int not null default 0 check (followups_sent between 0 and 3),
  next_followup_at   timestamptz,                          -- null = plus aucune relance prévue
  stop_reason        text check (stop_reason in ('client_replied', 'opted_out', 'completed', 'closed')),
  decided_at         timestamptz,                          -- date à laquelle l'artisan a marqué gagné / perdu
  created_at         timestamptz not null default now()
);
create index quotes_due_idx on public.quotes (next_followup_at) where status = 'pending' and next_followup_at is not null;

-- À la création : l'artisan est celui de la demande, première relance à J+3.
create function public.quotes_before_insert() returns trigger language plpgsql as $$
begin
  select artisan_id into new.artisan_id from public.leads where id = new.lead_id;
  new.status := 'pending';
  new.followups_sent := 0;
  new.stop_reason := null;
  new.next_followup_at := new.sent_at + interval '3 days';
  return new;
end $$;
create trigger quotes_before_insert before insert on public.quotes
  for each row execute function public.quotes_before_insert();

-- Devis gagné ou perdu : les relances s'arrêtent.
create function public.quotes_before_update() returns trigger language plpgsql as $$
begin
  if new.status <> 'pending' and old.status = 'pending' then
    new.next_followup_at := null;
    new.stop_reason := coalesce(new.stop_reason, 'closed');
    new.decided_at := now();
  end if;
  return new;
end $$;
create trigger quotes_before_update before update on public.quotes
  for each row execute function public.quotes_before_update();

alter table public.quotes enable row level security;

create policy "artisan lit ses devis" on public.quotes
  for select using (artisan_id in (select id from public.artisans where user_id = auth.uid()));
create policy "artisan déclare un devis sur ses demandes" on public.quotes
  for insert with check (lead_id in (
    select l.id from public.leads l join public.artisans a on a.id = l.artisan_id where a.user_id = auth.uid()
  ));
create policy "artisan met à jour ses devis" on public.quotes
  for update using (artisan_id in (select id from public.artisans where user_id = auth.uid()));

-- L'artisan ne peut modifier que le statut et le montant ; le planning des relances est géré par le serveur.
revoke insert, update on public.quotes from authenticated;
grant insert (lead_id, amount_cents, sent_at) on public.quotes to authenticated;
grant update (status, amount_cents) on public.quotes to authenticated;

-- Planificateur : toutes les 15 minutes, appelle l'Edge Function quote-followups.
-- Les secrets (URL du projet, secret partagé) sont dans Supabase Vault, jamais dans le code.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create function public.invoke_quote_followups() returns void language plpgsql security definer set search_path = '' as $$
declare
  project_url text := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url');
  cron_secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret');
begin
  if project_url is null or cron_secret is null then
    return; -- pas encore configuré
  end if;
  perform net.http_post(
    url := project_url || '/functions/v1/quote-followups',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', cron_secret),
    body := '{}'::jsonb
  );
end $$;
revoke execute on function public.invoke_quote_followups() from public, anon, authenticated;

select cron.schedule('quote-followups', '*/15 * * * *', 'select public.invoke_quote_followups()');
