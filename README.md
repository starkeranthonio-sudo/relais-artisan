# RelaisArti

Site : https://relaisarti.pages.dev · Parcours testeurs : https://relaisarti.pages.dev/testeurs

Un artisan ne perd plus de client à cause d'un appel manqué ou d'un devis oublié.

## Étape 1 : appel manqué → SMS ✅

1. L'artisan renvoie ses appels non répondus vers son **numéro relais** (`**61*<numéro relais>#`).
2. Le client entend un court message (« Vous allez recevoir un SMS… ») et l'appel raccroche.
3. Le SMS part depuis le numéro relais : `Dupont Plomberie : désolé d'avoir manqué votre appel. Décrivez votre besoin ici, je vous rappelle vite : <lien>`.
4. Si le client répond par SMS, la réponse est enregistrée puis transférée sur le portable de l'artisan. `STOP` désinscrit le client.

Règles de fonctionnement :
- Si le même client rappelle dans les 7 jours, son appel est rattaché à la même demande.
- Un client reçoit au plus un SMS toutes les 24 h.
- Si l'appelant a masqué son numéro, un message spécifique est lu et aucun SMS n'est envoyé.
- Si Twilio renvoie deux fois le même appel, un seul SMS part.

| Fichier | Rôle |
|---|---|
| `supabase/migrations/…_init.sql` | Tables `artisans`, `leads`, `calls`, `messages` + RLS |
| `supabase/functions/twilio-voice` | Webhook « appel entrant » du numéro relais |
| `supabase/functions/twilio-sms` | Webhook « SMS entrant » du numéro relais |
| `supabase/functions/_shared/missed-call.ts` | Logique appel manqué → SMS |
| `supabase/functions/_shared/incoming-sms.ts` | Logique réponse client → artisan |
| `supabase/functions/tests/` | Tests (`deno test --allow-env supabase/functions/tests/`) |

## Étape 2 : page de demande + résumé IA ✅

1. Le lien du SMS ouvre `/d/<token>` (application `web/`, Vite + React) : type de travaux, description, urgence, adresse, jusqu'à 3 photos (réduites sur le téléphone avant l'envoi), prénom.
2. L'Edge Function `request-form` enregistre la demande et stocke les photos dans le bucket privé `lead-photos`.
3. Claude (`claude-opus-5-5`, effort `low`) résume la demande en 160 caractères maximum, en tenant compte des photos. Si l'IA ne répond pas, un résumé de secours est envoyé.
4. L'artisan reçoit un SMS :
   ```
   Nouvelle demande - Marie 06 11 22 33 44
   URGENT (aujourd'hui) - 12 rue des Lilas, Vélizy
   Fuite sous évier cuisine, joint siphon à changer.
   2 photos : https://…/app/demandes/<id>
   ```

Démo sans backend : `cd web && npm run dev`, puis ouvrir `http://localhost:5173/d/demo`.

## Étape 3 : relance automatique des devis ✅

1. L'artisan déclare « J'ai envoyé un devis » : insertion dans `quotes` (bouton de l'écran Devis à l'étape 4). La première relance est planifiée à J+3.
2. `pg_cron` appelle l'Edge Function `quote-followups` toutes les 15 minutes, avec un secret partagé.
3. Relances à **J+3, J+7 et J+14**, depuis le numéro relais, du lundi au samedi entre 9 h et 19 h (heure de Paris). Chaque texte tient en un SMS et contient STOP.
4. Arrêt automatique si le client répond par SMS après l'envoi du devis, s'il répond STOP, ou si l'artisan marque le devis gagné ou perdu.
5. Tous les SMS sortants sont convertis en alphabet GSM-7 (ç → c, ê → e…) : 160 caractères par SMS au lieu de 70.

Activer le planificateur (une seule fois, après le déploiement) :
```sql
select vault.create_secret('https://<ref>.supabase.co', 'project_url');
select vault.create_secret('<même valeur que CRON_SECRET>', 'cron_secret');
```

## Étape 4 : espace artisan ✅

