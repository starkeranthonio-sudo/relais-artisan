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

/** Envoie un SMS via l'API REST Twilio. */
export function twilioSender(accountSid: string, authToken: string): SendSms {
  return async (from, to, body) => {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ From: from, To: to, Body: body }),
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
