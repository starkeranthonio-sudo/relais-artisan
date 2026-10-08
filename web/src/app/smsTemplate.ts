// Même règles que le serveur (supabase/functions/_shared/missed-call.ts et twilio.ts) pour l'aperçu en direct.

export const DEFAULT_CLIENT_SMS = "{nom} : désolé d'avoir manqué votre appel. Décrivez votre besoin ici, je vous rappelle vite : {lien}";
export const SAMPLE_LINK = "https://relais-artisan.pages.dev/d/Ab3dEf7hJk";

const GSM7 = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€",
);
const REPLACEMENTS: Record<string, string> = { "œ": "oe", "Œ": "OE", "’": "'", "«": '"', "»": '"', "–": "-", "—": "-", "…": "..." };

/** Texte tel qu'il partira (ç → c, ê → e…), comme côté serveur. */
export function toGsm7(text: string): string {
  let out = "";
  for (const c of text) {
    if (GSM7.has(c)) out += c;
    else if (c in REPLACEMENTS) out += REPLACEMENTS[c];
    else {
      const base = c.normalize("NFD").replace(/[̀-ͯ]/g, "");
      if ([...base].every((b) => GSM7.has(b))) out += base;
    }
  }
  return out;
}

export function renderClientSms(template: string, businessName: string, link = SAMPLE_LINK): string {
  return template.replaceAll("{nom}", businessName).replaceAll("{lien}", link).trim();
}

export type TemplateCheck = { ok: true; length: number } | { ok: false; length: number; reason: string };

export function checkTemplate(template: string, businessName: string): TemplateCheck {
  const length = toGsm7(renderClientSms(template, businessName)).length;
  if (!template.includes("{lien}")) return { ok: false, length, reason: "Ajoutez {lien} : c'est le lien où le client décrit son besoin." };
  if (length > 160) return { ok: false, length, reason: `Trop long pour 1 SMS (${length}/160).` };
  return { ok: true, length };
}
