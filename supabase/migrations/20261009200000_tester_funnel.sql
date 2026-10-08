-- Parcours « Testeurs fondateurs » RelaisArti, sans compte ni mot de passe :
-- présentation → infos → essai → SIRET (ou photo d'un devis) → lien de parrainage.
-- Chaque testeur a une fiche artisans (sans utilisateur) pour réutiliser le vrai parcours SMS / demande.

create table public.testers (
  id              uuid primary key default gen_random_uuid(),
  artisan_id      uuid not null unique references public.artisans (id) on delete cascade,
  token           text not null unique,                 -- lien personnel envoyé par SMS (secret)
  referral_code   text not null unique default public.new_referral_code(),
  referred_by     uuid references public.testers (id) on delete set null,
  first_name      text not null,
  last_name       text not null,
  siret_status    text not null default 'none' check (siret_status in ('none', 'verified', 'pending_manual', 'rejected')),
  proof_path      text,                                 -- photo d'un devis (vérification manuelle)
  completed_at    timestamptz,                          -- parcours terminé (lien de parrainage obtenu)
  created_at      timestamptz not null default now()
);
alter table public.testers enable row level security; -- accès uniquement via l'Edge Function « testers »
revoke all on public.testers from anon, authenticated;

-- Photos de devis pour la vérification manuelle du SIRET (privé).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('siret-proofs', 'siret-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- Entonnoir : chaque étape franchie par un visiteur (anonyme : identifiant de session aléatoire du navigateur).
create table public.funnel_events (
  id          bigint generated always as identity primary key,
  session_id  text not null check (length(session_id) between 8 and 64),
  tester_id   uuid references public.testers (id) on delete set null,
  ref         text check (ref is null or length(ref) <= 32),  -- code du parrain si arrivé par un lien
  step        text not null check (step in (
    'landing_view',      -- a ouvert la page (lien partagé ou direct)
    'intro_next',        -- a lu la présentation et cliqué « Suivant »
    'info_submitted',    -- a rempli ses infos (inscrit)
    'test_sent',         -- a reçu le SMS d'essai
    'test_completed',    -- a rempli la demande d'essai (côté serveur)
    'siret_verified',    -- SIRET vérifié automatiquement
    'siret_manual',      -- a envoyé une photo de devis
    'siret_skipped',     -- a passé l'étape SIRET
    'share_clicked',     -- a partagé son lien (props.channel)
    'completed'          -- a terminé le parcours
  )),
  props       jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index funnel_events_step_idx on public.funnel_events (step, created_at);
alter table public.funnel_events enable row level security;
-- Le navigateur peut seulement ajouter des étapes « visiteur » ; les étapes liées à un testeur passent par le serveur.
create policy "visiteur enregistre ses étapes" on public.funnel_events
  for insert to anon, authenticated
  with check (tester_id is null and step in ('landing_view', 'intro_next', 'share_clicked'));
grant insert (session_id, ref, step, props) on public.funnel_events to anon, authenticated;
revoke select, update, delete on public.funnel_events from anon, authenticated;

-- ---------------------------------------------------------------- Tableaux de bord (SQL Editor)

-- Où les gens s'arrêtent : nombre de visiteurs distincts à chaque étape, sur les 30 derniers jours.
create view public.analytics_testers_funnel with (security_invoker = true) as
  with s as (
    select step, count(distinct session_id) as visiteurs
    from public.funnel_events
    where created_at > now() - interval '30 days'
    group by step
  )
  select etape, coalesce(s.visiteurs, 0) as visiteurs
  from (values
    (1, 'landing_view', '1. Page ouverte'),
    (2, 'intro_next', '2. Présentation lue → Suivant'),
    (3, 'info_submitted', '3. Infos remplies (inscrit)'),
    (4, 'test_sent', '4. Essai reçu'),
    (5, 'test_completed', '5. Demande d''essai remplie'),
    (6, 'siret_verified', '6a. SIRET vérifié'),
    (7, 'siret_manual', '6b. Photo de devis envoyée'),
    (8, 'siret_skipped', '6c. SIRET passé'),
    (9, 'completed', '7. Parcours terminé'),
    (10, 'share_clicked', '8. Lien partagé')
  ) as e(ordre, step, etape)
  left join s using (step)
  order by ordre;

-- Liste des testeurs, avec leur avancement et leurs parrainages.
create view public.analytics_testers with (security_invoker = true) as
  select t.first_name || ' ' || t.last_name as nom, a.business_name as entreprise, a.trade as metier, a.postal_code as cp,
         a.owner_phone as portable, t.siret_status as siret, a.test_drives_used as essais,
         (select count(*) from public.funnel_events f where f.tester_id = t.id and f.step = 'test_completed') > 0 as essai_termine,
         t.completed_at is not null as parcours_termine,
         (select count(*) from public.testers f join public.artisans fa on fa.id = f.artisan_id
           where f.referred_by = t.id and fa.siret_verified_at is not null) as filleuls_verifies,
         (select count(*) from public.testers f where f.referred_by = t.id) as filleuls_inscrits,
         (select count(distinct session_id) from public.funnel_events v where v.ref = t.referral_code and v.step = 'landing_view') as clics_sur_son_lien,
         p.first_name || ' ' || p.last_name as parraine_par,
         t.created_at as inscrit_le
  from public.testers t
  join public.artisans a on a.id = t.artisan_id
  left join public.testers p on p.id = t.referred_by
  order by t.created_at desc;

-- SIRET à vérifier à la main (photo de devis envoyée).
create view public.admin_siret_pending with (security_invoker = true) as
  select t.id as tester_id, t.first_name || ' ' || t.last_name as nom, a.business_name as entreprise, a.siret, t.proof_path, t.created_at
  from public.testers t join public.artisans a on a.id = t.artisan_id
  where t.siret_status = 'pending_manual'
  order by t.created_at;

revoke all on public.analytics_testers_funnel, public.analytics_testers, public.admin_siret_pending from anon, authenticated;
