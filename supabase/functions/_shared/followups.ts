import type { SendSms } from "./twilio.ts";
import type { Artisan, Store } from "./types.ts";

/** Relances à J+3, J+7 et J+14 après l'envoi du devis. */
export const FOLLOWUP_DAYS: readonly number[] = [3, 7, 14];
const DAY_MS = 24 * 60 * 60 * 1000;
/** Si l'envoi échoue, on réessaie une heure plus tard. */
const RETRY_MS = 60 * 60 * 1000;

/**
 * Plage d'envoi : du lundi au samedi, de 9 h à 19 h (heure de Paris).
 * Les opérateurs filtrent les SMS commerciaux le dimanche et les jours fériés, et hors 8 h – 21 h 30 ;
 * on reste largement à l'intérieur par politesse. Hors plage, la relance attend le prochain passage.
 */
const SEND_FROM_HOUR = 9;
const SEND_UNTIL_HOUR = 19;

export interface DueQuote {
  id: string;
  sent_at: string;
  followups_sent: number;
  artisan: Artisan;
  lead: { id: string; client_phone: string; replied_at: string | null; opted_out: boolean };
}

export type StopReason = "client_replied" | "opted_out" | "completed";

export interface FollowupStore {
  dueQuotes(now: Date, limit: number): Promise<DueQuote[]>;
  /**
   * Réserve la relance n° followupsSent+1 (mise à jour conditionnelle sur followups_sent) pour qu'un devis
   * ne soit jamais relancé deux fois si deux passages se chevauchent. Renvoie false si déjà réservée.
   */
  claimFollowup(quoteId: string, followupsSent: number, nextFollowupAt: Date | null, stopReason: StopReason | null): Promise<boolean>;
  /** Échec d'envoi : on annule la réservation et on réessaie plus tard. */
  releaseFollowup(quoteId: string, followupsSent: number, retryAt: Date): Promise<void>;
  stop(quoteId: string, reason: StopReason): Promise<void>;
}

export interface FollowupDeps {
  store: Store;
  followups: FollowupStore;
  sendSms: SendSms;
  now?: () => Date;
}

export interface RunReport {
  sent: number;
  stopped: number;
  waiting: number; // hors plage horaire
  failed: number;
}

export function parisParts(d: Date): { weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", weekday: "short", hour: "numeric", hourCycle: "h23" })
    .formatToParts(d);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((p) => p.type === "weekday")!.value);
  return { weekday, hour: Number(parts.find((p) => p.type === "hour")!.value) };
}

export function inSendingWindow(d: Date): boolean {
  const { weekday, hour } = parisParts(d);
  return weekday !== 0 && hour >= SEND_FROM_HOUR && hour < SEND_UNTIL_HOUR;
}

export function frenchDate(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit" }).format(new Date(iso));
}

/** Texte de la relance n° `n` (1 à 3). Tient en un SMS (160 caractères, alphabet GSM) pour un nom d'entreprise courant. */
export function followupBody(n: 1 | 2 | 3, businessName: string, sentAt: string): string {
  const date = frenchDate(sentAt);
  switch (n) {
    case 1:
      return `${businessName} : bonjour, avez-vous pu consulter notre devis du ${date} ? Une question ? Répondez à ce SMS. STOP pour ne plus recevoir de relance`;
    case 2:
      return `${businessName} : je reviens vers vous pour le devis du ${date}. On planifie les travaux ? Répondez à ce SMS. STOP pour ne plus recevoir de relance`;
    case 3:
      return `${businessName} : dernier message pour le devis du ${date}. Si le projet tient toujours, répondez OUI et je vous rappelle. STOP pour ne plus recevoir de relance`;
  }
}

/** Un passage du planificateur : envoie les relances dues, stoppe celles qui n'ont plus lieu d'être. */
export async function runFollowups(deps: FollowupDeps, limit = 100): Promise<RunReport> {
  const now = (deps.now ?? (() => new Date()))();
  const report: RunReport = { sent: 0, stopped: 0, waiting: 0, failed: 0 };

  for (const q of await deps.followups.dueQuotes(now, limit)) {
    if (q.lead.opted_out) {
      await deps.followups.stop(q.id, "opted_out");
      report.stopped++;
      continue;
    }
    if (q.lead.replied_at && new Date(q.lead.replied_at) > new Date(q.sent_at)) {
      await deps.followups.stop(q.id, "client_replied");
      report.stopped++;
      continue;
    }
    if (!inSendingWindow(now)) {
      report.waiting++;
      continue;
    }

    const n = (q.followups_sent + 1) as 1 | 2 | 3;
    const nextDays = FOLLOWUP_DAYS[n]; // undefined après la 3e relance
    const nextAt = nextDays === undefined ? null : new Date(new Date(q.sent_at).getTime() + nextDays * DAY_MS);
    if (!(await deps.followups.claimFollowup(q.id, q.followups_sent, nextAt, nextAt ? null : "completed"))) continue;

    const body = followupBody(n, q.artisan.business_name, q.sent_at);
    try {
      const { sid } = await deps.sendSms(q.artisan.relay_number, q.lead.client_phone, body);
      await deps.store.insertMessage({ artisanId: q.artisan.id, leadId: q.lead.id, direction: "outbound_client", body, twilioSid: sid });
      report.sent++;
    } catch (err) {
      console.error("Échec relance devis", { quoteId: q.id, n, err: String(err) });
      await deps.followups.releaseFollowup(q.id, q.followups_sent, new Date(now.getTime() + RETRY_MS));
      report.failed++;
    }
  }
  return report;
}
