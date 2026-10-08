import { parisParts } from "./followups.ts";
import type { RecapArtisan } from "./recap.ts";
import { parisDate } from "./recap.ts";
import type { SendSms } from "./twilio.ts";

/**
 * Bilan du mois par SMS, le 1er à 9 h (heure de Paris) : la récompense « soi » vient trouver l'artisan.
 * Seulement si le mois a eu de l'activité. « Votre meilleur mois » seulement si c'est vrai.
 */
export const MONTHLY_HOUR = 9;

export interface MonthFigures {
  wonCents: number;      // montant des devis gagnés dans le mois
  wonCount: number;
  missedCalls: number;   // appels manqués arrivés sur le numéro relais
  requests: number;      // demandes détaillées reçues
}

export interface MonthlyStore {
  candidates(month: string): Promise<RecapArtisan[]>;
  figures(artisanId: string, from: Date, to: Date): Promise<MonthFigures>;
  /** Meilleur montant gagné sur un mois complet, avant `before` (0 si aucun). */
  bestPreviousWonCents(artisanId: string, before: Date): Promise<number>;
  /** Marque le bilan du mois comme envoyé, de façon atomique. */
  claim(artisanId: string, month: string): Promise<boolean>;
}

export interface MonthlyDeps {
  store: MonthlyStore;
  sendSms: SendSms;
  appUrl: string;
  now?: () => Date;
}

const MONTHS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

export function isMonthlyTime(d: Date): boolean {
  return parisDate(d).endsWith("-01") && parisParts(d).hour === MONTHLY_HOUR;
}

/** Mois écoulé (heure de Paris) : bornes UTC [début, fin[ et clé « AAAA-MM ». */
export function previousMonth(now: Date): { key: string; label: string; from: Date; to: Date } {
  const [y, m] = parisDate(now).split("-").map(Number); // mois courant à Paris
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  // Minuit à Paris = 22 h ou 23 h UTC la veille ; on calcule le décalage réel de chaque borne.
  const parisMidnight = (year: number, month: number) => {
    const guess = new Date(Date.UTC(year, month - 1, 1, 0, 0));
    const offsetH = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "numeric", hourCycle: "h23" }).format(guess));
    return new Date(guess.getTime() - offsetH * 3_600_000);
  };
  return {
    key: `${py}-${String(pm).padStart(2, "0")}`,
    label: MONTHS[pm - 1],
    from: parisMidnight(py, pm),
    to: parisMidnight(y, m),
  };
}

const euros = (cents: number) => `${Math.round(cents / 100).toLocaleString("fr-FR").replace(/\s/g, " ")} €`;
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

export function monthlyBody(label: string, f: MonthFigures, bestBefore: number, link: string): string | null {
  if (!f.wonCents && !f.wonCount && !f.missedCalls && !f.requests) return null;
  const parts: string[] = [];
  if (f.wonCount) parts.push(`${euros(f.wonCents)} signés (${plural(f.wonCount, "chantier", "chantiers")})`);
  if (f.missedCalls) parts.push(plural(f.missedCalls, "appel récupéré", "appels récupérés"));
  if (f.requests) parts.push(plural(f.requests, "demande", "demandes"));
  const best = f.wonCents > 0 && f.wonCents > bestBefore && bestBefore > 0 ? " Votre meilleur mois !" : "";
  const nudge = !f.wonCount ? " Pensez à classer vos devis." : "";
  return `${label} : ${parts.join(", ")}.${best}${nudge} Voir : ${link}`;
}

export async function runMonthly(deps: MonthlyDeps): Promise<{ sent: number; skippedEmpty: number }> {
  const now = (deps.now ?? (() => new Date()))();
  const report = { sent: 0, skippedEmpty: 0 };
  if (!isMonthlyTime(now)) return report;

  const month = previousMonth(now);
  const link = `${deps.appUrl.replace(/\/$/, "")}/app/b/${month.key}`;
  for (const a of await deps.store.candidates(month.key)) {
    const figures = await deps.store.figures(a.id, month.from, month.to);
    const body = monthlyBody(month.label, figures, await deps.store.bestPreviousWonCents(a.id, month.from), link);
    if (!body) {
      report.skippedEmpty++;
      continue;
    }
    if (!(await deps.store.claim(a.id, month.key))) continue;
    try {
      await deps.sendSms(a.relay_number, a.owner_phone, body);
      report.sent++;
    } catch (err) {
      console.error("Échec bilan mensuel", { artisanId: a.id, err: String(err) });
    }
  }
  return report;
}