Application web mobile (`web/`, routes `/app/...`), thème anthracite + orange :
- **Inscription / Connexion** (Supabase Auth, email + mot de passe). La fiche `artisans` est créée par un trigger à l'inscription.
- **Demandes** : liste avec statut (SMS envoyé, À rappeler, Contacté, Devis envoyé, Terminé), badge Urgent, résumé IA. Fiche détaillée : Appeler, SMS, adresse sur Maps, photos, « J'ai envoyé un devis ».
- **Devis** : En attente / Gagnés / Perdus, suivi des relances, boutons Gagné / Perdu (le montant est demandé au moment du « Gagné » s'il manque).
- **Bilan du mois** : montant signé, appels manqués, clients recontactés, demandes, devis, taux de signature.
- **Réglages / Installation** : numéro relais, code de renvoi `**61*<relais>**20#` (bouton Android, copie), essai, profil.
- **Mode démo** sans compte, avec des données fictives : `/demo` (pour les rendez-vous commerciaux).

Sécurité vérifiée sur la base : un artisan ne voit que ses données, ne peut ni changer son numéro relais ni modifier le planning des relances, et ne peut pas créer de devis sur la demande d'un autre.

Attribution d'un numéro relais (manuelle en V1) :
```sql
update artisans set relay_number = '+33939xxxxxx' where id = '<id>';
```

## Moteur de partage : transmission entre artisans + parrainage ✅

- **« Transmettre à un confrère »** (fiche d'une demande sans devis) : l'artisan entre le portable d'un confrère, inscrit ou non. Le confrère reçoit un SMS avec un lien `/t/<jeton>` : type de travaux, ville, urgence et résumé, **sans les coordonnées du client**.
- Confrère non inscrit : il doit **créer son compte gratuit** pour accepter, puis il revient automatiquement sur la transmission.
- À l'acceptation : la demande lui est confiée, l'artisan d'origine et le client sont prévenus par SMS, et le **parrainage** est enregistré si le confrère vient de s'inscrire. Validité : 7 jours. Un seul confrère peut prendre le client.
- **Parrainage** : lien `/app/inscription?parrain=<code>` dans Réglages (« 1 mois offert pour vous deux », à appliquer lors de la facturation).
- **Mesure du coefficient viral** : `lead_transfers.invitee_was_member` et `artisans.referred_by`.

```sql
-- Coefficient viral approché : invitations envoyées à des non-inscrits, et inscriptions obtenues
select count(*) filter (where not invitee_was_member) as invitations,
       count(*) filter (where not invitee_was_member and status = 'accepted') as inscriptions
from lead_transfers;
```

## Mesure des usages (Habit Testing) ✅

Table `events` (écriture seule par l'artisan, lecture réservée au propriétaire du projet) : `app_open` (avec `source` = `sms` si ouvert depuis le lien du SMS), `lead_view`, `lead_call`, `lead_sms`, `quote_declared`, `quote_won`, `quote_lost`, `transfer_sent`, `referral_share`, `stats_view`.

Tableaux de bord dans le SQL Editor :
```sql
select * from analytics_weekly_habit;  -- jours actifs sur 7 jours, ouvertures depuis SMS, appels, devis
select * from analytics_funnel;        -- par semaine : fiches ouvertes → appels → devis → gagnés
```

Le SMS « Nouvelle demande » utilise un lien court `/app/l/<jeton>` (moins de caractères, ouverture comptée « depuis un SMS »). Un artisan non connecté revient sur la demande après connexion.

## SMS récapitulatif de 18 h ✅

- Du lundi au samedi entre 18 h et 19 h (heure de Paris), un SMS « RelaisArt » à l'artisan : clients à rappeler (2 noms max), réponses aux devis, devis à classer. Exemple : *Ce soir : 3 clients à rappeler (Marie, M. Leroy…), 1 réponse à vos devis, 2 devis à classer. Voir : …/app/r*
- **Rien à faire → pas de SMS.** Un seul récap par jour (`artisans.last_recap_on`, marqué seulement quand un SMS part).
- Désactivable dans Réglages (`artisans.daily_recap`). Ouverture depuis le récap mesurée (`app_open`, `source = recap`).
- `pg_cron` appelle `daily-recap` toutes les 15 min entre 15 h et 18 h UTC (couvre l'heure d'été et d'hiver).

## Bilan du mois par SMS + devis à classer ✅

- **Le 1er du mois vers 9 h** (Paris), un SMS « RelaisArt » : *Septembre : 5 270 € signés (3 chantiers), 14 appels récupérés, 9 demandes. Votre meilleur mois ! Voir : …/app/b/2026-09*. Seulement si le mois a eu de l'activité ; « meilleur mois » seulement si c'est vrai ; « Pensez à classer vos devis » si rien n'a été gagné.
- Le lien ouvre le bilan de ce mois-là (`?mois=AAAA-MM`), ouverture mesurée (`source = monthly`).
- **Devis à classer** (dans le récap de 18 h) : sans réponse 21 jours après l'envoi, ou client ayant répondu depuis plus de 3 jours.
- Même interrupteur que le récap (Réglages → SMS de suivi). `pg_cron` : `monthly-report` le 1er, entre 7 h et 8 h UTC.

## Progrès, SMS personnalisé, avis Google ✅

- **Bilan** : comparaison avec le mois précédent (« +1 chantier (+1 150 €) par rapport à septembre ») et badge **Meilleur mois** quand le montant signé dépasse tous les mois précédents.
- **SMS personnalisé** (Réglages → Votre message aux clients) : `{nom}`, `{lien}` obligatoire, aperçu et compteur en direct. Le serveur revient au texte par défaut si le modèle n'a pas de `{lien}` ou dépasse 1 SMS.
- **Avis Google** : l'artisan colle son lien (Réglages → Avis Google). Sur un devis gagné, « Chantier terminé ? Demander un avis » envoie au client, au nom de l'artisan, un SMS de remerciement avec le lien. Une seule fois par client, jamais si le client a répondu STOP. Edge Function `review-request`.

## Programme « Testeurs fondateurs » ✅

- Page publique **/testeurs** (cible des liens de parrainage `/testeurs?parrain=<code>`) : promesse, fonctionnement, paliers, conditions écrites.
- Inscription avec **métier** et **code postal** (email ou Google/Apple via « Bienvenue »).
- **Essai** (Réglages → « Faire l'essai », 3 max) : simule un appel manqué ; l'artisan reçoit le SMS client à son nom, remplit la demande, reçoit « Nouvelle demande ». Edge Function `artisan-tools` (`test_drive`).
- **SIRET facultatif**, vérifié dans la base Sirene (API Recherche d'entreprises : établissement actif, section F construction, clé de Luhn, 1 compte par SIRET). Seuls les filleuls vérifiés comptent dans les paliers 1 / 3 / 5 / 10.
- Suivi de la validation : `select * from analytics_validation;` (inscrits, essais, SIRET vérifiés, parrainages).

## Parcours testeurs RelaisArti (sans compte) ✅

`/testeurs` (lien de parrainage : `/testeurs?parrain=<code>`) : présentation et fonctionnalités → **Infos** (entreprise, prénom, nom, portable ; métier et code postal facultatifs) → espace personnel `/testeurs/moi/<jeton>` (lien envoyé par SMS) : **Essai** (appel manqué simulé, le numéro relais n'est jamais montré ; le SMS « Nouvelle demande » ouvre `/essai/<jeton>`) → **SIRET** (vérification automatique, ou photo d'un devis → vérification manuelle) → **Partage** (lien, WhatsApp, SMS, copie ; paliers 1/3/5/10 ; seuls les filleuls au SIRET vérifié comptent). Démo : `/testeurs/moi/demo`. Prix affiché : 39 € HT/mois (tarif fondateur 29 €).

Suivi (SQL Editor) :
```sql
select * from analytics_testers_funnel;   -- où les gens s'arrêtent (visiteurs distincts par étape, 30 jours)
select * from analytics_testers;          -- chaque testeur : avancement, filleuls, clics sur son lien
select * from admin_siret_pending;        -- photos de devis à vérifier (bucket Storage « siret-proofs »)
select public.admin_validate_siret('<tester_id>', true, 'NOM OFFICIEL');  -- valider (false = refuser)
```

## Mise en route

### 1. Supabase
```bash
supabase login
supabase link --project-ref <ref-du-projet>
supabase db push
cp supabase/functions/.env.example supabase/functions/.env   # puis remplir les valeurs
supabase secrets set --env-file supabase/functions/.env
supabase functions deploy twilio-voice
supabase functions deploy twilio-sms
supabase functions deploy request-form
supabase functions deploy quote-followups
supabase functions deploy lead-transfer
supabase functions deploy daily-recap
supabase functions deploy monthly-report
supabase functions deploy review-request
supabase functions deploy artisan-tools
```

### 2. Twilio
1. Créer un compte sur twilio.com. L'essai gratuit donne du crédit, mais les SMS ne partent que vers des **numéros vérifiés** et commencent par « Sent from your Twilio trial account ».
2. Pour les tests, acheter un numéro qui accepte la voix et les SMS. Un vrai numéro français `+33 9 39…` demandera un K-bis (voir « Production » plus bas).
3. Dans la page du numéro, configurer :
   - **A call comes in** → Webhook POST → `https://<ref>.supabase.co/functions/v1/twilio-voice`
   - **A message comes in** → Webhook POST → `https://<ref>.supabase.co/functions/v1/twilio-sms`

### 3. Créer un artisan de test (SQL Editor de Supabase)
```sql
insert into artisans (business_name, owner_phone, relay_number)
values ('Dupont Plomberie', '+336XXXXXXXX', '+<numero-twilio>');
```

### 4. Tester
Appeler le numéro Twilio depuis son téléphone. On doit entendre le message, puis recevoir le SMS. Répondre au SMS : la réponse doit arriver sur `owner_phone`.

## Production (France)
- Les numéros 06 et 07 sont interdits pour les SMS automatiques (ARCEP, décision 22-1583). Il faut utiliser des numéros **+33 9 37 / 38 / 39 « plateforme technique »**, qui exigent un bundle réglementaire Twilio : K-bis, adresse en France, représentant légal.
- À vérifier sur les 4 opérateurs : le numéro du client est-il bien transmis après un renvoi `**61*` ?

## Prochaines étapes
- Déployer la page web (Cloudflare Pages) et le domaine
- Supabase Auth : ajouter l'URL du site dans *Authentication → URL Configuration* (liens de confirmation d'email)
- Paiement de l'abonnement (Stripe) et attribution automatique des numéros relais
