-- Prospection des artisans (fondateur) : liste saisie à la main (Google Maps, Leboncoin, Pages Jaunes…),
-- messages envoyés un par un depuis son propre téléphone (SMS / WhatsApp), lien personnel par prospect pour le suivi.
-- Chaque compte ne voit que ses propres prospects.

create table public.prospects (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  code              text not null unique default public.new_referral_code(), -- lien /testeurs?p=<code>
  business_name     text not null check (length(business_name) between 1 and 100),
  first_name        text check (length(first_name) <= 50),
  trade             text check (length(trade) <= 60),
  city              text check (length(city) <= 60),
  phone             text not null check (phone ~ '^\+33[1-9]\d{8}$'),
  source            text not null default 'google_maps' check (source in ('google_maps', 'leboncoin', 'pages_jaunes', 'autre')),
  status            text not null default 'nouveau' check (status in ('nouveau', 'contacte', 'interesse', 'pas_interesse', 'stop')),
  contact_count     int not null default 0,                -- 1 = premier message, 2 = relance
  last_contacted_at timestamptz,
  last_channel      text check (last_channel in ('sms', 'whatsapp', 'appel')),
  notes             text check (length(notes) <= 500),
  created_at        timestamptz not null default now(),
  unique (owner_id, phone)
);
create index prospects_owner_idx on public.prospects (owner_id, created_at desc);
alter table public.prospects enable row level security;
create policy "mes prospects" on public.prospects for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
revoke all on public.prospects from anon;
grant select, insert, update, delete on public.prospects to authenticated;

-- Le testeur arrivé par le lien d'un prospect (rempli par l'Edge Function « testers »).
alter table public.testers add column prospect_code text check (prospect_code is null or prospect_code ~ '^[a-z0-9]{6,10}$');
create index testers_prospect_code_idx on public.testers (prospect_code) where prospect_code is not null;

-- Avancement de chaque prospect du compte connecté : a cliqué, s'est inscrit, a fait l'essai, est allé au bout.
create function public.my_prospect_progress()
returns table (code text, clicked boolean, registered boolean, test_done boolean, completed boolean)
language sql stable security definer set search_path = '' as $$
  select p.code,
    exists (select 1 from public.funnel_events e where e.step = 'landing_view' and e.props ->> 'prospect' = p.code),
    t.id is not null,
    coalesce(exists (select 1 from public.leads l where l.artisan_id = t.artisan_id and l.form_submitted_at is not null), false),
    t.completed_at is not null
  from public.prospects p
  left join lateral (
    select x.id, x.artisan_id, x.completed_at from public.testers x where x.prospect_code = p.code order by x.created_at limit 1
  ) t on true
  where p.owner_id = (select auth.uid())
$$;
revoke execute on function public.my_prospect_progress() from public, anon;
grant execute on function public.my_prospect_progress() to authenticated;

-- Tableau de bord (SQL Editor) : efficacité par source.
create view public.analytics_prospection with (security_invoker = true) as
  with p as (
    select p.source, p.status, p.contact_count, p.code,
      exists (select 1 from public.funnel_events e where e.step = 'landing_view' and e.props ->> 'prospect' = p.code) as clicked,
      exists (select 1 from public.testers t where t.prospect_code = p.code) as registered,
      exists (select 1 from public.testers t where t.prospect_code = p.code and t.completed_at is not null) as completed
    from public.prospects p
  )
  select source,
    count(*) as dans_la_liste,
    count(*) filter (where contact_count > 0) as contactes,
    count(*) filter (where clicked) as ont_clique,
    count(*) filter (where registered) as inscrits,
    count(*) filter (where completed) as parcours_termines,
    count(*) filter (where status = 'interesse') as interesses,
    count(*) filter (where status = 'stop') as stop
  from p group by source order by contactes desc;
revoke all on public.analytics_prospection from anon, authenticated;
