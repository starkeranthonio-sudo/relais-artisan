-- Pré-remplissage du formulaire testeur pour un artisan arrivé par son lien de prospection (/testeurs?p=<code>) :
-- seulement son prénom et le nom de son entreprise (jamais le téléphone). Le code n'est connu que du destinataire du SMS.
create function public.prospect_prefill(p_code text)
returns table (first_name text, business_name text)
language sql stable security definer set search_path = '' as $$
  select p.first_name, p.business_name from public.prospects p
  where p.code = lower(p_code) and p.status <> 'stop'
$$;
revoke execute on function public.prospect_prefill(text) from public;
grant execute on function public.prospect_prefill(text) to anon, authenticated;
