#!/usr/bin/env bash
# Diagnostic du compte Twilio (lecture seule, n'achète rien) : statut, type de compte, solde,
# numéros possédés, numéros disponibles. Les clés sont saisies en masqué et ne sont enregistrées nulle part.
set -uo pipefail

read -rp  "Twilio Account SID : " SID
read -rsp "Twilio Auth Token : " TOKEN; echo
SID="$(echo "$SID" | tr -d '[:space:]')"; TOKEN="$(echo "$TOKEN" | tr -d '[:space:]')"
API="https://api.twilio.com/2010-04-01/Accounts/$SID"
get() { curl -s -u "$SID:$TOKEN" "$1"; }

echo
echo "--- Compte ---"
get "$API.json" | python3 -c '
import json, sys
a = json.load(sys.stdin)
if "status" not in a: print("Erreur :", a.get("message")); sys.exit()
print("Statut :", a["status"], "| Type :", a["type"])'

echo "--- Solde ---"
get "$API/Balance.json" | python3 -c '
import json, sys
b = json.load(sys.stdin)
print("Solde :", b.get("balance"), b.get("currency")) if "balance" in b else print("Erreur :", b.get("message"))'

echo "--- Numéros possédés ---"
get "$API/IncomingPhoneNumbers.json" | python3 -c '
import json, sys
nums = json.load(sys.stdin).get("incoming_phone_numbers", [])
print("Aucun") if not nums else None
for n in nums: print(n["phone_number"], {k: v for k, v in n["capabilities"].items() if v})'

echo "--- Numéros américains disponibles (Voix + SMS) ---"
get "$API/AvailablePhoneNumbers/US/Local.json?VoiceEnabled=true&SmsEnabled=true&PageSize=3" | python3 -c '
import json, sys
r = json.load(sys.stdin)
if "available_phone_numbers" not in r: print("Erreur :", r.get("code"), r.get("message"))
else: print(len(r["available_phone_numbers"]), "trouvés, ex. :", ", ".join(n["phone_number"] for n in r["available_phone_numbers"]))'

unset TOKEN
echo
echo "Diagnostic terminé. Revenez dans la conversation."
