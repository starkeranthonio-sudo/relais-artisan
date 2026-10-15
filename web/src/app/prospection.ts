import { supabase } from "../lib/supabase.ts";
import { toE164 } from "./format.ts";

// Prospection du fondateur : liste saisie à la main, messages envoyés un par un depuis son téléphone.

export type ProspectSource = "google_maps" | "leboncoin" | "pages_jaunes" | "autre";
export type ProspectStatus = "nouveau" | "contacte" | "interesse" | "pas_interesse" | "stop";
export type Channel = "sms" | "whatsapp" | "appel";

export interface Prospect {
  id: string;
  code: string;
  business_name: string;
  first_name: string | null;
  trade: string | null;
  city: string | null;
  phone: string;
  source: ProspectSource;
  status: ProspectStatus;
  contact_count: number;
  last_contacted_at: string | null;
  last_channel: Channel | null;
  created_at: string;
  google_reviews: number | null;
}

export interface Progress {
  clicked: boolean;
  registered: boolean;
  test_done: boolean;
  completed: boolean;
}

export const SOURCES: { value: ProspectSource; label: string; inText: string }[] = [
  { value: "google_maps", label: "Google Maps", inText: "Google Maps" },
  { value: "leboncoin", label: "Leboncoin", inText: "Leboncoin" },
  { value: "pages_jaunes", label: "Pages Jaunes", inText: "les Pages Jaunes" },
  { value: "autre", label: "Autre", inText: "internet" },
];

export const DAILY_LIMIT = 50;
export const FOLLOW_UP_AFTER_DAYS = 3;

export const DEFAULT_TEMPLATES = {
  first:
    "{debut}, chaque appel manqué, c'est un client perdu.{perte} {solution} Ça vous dérangerait de le tester ? 1 min sur votre téléphone : {lien}\nSTOP pour ne plus recevoir",
  followUp:
    "{bonjour}, je me permets de revenir vers vous : chaque appel manqué, c'est un client perdu. RelaisArti gère vos appels manqués à votre place. Ça vous dérangerait de le tester ? 1 min sur votre téléphone : {lien}\nSTOP pour ne plus recevoir",
};
export type Templates = typeof DEFAULT_TEMPLATES;

export const prospectLink = (code: string) => `${window.location.origin}/testeurs?p=${code}`;

// Ce que coûtent 5 appels manqués par mois, selon le métier : montants prudents (bas des fourchettes de prix 2026).
// Dépannage (plomberie, électricité, chauffage : 150 à 450 € l'intervention) : 5 × 200 € = 1 000 €/mois.
// Métiers à devis : 5 appels manqués ≈ au moins 1 chantier perdu (peinture ≈ 1 200 € la pièce, carrelage ≈ 1 500 € la salle de bain).
const REPAIR_TRADES = ["Plombier", "Chauffagiste", "Électricien", "Serrurier", "Climaticien", "Multiservice"];
const QUOTE_JOB: Record<string, number> = { Peintre: 1200, Carreleur: 1500 };
const euros = (n: number) => `${n.toLocaleString("fr-FR").replace(/\s/g, " ")} €`;

function lossFor(trade: string | null): string {
  if (trade && REPAIR_TRADES.includes(trade)) {
    return ` 5 appels manqués par mois, c'est environ ${euros(1000)} de dépannages qui partent chez un concurrent : ${euros(12000)} par an.`;
  }
  const job = trade ? QUOTE_JOB[trade] : undefined;
  if (job) return ` 5 appels manqués par mois, c'est au moins un chantier, environ ${euros(job)} qui partent chez un concurrent : ${euros(job * 12)} par an.`;
  return ""; // couvreur, menuisier, maçon… : pas de chiffre fiable, on n'en invente pas
}

/** « Bonjour Micael » ou, sans prénom connu, « Bonjour l'équipe de Durand Plomberie » (« d'… » devant une voyelle). */
export function greeting(p: Pick<Prospect, "first_name" | "business_name">): string {
  if (p.first_name) return `Bonjour ${p.first_name}`;
  const name = p.business_name.trim();
  return `Bonjour l'équipe ${/^[aeiouyhàâéèêëîïôöûü]/i.test(name) ? "d'" : "de "}${name}`;
}

export function buildMessage(template: string, p: Prospect): string {
  const source = SOURCES.find((s) => s.value === p.source)?.inText ?? "internet";
  const hello = greeting(p);
  const opening = hello;
  const repair = !p.trade || REPAIR_TRADES.includes(p.trade);
  return template
    .replaceAll("{debut}", opening)
    .replaceAll("{bonjour}", hello)
    .replaceAll("{perte}", lossFor(p.trade))
    .replaceAll("{solution}", repair
      ? "RelaisArti gère vos appels manqués : le client est pris en charge à votre nom et vous ne perdez pas le contrat."
      : "RelaisArti gère vos appels manqués et relance vos devis : vous ne laissez plus filer de travaux.")
    .replaceAll("{entreprise}", p.business_name)
    .replaceAll("{source}", source)
    .replaceAll("{ville}", p.city ?? "")
    .replaceAll("{metier}", p.trade?.toLowerCase() ?? "")
    .replaceAll("{lien}", prospectLink(p.code));
}

export const isMobile = (e164: string) => /^\+33[67]\d{8}$/.test(e164);

