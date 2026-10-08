-- Connexion avec Google / Apple : ces comptes n'ont ni nom d'entreprise ni portable à l'inscription.
-- L'artisan complète sa fiche une fois, au premier passage, via cette fonction (l'insertion directe reste interdite).

create function public.create_my_artisan(p_business_name text, p_owner_phone text, p_referral_code text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Non connecté';
  end if;
  if length(trim(coalesce(p_business_name, ''))) < 2 then
    raise exception 'Nom d''entreprise trop court';
  end if;
  if coalesce(p_owner_phone, '') !~ '^\+33[1-9][0-9]{8}$' then
    raise exception 'Numéro de portable invalide';
  end if;

  select id into v_id from public.artisans where user_id = auth.uid();
  if v_id is not null then
    return v_id; -- déjà créée (double clic, deux onglets…)
  end if;

  insert into public.artisans (user_id, business_name, owner_phone, referred_by)
  values (
    auth.uid(),
    left(trim(p_business_name), 100),
    p_owner_phone,
    (select id from public.artisans where referral_code = lower(trim(p_referral_code)))
  )
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.create_my_artisan(text, text, text) from public, anon;
grant execute on function public.create_my_artisan(text, text, text) to authenticated;
