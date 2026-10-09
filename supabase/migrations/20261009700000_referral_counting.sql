-- Nouvelle règle de parrainage : un filleul compte quand il s'est inscrit avec le lien ET est allé au bout du parcours,
-- avec l'essai fait (demande remplie depuis le SMS reçu sur son portable : prouve que le numéro est réel).
-- Le SIRET du filleul n'est plus nécessaire. Règle définie une seule fois ici, utilisée par l'application et les vues.

create function public.referral_counts(p_tester uuid)
returns table (registered int, counted int)
language sql stable security definer set search_path = '' as $$
  select
    count(*)::int,
    count(*) filter (
      where f.completed_at is not null
        and exists (select 1 from public.leads l where l.artisan_id = f.artisan_id and l.form_submitted_at is not null)
    )::int
  from public.testers f
  where f.referred_by = p_tester
$$;
revoke execute on function public.referral_counts(uuid) from public, anon, authenticated;

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
         rc.counted as filleuls_comptes, rc.registered as filleuls_inscrits,
         (select count(distinct session_id) from public.funnel_events v where v.ref = t.referral_code and v.step = 'landing_view') as clics_sur_son_lien,
         p.first_name || ' ' || p.last_name as parraine_par,
         t.created_at as inscrit_le
  from public.testers t
  join public.artisans a on a.id = t.artisan_id
  left join public.testers p on p.id = t.referred_by
  cross join lateral public.referral_counts(t.id) rc
  order by t.created_at desc;

drop view public.launch_contacts;
create view public.launch_contacts with (security_invoker = true) as
  select t.first_name as prenom, t.last_name as nom, a.business_name as entreprise, a.owner_phone as portable,
         a.trade as metier, a.postal_code as code_postal, t.interest as interet,
         t.survey ->> 'would_pay' as pret_a_payer,
         case t.siret_status when 'verified' then 'vérifié' when 'pending_manual' then 'à vérifier' when 'rejected' then 'refusé' else 'non fourni' end as siret,
         a.siret_company_name as raison_sociale, t.referral_code as code_parrainage,
         rc.counted as filleuls_comptes,
         a.test_drives_used > 0 as a_fait_l_essai, t.completed_at is not null as parcours_termine, t.created_at as inscrit_le
  from public.testers t join public.artisans a on a.id = t.artisan_id
  cross join lateral public.referral_counts(t.id) rc
  order by (t.interest = 'chaud') desc nulls last, t.created_at;

revoke all on public.analytics_testers, public.launch_contacts from anon, authenticated;
