-- Étape 2 : page de demande remplie par le client + résumé IA.

alter table public.leads
  add column client_name        text,
  add column work_type          text,
  add column description        text,
  add column address            text,
  add column urgency            text check (urgency in ('urgent', 'week', 'flexible')),
  add column photo_paths        text[] not null default '{}',
  add column form_submitted_at  timestamptz,
  add column ai_summary         text;

-- Photos envoyées par les clients : bucket privé, rangées par demande ({lead_id}/{n}.jpg).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lead-photos', 'lead-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- L'artisan peut voir les photos de ses propres demandes (l'upload passe par l'Edge Function, en service_role).
create policy "artisan lit les photos de ses demandes" on storage.objects
  for select using (
    bucket_id = 'lead-photos'
    and (storage.foldername(name))[1] in (
      select l.id::text from public.leads l
      join public.artisans a on a.id = l.artisan_id
      where a.user_id = auth.uid()
    )
  );
