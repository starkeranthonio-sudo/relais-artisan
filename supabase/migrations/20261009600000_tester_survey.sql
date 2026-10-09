-- Questions de qualification (entre l'essai et le SIRET) : mesurer l'intérêt réel, sur des faits vécus (Mom Test).
-- Chaque réponse est enregistrée dès qu'elle est donnée : on voit à quelle question les gens abandonnent.

alter table public.testers
  add column survey jsonb not null default '{}',     -- { "missed_calls": "3-5", "after_miss": "...", ... }
  add column survey_completed_at timestamptz,
  add column interest text check (interest in ('chaud', 'tiede', 'froid'));  -- calculé à la fin des questions

alter table public.funnel_events drop constraint funnel_events_step_check;
alter table public.funnel_events add constraint funnel_events_step_check check (step in (
  'landing_view', 'intro_next', 'info_submitted', 'test_sent', 'test_completed',
  'survey_answer',     -- une réponse donnée (props.q = identifiant de la question)
  'survey_completed',  -- toutes les questions répondues
  'siret_verified', 'siret_manual', 'siret_skipped', 'share_clicked', 'completed'
));

-- Entonnoir complet, question par question.
create or replace view public.analytics_testers_funnel with (security_invoker = true) as
  with s as (
    select case when step = 'survey_answer' then 'q:' || (props ->> 'q') else step end as k, count(distinct session_id) as visiteurs
    from public.funnel_events
    where created_at > now() - interval '30 days'
    group by 1
  )
  select etape, coalesce(s.visiteurs, 0) as visiteurs
  from (values
    (1, 'landing_view', '1. Page ouverte'),
    (2, 'intro_next', '2. Présentation lue → Suivant'),
    (3, 'info_submitted', '3. Infos remplies (inscrit)'),
    (4, 'test_sent', '4. Essai reçu'),
    (5, 'test_completed', '5. Demande d''essai remplie'),
    (6, 'q:missed_calls', '6.1 Question : appels manqués'),
    (7, 'q:after_miss', '6.2 Question : après un appel manqué'),
    (8, 'q:quotes_per_month', '6.3 Question : devis par mois'),
    (9, 'q:follow_up', '6.4 Question : relance des devis'),
    (10, 'q:would_pay', '6.5 Question : prêt à payer 39 €'),
    (11, 'survey_completed', '6. Questions terminées'),
    (12, 'siret_verified', '7a. SIRET vérifié'),
    (13, 'siret_manual', '7b. Photo de devis envoyée'),
    (14, 'siret_skipped', '7c. SIRET passé'),
    (15, 'completed', '8. Parcours terminé'),
    (16, 'share_clicked', '9. Lien partagé')
  ) as e(ordre, k, etape)
  left join s using (k)
  order by ordre;

-- Répartition des réponses, question par question.
create view public.analytics_survey with (security_invoker = true) as
  select q.key as question, q.value #>> '{}' as reponse, count(*) as testeurs
  from public.testers t, jsonb_each(t.survey) q
  where q.key <> 'free_text'
  group by 1, 2
  order by 1, 3 desc;

-- Ajout du niveau d'intérêt et des réponses dans les listes existantes.
drop view public.analytics_testers;
create view public.analytics_testers with (security_invoker = true) as
  select t.first_name || ' ' || t.last_name as nom, a.business_name as entreprise, a.trade as metier, a.postal_code as cp,
         a.owner_phone as portable, t.interest as interet, t.siret_status as siret, a.test_drives_used as essais,
         (select count(*) from public.funnel_events f where f.tester_id = t.id and f.step = 'test_completed') > 0 as essai_termine,
         t.survey_completed_at is not null as questions_terminees,
         t.survey ->> 'missed_calls' as appels_manques_semaine, t.survey ->> 'after_miss' as apres_appel_manque,
         t.survey ->> 'quotes_per_month' as devis_par_mois, t.survey ->> 'follow_up' as relance_devis,
         t.survey ->> 'would_pay' as pret_a_payer, t.survey ->> 'free_text' as commentaire,
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

drop view public.launch_contacts;
create view public.launch_contacts with (security_invoker = true) as
  select t.first_name as prenom, t.last_name as nom, a.business_name as entreprise, a.owner_phone as portable,
         a.trade as metier, a.postal_code as code_postal, t.interest as interet,
         t.survey ->> 'would_pay' as pret_a_payer,
         case t.siret_status when 'verified' then 'vérifié' when 'pending_manual' then 'à vérifier' when 'rejected' then 'refusé' else 'non fourni' end as siret,
         a.siret_company_name as raison_sociale, t.referral_code as code_parrainage,
         (select count(*) from public.testers f join public.artisans fa on fa.id = f.artisan_id
           where f.referred_by = t.id and fa.siret_verified_at is not null) as filleuls_verifies,
         a.test_drives_used > 0 as a_fait_l_essai, t.completed_at is not null as parcours_termine, t.created_at as inscrit_le
  from public.testers t join public.artisans a on a.id = t.artisan_id
  order by (t.interest = 'chaud') desc nulls last, t.created_at;

revoke all on public.analytics_testers_funnel, public.analytics_survey, public.analytics_testers, public.launch_contacts from anon, authenticated;
