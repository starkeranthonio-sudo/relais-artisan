#!/usr/bin/env bash
# Configure les secrets du projet sans jamais les afficher ni les écrire dans un fichier du projet :
#  - demande les clés Twilio (et Anthropic, facultative) en saisie masquée ;
#  - vérifie les clés Twilio et branche les webhooks du numéro relais ;
#  - enregistre tout dans les secrets des Edge Functions Supabase et dans Supabase Vault (planificateur).
# Usage : depuis le dossier du projet (lié à Supabase) : bash scripts/setup-secrets.sh
set -euo pipefail

PROJECT_URL="https://mhouweudylvwvbkblcpp.supabase.co"
APP_URL="${APP_URL:-http://localhost:5174}"

echo
echo "=== Configuration des clés Relais Artisan ==="
echo "Ce que vous tapez ne s'affiche pas à l'écran. C'est normal."
echo

read -rp  "Twilio Account SID (commence par AC) : " TWILIO_ACCOUNT_SID
read -rsp "Twilio Auth Token : " TWILIO_AUTH_TOKEN; echo
read -rsp "Clé API Anthropic (facultatif, Entrée pour passer) : " ANTHROPIC_API_KEY; echo

TWILIO_ACCOUNT_SID="$(echo "$TWILIO_ACCOUNT_SID" | tr -d '[:space:]')"
TWILIO_AUTH_TOKEN="$(echo "$TWILIO_AUTH_TOKEN" | tr -d '[:space:]')"
ANTHROPIC_API_KEY="$(echo "$ANTHROPIC_API_KEY" | tr -d '[:space:]')"
API="https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID"

echo
echo "1/4 Vérification des clés Twilio…"
status=$(curl -s -o /dev/null -w "%{http_code}" -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" "$API.json")
if [ "$status" != "200" ]; then
  echo "    ✗ Clés refusées par Twilio (code $status). Vérifiez le SID et le token, puis relancez."
  exit 1
fi
echo "    ✓ Clés valides"

echo "2/4 Recherche de votre numéro Twilio…"
numbers_json=$(curl -s -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" "$API/IncomingPhoneNumbers.json")
number_info=$(printf '%s' "$numbers_json" | python3 -c '
import json, sys
nums = json.load(sys.stdin).get("incoming_phone_numbers", [])
ok = [n for n in nums if n["capabilities"].get("voice") and n["capabilities"].get("sms")]
if ok: print(ok[0]["sid"], ok[0]["phone_number"])
')
if [ -z "$number_info" ]; then
  echo "    ✗ Aucun numéro avec Voix + SMS sur ce compte."
  echo "      Achetez-en un dans la console Twilio (Phone Numbers → Buy a number), puis relancez ce script."
  exit 1
fi
NUMBER_SID="${number_info%% *}"
NUMBER="${number_info##* }"
echo "    ✓ Numéro trouvé : $NUMBER"

echo "3/4 Branchement du numéro sur Relais Artisan…"
curl -s -o /dev/null -w "" -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" "$API/IncomingPhoneNumbers/$NUMBER_SID.json" \
  --data-urlencode "VoiceUrl=$PROJECT_URL/functions/v1/twilio-voice" --data-urlencode "VoiceMethod=POST" \
  --data-urlencode "SmsUrl=$PROJECT_URL/functions/v1/twilio-sms" --data-urlencode "SmsMethod=POST"
echo "    ✓ Appels et SMS entrants redirigés vers Relais Artisan"

echo "4/4 Enregistrement des secrets dans Supabase…"
CRON_SECRET=$(openssl rand -hex 24)
envfile=$(mktemp)
chmod 600 "$envfile"
trap 'rm -f "$envfile"' EXIT
{
  echo "TWILIO_ACCOUNT_SID=$TWILIO_ACCOUNT_SID"
  echo "TWILIO_AUTH_TOKEN=$TWILIO_AUTH_TOKEN"
  echo "PUBLIC_APP_URL=$APP_URL"
  echo "CRON_SECRET=$CRON_SECRET"
  if [ -n "$ANTHROPIC_API_KEY" ]; then echo "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY"; fi
} > "$envfile"
supabase secrets set --env-file "$envfile" > /dev/null
supabase db query --linked "do \$\$ begin
  if exists (select 1 from vault.secrets where name = 'project_url') then
    perform vault.update_secret((select id from vault.secrets where name = 'project_url'), '$PROJECT_URL');
  else perform vault.create_secret('$PROJECT_URL', 'project_url'); end if;
  if exists (select 1 from vault.secrets where name = 'cron_secret') then
    perform vault.update_secret((select id from vault.secrets where name = 'cron_secret'), '$CRON_SECRET');
  else perform vault.create_secret('$CRON_SECRET', 'cron_secret'); end if;
end \$\$;" > /dev/null 2>&1
echo "    ✓ Secrets enregistrés (fichier temporaire supprimé)"

unset TWILIO_AUTH_TOKEN ANTHROPIC_API_KEY CRON_SECRET
echo
echo "=== Terminé ✓ ==="
echo "Votre numéro relais : $NUMBER"
echo "Vous pouvez revenir dans la conversation et dire « c'est fait »."
