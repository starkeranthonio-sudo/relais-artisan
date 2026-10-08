-- Mesure des usages (Habit Testing) : chaque action importante de l'artisan est enregistrée ici.
-- Données internes uniquement (pas d'outil tiers, pas de cookie publicitaire).

create table public.events (
  id          bigint generated always as identity primary key,
  artisan_id  uuid not null references public.artisans (id) on delete cascade,
  name        text not null check (name in (
    'app_open',          -- ouverture de l'espace artisan (props.source = 'sms' si ouvert depuis un SMS)
    'lead_view',         -- fiche d'une demande ouverte
    'lead_call',         -- clic sur « Appeler »
    'lead_sms',          -- clic sur « SMS »
    'quote_declared',    -- « J'ai envoyé un devis »
    'quote_won',
    'quote_lost',
    'transfer_sent',     -- demande transmise à un confrère
    'referral_share',    -- lien de parrainage partagé
    'stats_view'         -- bilan du mois consulté
  )),
  props       jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index events_artisan_time_idx on public.events (artisan_id, created_at desc);
create index events_name_time_idx on public.events (name, created_at desc);

alter table public.events enable row level security;
-- L'artisan peut seulement écrire ses propres événements ; personne ne les lit depuis l'application.
create policy "artisan enregistre ses événements" on public.events
  for insert to authenticated
  with check (artisan_id in (select id from public.artisans where user_id = auth.uid()));
revoke select, update, delete on public.events from authenticated, anon;

-- Tableaux de bord (à lire avec le compte propriétaire du projet, dans le SQL Editor).

-- Habitude : sur les 7 derniers jours, combien de jours différents chaque artisan a ouvert l'outil.
create view public.analytics_weekly_habit with (security_invoker = true) as
  select a.business_name,
         count(distinct date_trunc('day', e.created_at)) filter (where e.name = 'app_open') as jours_actifs_7j,
         count(*) filter (where e.name = 'app_open' and e.props ->> 'source' = 'sms')        as ouvertures_depuis_sms,
         count(*) filter (where e.name = 'lead_call')                                       as appels_clients,
         count(*) filter (where e.name = 'quote_declared')                                  as devis_declares,
         max(e.created_at)                                                                  as derniere_activite
  from public.artisans a
  left join public.events e on e.artisan_id = a.id and e.created_at > now() - interval '7 days'
  group by a.id, a.business_name
  order by jours_actifs_7j desc;

-- Entonnoir global : de la demande reçue au devis gagné.
create view public.analytics_funnel with (security_invoker = true) as
  select date_trunc('week', created_at)::date as semaine,
         count(*) filter (where name = 'lead_view')      as fiches_ouvertes,
         count(*) filter (where name = 'lead_call')      as appels,
         count(*) filter (where name = 'quote_declared') as devis,
         count(*) filter (where name = 'quote_won')      as gagnes
  from public.events
  group by 1
  order by 1 desc;

revoke all on public.analytics_weekly_habit, public.analytics_funnel from authenticated, anon;
