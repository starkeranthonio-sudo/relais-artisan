import { encodeBase64 } from "jsr:@std/encoding@1/base64";

/**
 * Vérifie que la requête vient bien de Twilio (en-tête X-Twilio-Signature).
 * Algorithme : HMAC-SHA1(authToken, url + clés triées concaténées à leurs valeurs), encodé en base64.
 * https://www.twilio.com/docs/usage/security#validating-requests
 */
export async function isValidTwilioSignature(
  authToken: string,
  signature: string | null,
  url: string,
  params: Record<string, string>,
): Promise<boolean> {
  if (!signature) return false;
  const payload = Object.keys(params).sort().reduce((acc, key) => acc + key + params[key], url);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return timingSafeEqual(encodeBase64(mac), signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type SendSms = (from: string, to: string, body: string) => Promise<{ sid: string }>;

/**
 * Envoie un SMS via l'API REST Twilio.
 * `senderId` (facultatif) : nom d'expéditeur alphanumérique (11 caractères max, ex. « RelaisArt ») utilisé à la place
 * du numéro relais. Utile tant que le numéro relais ne peut pas envoyer de SMS (numéro américain non enregistré A2P) ;
 * le client ne peut alors pas répondre au SMS.
 */
export function twilioSender(accountSid: string, authToken: string, senderId?: string): SendSms {
  return async (relayNumber, to, body) => {
    const from = senderId || relayNumber;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ From: from, To: to, Body: toGsm7(body) }), // 160 caractères par SMS au lieu de 70
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`Twilio SMS ${res.status}: ${json.message ?? JSON.stringify(json)}`);
    return { sid: json.sid };
  };
}

export function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

// Voix française neuronale d'Amazon Polly, disponible dans Twilio <Say>.
const VOICE = "Polly.Lea-Neural";

/** Réponse TwiML : lit un message en français puis raccroche. */
export function sayAndHangup(text: string): Response {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response><Say language="fr-FR" voice="${VOICE}">${escapeXml(text)}</Say><Hangup/></Response>`;
  return new Response(xml, { headers: { "Content-Type": "text/xml; charset=utf-8" } });
}

/** Réponse TwiML vide (webhook SMS : on ne répond rien automatiquement au client). */
export function emptyTwiml(): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response/>`, {
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

/** Lit le corps application/x-www-form-urlencoded envoyé par Twilio. */
export async function readTwilioParams(req: Request): Promise<Record<string, string>> {
  const form = new URLSearchParams(await req.text());
  return Object.fromEntries(form.entries());
}

/**
 * URL publique exacte appelée par Twilio (nécessaire pour vérifier la signature).
 * Dans Supabase, req.url est une URL interne : on reconstruit l'URL publique depuis SUPABASE_URL.
 */
export function publicFunctionUrl(req: Request, functionName: string, supabaseUrl: string): string {
  const { search } = new URL(req.url);
  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/${functionName}${search}`;
}

// Alphabet GSM 03.38 (table de base + extension). Un seul caractère hors de cette liste (ç, ê, â, emoji…)
// fait passer le SMS en UCS-2 : 70 caractères par SMS au lieu de 160, donc 2 à 3 fois plus cher.
const GSM7 = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà" +
    "^{}\\[~]|€",
);

export function isGsm7(text: string): boolean {
  for (const c of text) if (!GSM7.has(c)) return false;
  return true;
}

const GSM7_REPLACEMENTS: Record<string, string> = {
  "œ": "oe", "Œ": "OE", "’": "'", "‘": "'", "“": '"', "”": '"', "«": '"', "»": '"',
  "–": "-", "—": "-", "…": "...", "\u00a0": " ", "\u202f": " ",
};

/**
 * Rend un texte compatible GSM-7 : garde é, è, à, ù (présents dans l'alphabet GSM), convertit ç → c, ê → e,
 * « » → ", etc. Les caractères impossibles à convertir (emoji…) sont retirés.
 */
export function toGsm7(text: string): string {
  let out = "";
  for (const c of text) {
    if (GSM7.has(c)) out += c;
    else if (c in GSM7_REPLACEMENTS) out += GSM7_REPLACEMENTS[c];
    else {
      const base = c.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if ([...base].every((b) => GSM7.has(b))) out += base;
    }
  }
  return out;
}
