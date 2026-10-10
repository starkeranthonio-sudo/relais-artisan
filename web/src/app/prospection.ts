import { supabase } from "../lib/supabase.ts";

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
    "{bonjour}, je m'appelle Starker. J'ai trouvé {entreprise} sur {source}. Je lance RelaisArti : quand vous ratez un appel sur un chantier, votre client reçoit tout de suite un SMS à votre nom. Je cherche quelques artisans pour le tester, ça prend 3 min : {lien}\nRépondez STOP pour ne plus être contacté.",
  followUp:
    "{bonjour}, c'est Starker de RelaisArti. Je me permets de vous relancer : je cherche encore quelques artisans pour tester l'outil, ça prend 3 min : {lien}\nRépondez STOP pour ne plus être contacté.",
};
export type Templates = typeof DEFAULT_TEMPLATES;

export const prospectLink = (code: string) => `${window.location.origin}/testeurs?p=${code}`;

export function buildMessage(template: string, p: Prospect): string {
  const source = SOURCES.find((s) => s.value === p.source)?.inText ?? "internet";
  return template
    .replaceAll("{bonjour}", p.first_name ? `Bonjour ${p.first_name}` : "Bonjour")
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

const TEMPLATES_KEY = "ra_prospection_templates";
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

function check<T>(r: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code });
  return r.data as T;
}

const COLUMNS = "id, code, business_name, first_name, trade, city, phone, source, status, contact_count, last_contacted_at, last_channel, created_at";

export const prospectApi = {
  async list(): Promise<Prospect[]> {
    return check(await supabase.from("prospects").select(COLUMNS).order("created_at", { ascending: false }));
  },
  async progress(): Promise<Map<string, Progress>> {
    const rows = check(await supabase.rpc("my_prospect_progress")) as ({ code: string } & Progress)[];
    return new Map(rows.map((r) => [r.code, r]));
  },
  async add(p: Pick<Prospect, "business_name" | "first_name" | "trade" | "city" | "phone" | "source">): Promise<Prospect> {
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
  async setStatus(p: Prospect, status: ProspectStatus): Promise<Prospect> {
    return check(await supabase.from("prospects").update({ status }).eq("id", p.id).select(COLUMNS).single());
  },
  async remove(p: Prospect): Promise<void> {
    check(await supabase.from("prospects").delete().eq("id", p.id));
  },
};
