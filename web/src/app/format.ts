import type { Lead, Quote, Urgency } from "./types.ts";

export function formatPhone(e164: string): string {
  const m = /^\+33(\d{9})$/.exec(e164);
  return m ? ("0" + m[1]).replace(/(\d{2})(?=\d)/g, "$1 ") : e164;
}

/** "06 12 34 56 78" → "+33612345678" ; renvoie null si ce n'est pas un numéro français valide. */
export function toE164(raw: string): string | null {
  const c = raw.replace(/[\s.\-()]/g, "");
  if (/^\+33[1-9]\d{8}$/.test(c)) return c;
  if (/^0033[1-9]\d{8}$/.test(c)) return "+" + c.slice(2);
  if (/^0[1-9]\d{8}$/.test(c)) return "+33" + c.slice(1);
  return null;
}

/** Numéro relais sans espaces au format national, pour le code de renvoi : **61*0939012345# */
export function nationalDigits(e164: string): string {
  return formatPhone(e164).replace(/\s/g, "");
}

const euroFmt = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
export const euros = (cents: number) => euroFmt.format(Math.round(cents / 100));

export function parseEuros(raw: string): number | null {
  const n = Number(raw.replace(/\s/g, "").replace(",", ".").replace("€", ""));
  return raw.trim() && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

export function shortDate(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(new Date(iso));
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return "hier";
  if (d < 7) return `il y a ${d} jours`;
  return `le ${shortDate(iso)}`;
}

export const URGENCY_LABEL: Record<Urgency, string> = {
  urgent: "Urgent",
  week: "Cette semaine",
  flexible: "Pas pressé",
};

export function clientLabel(l: Pick<Lead, "client_name" | "client_phone">): string {
  return l.client_name?.trim() || formatPhone(l.client_phone);
}

export type LeadStage = "waiting_form" | "to_handle" | "contacted" | "quoted" | "closed";

export function leadStage(l: Lead): LeadStage {
  if (l.status === "closed" || (l.quote && l.quote.status !== "pending")) return "closed";
  if (l.quote) return "quoted";
  if (l.status === "contacted") return "contacted";
  if (l.form_submitted_at) return "to_handle";
  return "waiting_form";
}

export const STAGE_LABEL: Record<LeadStage, string> = {
  waiting_form: "SMS envoyé",
  to_handle: "À rappeler",
  contacted: "Contacté",
  quoted: "Devis envoyé",
  closed: "Terminé",
};

/** Où en sont les relances d'un devis, en une phrase. */
export function followupStatus(q: Quote): string {
  if (q.status === "won") return "Devis gagné";
  if (q.status === "lost") return "Devis perdu";
  if (q.stop_reason === "client_replied") return "Le client a répondu : relances arrêtées";
  if (q.stop_reason === "opted_out") return "Le client a demandé l'arrêt des SMS";
  if (q.followups_sent >= 3 || q.stop_reason === "completed") return "3 relances envoyées, sans réponse";
  const next = q.next_followup_at ? ` · prochaine le ${shortDate(q.next_followup_at)}` : "";
  return q.followups_sent === 0 ? `1re relance le ${shortDate(q.next_followup_at ?? q.sent_at)}` : `Relance ${q.followups_sent}/3 envoyée${next}`;
}