/** Lien « SMS » qui ouvre l'appli Messages avec le texte prérempli (iPhone : « & », Android : « ? »). */
export function smsHref(phone: string, body: string): string {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return `sms:${phone}${ios ? "&" : "?"}body=${encodeURIComponent(body)}`;
}
export const whatsappHref = (phone: string, body: string) => `https://wa.me/${phone.replace("+", "")}?text=${encodeURIComponent(body)}`;

/** À relancer : un seul message envoyé, il y a au moins 3 jours, et pas d'inscription depuis. */
export function needsFollowUp(p: Prospect, progress: Progress | undefined, now = Date.now()): boolean {
  return p.status === "contacte" && p.contact_count === 1 && !progress?.registered &&
    p.last_contacted_at !== null && now - new Date(p.last_contacted_at).getTime() >= FOLLOW_UP_AFTER_DAYS * 86_400_000;
}

const TEMPLATES_KEY = "ra_prospection_templates_v6";
export function loadTemplates(): Templates {
  try {
    const saved = JSON.parse(localStorage.getItem(TEMPLATES_KEY) ?? "null");
    if (saved && typeof saved.first === "string" && typeof saved.followUp === "string") return saved;
  } catch { /* stockage indisponible : modèles par défaut */ }
  return DEFAULT_TEMPLATES;
}
export function saveTemplates(t: Templates) {
  try {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(t));
  } catch { /* ignoré */ }
}

export type NewProspect = Pick<Prospect, "business_name" | "first_name" | "trade" | "city" | "phone" | "source">;

/**
 * Liste collée ou fichier CSV : une ligne par artisan, « ; » ou tabulation entre les colonnes,
 * dans l'ordre entreprise ; téléphone ; métier ; ville ; prénom ; source. Ligne d'en-tête ignorée.
 */
export function parseProspectList(text: string): { rows: NewProspect[]; rejected: string[] } {
  const rows: NewProspect[] = [];
  const rejected: string[] = [];
  const sources = SOURCES.map((x) => x.value as string);
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || /^entreprise[;\t]/i.test(line)) continue;
    const [name = "", rawPhone = "", trade = "", city = "", first = "", source = ""] = line.split(/[;\t]/).map((c) => c.trim());
    const phone = toE164(rawPhone);
    if (!name || !phone) {
      rejected.push(line);
      continue;
    }
    rows.push({
      business_name: name.slice(0, 100), phone, trade: trade.slice(0, 60) || null, city: city.slice(0, 60) || null,
      first_name: first.slice(0, 50) || null, source: (sources.includes(source) ? source : "autre") as ProspectSource,
    });
  }
  return { rows, rejected };
}

function check<T>(r: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code });
  return r.data as T;
}

const COLUMNS = "id, code, business_name, first_name, trade, city, phone, source, status, contact_count, last_contacted_at, last_channel, created_at, google_reviews";

export const prospectApi = {
  async list(): Promise<Prospect[]> {
    return check(await supabase.from("prospects").select(COLUMNS).order("created_at", { ascending: false }));
  },
  async progress(): Promise<Map<string, Progress>> {
    const rows = check(await supabase.rpc("my_prospect_progress")) as ({ code: string } & Progress)[];
    return new Map(rows.map((r) => [r.code, r]));
  },
  /** Ajout en lot ; les numéros déjà dans la liste sont ignorés. Renvoie les fiches réellement ajoutées. */
  async addMany(rows: NewProspect[]): Promise<Prospect[]> {
    return check(await supabase.from("prospects").upsert(rows, { onConflict: "owner_id,phone", ignoreDuplicates: true }).select(COLUMNS));
  },
  async add(p: NewProspect): Promise<Prospect> {
    return check(await supabase.from("prospects").insert(p).select(COLUMNS).single());
  },
  async markContacted(p: Prospect, channel: Channel): Promise<Prospect> {
    // Un appel n'est pas un message : le prochain SMS reste le premier message, pas la relance.
    const patch = {
      contact_count: p.contact_count + (channel === "appel" ? 0 : 1),
      last_contacted_at: new Date().toISOString(),
      last_channel: channel,
      status: p.status === "nouveau" ? "contacte" : p.status,
    };
    return check(await supabase.from("prospects").update(patch).eq("id", p.id).select(COLUMNS).single());
  },
  /** Le message n'est finalement pas parti (iMessage, erreur d'envoi) : on annule le dernier contact noté. */
  async undoContact(p: Prospect): Promise<Prospect> {
    const count = Math.max(0, p.contact_count - 1);
    const patch = {
      contact_count: count,
      last_contacted_at: count === 0 ? null : p.last_contacted_at,
      last_channel: count === 0 ? null : p.last_channel,
      status: count === 0 && p.status === "contacte" ? "nouveau" : p.status,
    };
    return check(await supabase.from("prospects").update(patch).eq("id", p.id).select(COLUMNS).single());
  },
  async setStatus(p: Prospect, status: ProspectStatus): Promise<Prospect> {
    return check(await supabase.from("prospects").update({ status }).eq("id", p.id).select(COLUMNS).single());
  },
  async remove(p: Prospect): Promise<void> {
    check(await supabase.from("prospects").delete().eq("id", p.id));
  },
};
