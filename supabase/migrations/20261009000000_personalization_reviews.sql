-- Étape 5 : SMS personnalisé envoyé au client après un appel manqué.
-- Étape 6 : demande d'avis Google après un chantier terminé.

alter table public.artisans
  -- Texte libre ; {lien} obligatoire (lien de la page de demande), {nom} = nom de l'entreprise.
  -- Si absent, invalide ou trop long pour 1 SMS, le serveur utilise le texte par défaut.
  add column client_sms_template text check (client_sms_template is null or (length(client_sms_template) <= 300 and client_sms_template like '%{lien}%')),
  -- Lien « laisser un avis » de la fiche Google de l'artisan.
  add column google_review_url text check (google_review_url is null or (google_review_url ~ '^https://' and length(google_review_url) <= 300));
grant update (client_sms_template, google_review_url) on public.artisans to authenticated;

alter table public.leads add column review_requested_at timestamptz; -- une seule demande d'avis par client

-- Nouvelles mesures d'usage.
alter table public.events drop constraint events_name_check;
alter table public.events add constraint events_name_check check (name in (
  'app_open', 'lead_view', 'lead_call', 'lead_sms', 'quote_declared', 'quote_won', 'quote_lost',
  'transfer_sent', 'referral_share', 'stats_view',
  'sms_template_saved',  -- l'artisan a personnalisé son SMS (investissement)
  'review_requested'     -- demande d'avis Google envoyée
));
