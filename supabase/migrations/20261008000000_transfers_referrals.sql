-- Moteur de partage : transmettre une demande à un confrère (inscrit ou non) + parrainage.

-- Parrainage : chaque artisan a un code ; on retient qui a fait venir qui (mesure du coefficient viral).
alter table public.artisans
  add column referral_code text unique,
  add column referred_by uuid references public.artisans (id) on delete set null;

create function public.new_referral_code() returns text language sql as $$
  select string_agg(substr('abcdefghjkmnpqrstuvwxyz23456789', 1 + floor(random() * 31)::int, 1), '')
  from generate_series(1, 7)
$$;
update public.artisans set referral_code = public.new_referral_code() where referral_code is null;
alter table public.artisans alter column referral_code set default public.new_referral_code();
alter table public.artisans alter column referral_code set not null;

-- Inscription : on rattache le parrain si un code valide est fourni.
create or replace function public.handle_new_artisan() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.raw_user_meta_data ? 'business_name' then
    insert into public.artisans (user_id, business_name, owner_phone, referred_by)
    values (
      new.id,
      left(trim(new.raw_user_meta_data ->> 'business_name'), 100),
      coalesce(new.raw_user_meta_data ->> 'owner_phone', ''),
      (select id from public.artisans where referral_code = lower(trim(new.raw_user_meta_data ->> 'referral_code')))
    );
  end if;
  return new;
end $$;

-- Transmission d'une demande à un confrère.
create table public.lead_transfers (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid not null references public.leads (id) on delete cascade,
  from_artisan_id  uuid not null references public.artisans (id) on delete cascade,
  to_phone         text not null,                       -- portable du confrère (E.164)
  to_artisan_id    uuid references public.artisans (id) on delete set null, -- connu à l'acceptation
  token            text not null unique,                -- lien d'invitation envoyé par SMS
  note             text,                                -- petit mot de l'artisan qui transmet
  status           text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired')),
  invitee_was_member boolean not null,                  -- le confrère était-il déjà inscrit ? (mesure virale)
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '7 days',
  decided_at       timestamptz
);
-- Une seule transmission en cours par demande.
create unique index lead_transfers_one_pending on public.lead_transfers (lead_id) where status = 'pending';

alter table public.lead_transfers enable row level security;
create policy "artisan voit ses transmissions (envoyées ou reçues)" on public.lead_transfers
  for select using (
    from_artisan_id in (select id from public.artisans where user_id = auth.uid())
    or to_artisan_id in (select id from public.artisans where user_id = auth.uid())
  );
-- Création / acceptation uniquement via l'Edge Function lead-transfer (service_role).
revoke insert, update, delete on public.lead_transfers from authenticated, anon;

-- L'artisan voit les confrères qu'il a parrainés (nom uniquement, via la vue ci-dessous).
create view public.my_referrals with (security_invoker = false) as
  select r.id, r.business_name, r.created_at
  from public.artisans r
  join public.artisans me on me.id = r.referred_by
  where me.user_id = auth.uid();
grant select on public.my_referrals to authenticated;
