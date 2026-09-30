-- Étape 1 : appel manqué → SMS automatique au client.

create extension if not exists pgcrypto;

-- Un artisan = un compte + un numéro relais (numéro Twilio vers lequel il renvoie ses appels non répondus).
create table public.artisans (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid unique references auth.users (id) on delete cascade,
  business_name   text not null,                 -- nom affiché dans le SMS, ex. "Dupont Plomberie"
  owner_phone     text not null,                 -- portable de l'artisan, format E.164 (+336...)
  relay_number    text unique,                   -- numéro relais Twilio, format E.164
  created_at      timestamptz not null default now()
);

-- Une demande = un client qui a appelé un artisan. Plusieurs appels du même client se regroupent dans la même demande.
create table public.leads (
  id              uuid primary key default gen_random_uuid(),
  artisan_id      uuid not null references public.artisans (id) on delete cascade,
  client_phone    text not null,
  public_token    text not null unique,          -- identifiant du lien envoyé par SMS (page de demande, étape 2)
  status          text not null default 'new'
                  check (status in ('new', 'form_submitted', 'contacted', 'closed')),
  call_count      int not null default 1,
  last_call_at    timestamptz not null default now(),
  sms_sent_at     timestamptz,
  replied_at      timestamptz,                   -- dernière réponse SMS du client (sert à stopper les relances, étape 3)
  opted_out       boolean not null default false, -- le client a répondu STOP
  created_at      timestamptz not null default now()
);
create index leads_artisan_client_idx on public.leads (artisan_id, client_phone, created_at desc);

-- Journal de chaque appel reçu sur un numéro relais. call_sid unique = idempotence si Twilio renvoie le webhook.
create table public.calls (
  id              uuid primary key default gen_random_uuid(),
  call_sid        text not null unique,
  artisan_id      uuid references public.artisans (id) on delete cascade,
  lead_id         uuid references public.leads (id) on delete set null,
  from_number     text,
  to_number       text not null,
  outcome         text not null
                  check (outcome in ('pending', 'sms_sent', 'sms_skipped_recent', 'caller_hidden', 'unknown_relay', 'sms_failed')),
  created_at      timestamptz not null default now()
);

-- Tous les SMS envoyés et reçus.
create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  artisan_id      uuid not null references public.artisans (id) on delete cascade,
  lead_id         uuid references public.leads (id) on delete set null,
  direction       text not null check (direction in ('outbound_client', 'inbound_client', 'outbound_artisan')),
  body            text not null,
  twilio_sid      text,
  created_at      timestamptz not null default now()
);
create index messages_lead_idx on public.messages (lead_id, created_at);

-- Sécurité : l'artisan ne voit que ses propres données. Les Edge Functions utilisent la clé service_role et contournent RLS.
alter table public.artisans enable row level security;
alter table public.leads    enable row level security;
alter table public.calls    enable row level security;
alter table public.messages enable row level security;

create policy "artisan lit son profil" on public.artisans
  for select using (user_id = auth.uid());
create policy "artisan modifie son profil" on public.artisans
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "artisan lit ses demandes" on public.leads
  for select using (artisan_id in (select id from public.artisans where user_id = auth.uid()));
create policy "artisan met à jour ses demandes" on public.leads
  for update using (artisan_id in (select id from public.artisans where user_id = auth.uid()));

create policy "artisan lit ses appels" on public.calls
  for select using (artisan_id in (select id from public.artisans where user_id = auth.uid()));

create policy "artisan lit ses messages" on public.messages
  for select using (artisan_id in (select id from public.artisans where user_id = auth.uid()));
