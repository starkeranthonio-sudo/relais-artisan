-- Programme « Testeurs fondateurs » : inscription avec métier et code postal, essai simulé, SIRET vérifié,
-- paliers de parrainage (seuls les filleuls au SIRET vérifié comptent).

alter table public.artisans
  add column trade text,                         -- métier déclaré (plombier, électricien…)
  add column postal_code text check (postal_code is null or postal_code ~ '^[0-9]{5}$'),
  add column siret text unique check (siret is null or siret ~ '^[0-9]{14}$'),
  add column siret_company_name text,            -- nom officiel renvoyé par la base Sirene
  add column siret_verified_at timestamptz,      -- renseigné uniquement par le serveur après vérification
  add column test_drives_used int not null default 0;
grant update (trade, postal_code) on public.artisans to authenticated;

-- Inscription email : métier et code postal viennent du formulaire.
create or replace function public.handle_new_artisan() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.raw_user_meta_data ? 'business_name' then
    insert into public.artisans (user_id, business_name, owner_phone, referred_by, trade, postal_code)
    values (
      new.id,
      left(trim(new.raw_user_meta_data ->> 'business_name'), 100),
      coalesce(new.raw_user_meta_data ->> 'owner_phone', ''),
      (select id from public.artisans where referral_code = lower(trim(new.raw_user_meta_data ->> 'referral_code'))),
      left(new.raw_user_meta_data ->> 'trade', 60),
      case when (new.raw_user_meta_data ->> 'postal_code') ~ '^[0-9]{5}$' then new.raw_user_meta_data ->> 'postal_code' end
    );
  end if;
  return new;
end $$;

-- Inscription Google / Apple : même chose via l'écran « Bienvenue ».
drop function public.create_my_artisan(text, text, text);
create function public.create_my_artisan(
  p_business_name text, p_owner_phone text, p_referral_code text default null, p_trade text default null, p_postal_code text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  if length(trim(coalesce(p_business_name, ''))) < 2 then raise exception 'Nom d''entreprise trop court'; end if;
  if coalesce(p_owner_phone, '') !~ '^\+33[1-9][0-9]{8}$' then raise exception 'Numéro de portable invalide'; end if;
  select id into v_id from public.artisans where user_id = auth.uid();
  if v_id is not null then return v_id; end if;
  insert into public.artisans (user_id, business_name, owner_phone, referred_by, trade, postal_code)
  values (
    auth.uid(), left(trim(p_business_name), 100), p_owner_phone,
    (select id from public.artisans where referral_code = lower(trim(p_referral_code))),
    left(p_trade, 60),
    case when p_postal_code ~ '^[0-9]{5}$' then p_postal_code end
  )
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.create_my_artisan(text, text, text, text, text) from public, anon;
grant execute on function public.create_my_artisan(text, text, text, text, text) to authenticated;

-- Parrainages de l'artisan connecté, avec l'état de vérification (pour les paliers).
drop view public.my_referrals;
create view public.my_referrals with (security_invoker = false) as
  select r.id, r.business_name, r.created_at, r.siret_verified_at is not null as verified
  from public.artisans r
  join public.artisans me on me.id = r.referred_by
  where me.user_id = auth.uid();
grant select on public.my_referrals to authenticated;

-- Nouvelles mesures d'usage.
alter table public.events drop constraint events_name_check;
alter table public.events add constraint events_name_check check (name in (
  'app_open', 'lead_view', 'lead_call', 'lead_sms', 'quote_declared', 'quote_won', 'quote_lost',
  'transfer_sent', 'referral_share', 'stats_view', 'sms_template_saved', 'review_requested',
  'test_drive', 'siret_verified'
));

-- Ton tableau de suivi (SQL Editor) : où en est la validation avant de créer la société.
create view public.analytics_validation with (security_invoker = true) as
  select
    count(*) filter (where user_id is not null)                                   as inscrits,
    count(*) filter (where test_drives_used > 0)                                   as ont_fait_l_essai,
    count(*) filter (where siret_verified_at is not null)                          as siret_verifies,
    count(*) filter (where referred_by is not null)                                as venus_par_parrainage,
    count(*) filter (where referred_by is not null and siret_verified_at is not null) as parrainages_verifies,
    count(distinct referred_by)                                                    as artisans_qui_ont_parraine
  from public.artisans;
revoke all on public.analytics_validation from authenticated, anon;
