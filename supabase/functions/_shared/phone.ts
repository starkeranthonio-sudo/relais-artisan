// Numéros spéciaux envoyés par Twilio quand l'appelant a masqué ou bloqué son numéro.
// https://www.twilio.com/docs/voice/twiml#callers-id-when-caller-id-is-blocked
const HIDDEN_CALLER_IDS = new Set([
  "",
  "anonymous",
  "unknown",
  "restricted",
  "private",
  "+266696687",
  "+86282452253",
  "+8656696",
  "+7378742833",
  "+2562533",
]);

export function isHiddenCaller(from: string | null | undefined): boolean {
  return HIDDEN_CALLER_IDS.has((from ?? "").trim().toLowerCase());
}

/** "06 12 34 56 78", "0033612345678", "+33 6 12 34 56 78" → "+33612345678". */
export function toE164(raw: string): string {
  const cleaned = raw.replace(/[\s.\-()]/g, "");
  if (cleaned.startsWith("+")) return cleaned;
  if (cleaned.startsWith("00")) return "+" + cleaned.slice(2);
  if (/^0[1-9]\d{8}$/.test(cleaned)) return "+33" + cleaned.slice(1);
  return cleaned;
}

/** "+33612345678" → "06 12 34 56 78" (lisible pour l'artisan). Les numéros étrangers restent en E.164. */
export function formatFrench(e164: string): string {
  const m = /^\+33(\d{9})$/.exec(e164);
  if (!m) return e164;
  return ("0" + m[1]).replace(/(\d{2})(?=\d)/g, "$1 ");
}
