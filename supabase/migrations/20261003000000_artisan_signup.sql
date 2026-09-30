-- Étape 4 : inscription de l'artisan et droits de l'espace artisan.

-- À l'inscription (Supabase Auth), la fiche artisan est créée à partir des infos du formulaire.
-- Le numéro relais n'est pas choisi par l'artisan : il est attribué ensuite (manuellement en V1).
create function public.handle_new_artisan() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.raw_user_meta_data ? 'business_name' then
    insert into public.artisans (user_id, business_name, owner_phone)
    values (
      new.id,
      left(trim(new.raw_user_meta_data ->> 'business_name'), 100),
      coalesce(new.raw_user_meta_data ->> 'owner_phone', '')
    );
  end if;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_artisan();

-- L'artisan modifie son nom et son portable, jamais son numéro relais ni son identifiant.
revoke insert, update on public.artisans from authenticated, anon;
grant update (business_name, owner_phone) on public.artisans to authenticated;

-- Sur une demande, l'artisan ne change que le statut (contacté, terminé…).
revoke insert, update, delete on public.leads from authenticated, anon;
grant update (status) on public.leads to authenticated;

-- Journaux techniques : lecture seule pour l'artisan.
revoke insert, update, delete on public.calls, public.messages from authenticated, anon;
revoke insert, update, delete on public.quotes from anon;
