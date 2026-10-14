-- Nombre d'avis Google du prospect : détail personnel cité dans le message (à partir de 10 avis).
alter table public.prospects add column google_reviews int check (google_reviews >= 0);
