-- Nom d'expéditeur des SMS envoyés aux clients (« Starker », « DupontPlomb ») au lieu de « RelaisArt ».
-- Règles opérateurs (sender ID alphanumérique) : 11 caractères max, lettres et chiffres, au moins une lettre.

create extension if not exists unaccent with schema extensions;

-- « Dupont Plomberie » → « DupontPlomb » ; « Électricité Martin & Fils » → « ElectriciteM ».. (tronqué à 11)
create function public.sms_sender_from_name(p_name text) returns text
language sql immutable set search_path = '' as $$
  select case
    when candidate ~ '[A-Za-z]' then candidate
    else 'RelaisArt'
  end
  from (
    select left(regexp_replace(initcap(extensions.unaccent(coalesce(p_name, ''))), '[^A-Za-z0-9]', '', 'g'), 11) as candidate
  ) c
$$;

alter table public.artisans add column sms_sender text;
update public.artisans set sms_sender = public.sms_sender_from_name(business_name);
alter table public.artisans alter column sms_sender set not null;
alter table public.artisans add constraint artisans_sms_sender_format
  check (sms_sender ~ '^[A-Za-z0-9]{1,11}$' and sms_sender ~ '[A-Za-z]');

-- À la création d'une fiche (inscription email, Google/Apple), le nom d'expéditeur est déduit du nom d'entreprise.
create function public.artisans_default_sms_sender() returns trigger language plpgsql as $$
begin
  if new.sms_sender is null then
    new.sms_sender := public.sms_sender_from_name(new.business_name);
  end if;
  return new;
end $$;
create trigger artisans_default_sms_sender before insert on public.artisans
  for each row execute function public.artisans_default_sms_sender();

-- L'artisan peut le modifier dans ses Réglages.
grant update (sms_sender) on public.artisans to authenticated;
