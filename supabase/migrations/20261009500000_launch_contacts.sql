-- Liste des testeurs à prévenir à l'ouverture (SQL Editor → exporter en CSV).
-- Base légale : ils se sont inscrits au programme de test et le SMS de fin de parcours annonce ce contact.
create view public.launch_contacts with (security_invoker = true) as
  select t.first_name as prenom, t.last_name as nom, a.business_name as entreprise, a.owner_phone as portable,
         a.trade as metier, a.postal_code as code_postal,
         case t.siret_status when 'verified' then 'vérifié' when 'pending_manual' then 'à vérifier' when 'rejected' then 'refusé' else 'non fourni' end as siret,
         a.siret_company_name as raison_sociale,
         t.referral_code as code_parrainage,
         (select count(*) from public.testers f join public.artisans fa on fa.id = f.artisan_id
           where f.referred_by = t.id and fa.siret_verified_at is not null) as filleuls_verifies,
         a.test_drives_used > 0 as a_fait_l_essai,
         t.completed_at is not null as parcours_termine,
         t.created_at as inscrit_le
  from public.testers t join public.artisans a on a.id = t.artisan_id
  order by t.created_at;
revoke all on public.launch_contacts from anon, authenticated;
