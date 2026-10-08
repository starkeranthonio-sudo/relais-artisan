-- Nouveau nom : RelaisArti (expéditeur SMS par défaut quand le nom d'entreprise ne donne rien d'utilisable).
create or replace function public.sms_sender_from_name(p_name text) returns text
language sql immutable set search_path = '' as $$
  select case
    when candidate ~ '[A-Za-z]' then candidate
    else 'RelaisArti'
  end
  from (
    select left(regexp_replace(initcap(extensions.unaccent(coalesce(p_name, ''))), '[^A-Za-z0-9]', '', 'g'), 11) as candidate
  ) c
$$;
