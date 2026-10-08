import { parisParts } from "./followups.ts";
import type { SendSms } from "./twilio.ts";

/**
 * SMS récapitulatif de fin de journée (déclencheur externe calé sur l'inquiétude du soir : « qui dois-je rappeler ? »).
 * Envoyé du lundi au samedi entre 18 h et 19 h (heure de Paris), une fois par jour, et seulement s'il y a une action à faire.
 */
export const RECAP_HOUR = 18;

export interface RecapArtisan {
  id: string;
  owner_phone: string;
  relay_number: string;
}

export interface RecapContent {
  toCall: string[];       // clients ayant décrit leur besoin, pas encore rappelés (prénoms ou numéros)
  repliedQuotes: number;  // devis en attente dont le client a répondu
  quotesToClose: number;  // devis relancés 3 fois sans réponse : à classer gagné / perdu
}

export interface RecapStore {
  candidates(today: string): Promise<RecapArtisan[]>;
  content(artisanId: string): Promise<RecapContent>;
  /** Marque le récap du jour comme fait, de façon atomique. false si un autre passage l'a déjà pris. */
  claim(artisanId: string, today: string): Promise<boolean>;
}

export interface RecapDeps {
  store: RecapStore;
  sendSms: SendSms;
  appUrl: string;
  now?: () => Date;
}

/** Date du jour à Paris (AAAA-MM-JJ). */
export function parisDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(d);
}

export function isRecapTime(d: Date): boolean {
  const { weekday, hour } = parisParts(d);
  return weekday !== 0 && hour === RECAP_HOUR;
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Texte du récap, ou null s'il n'y a rien à faire. Tient en un SMS (160 caractères). */
export function recapBody(c: RecapContent, link: string): string | null {
  const head = "Ce soir : ";
  const tail = `. Voir : ${link}`;
  const others: string[] = [];
  if (c.repliedQuotes) others.push(plural(c.repliedQuotes, "réponse à vos devis", "réponses à vos devis"));
  if (c.quotesToClose) others.push(`${c.quotesToClose} devis à classer`);
  if (!c.toCall.length && !others.length) return null;

  // On cite jusqu'à 2 noms, puis on retire les noms s'il le faut pour tenir en 160 caractères.
  const build = (names: string[]) => {
    const parts = [...others];
    if (c.toCall.length) {
      const who = names.length ? ` (${names.join(", ")}${c.toCall.length > names.length ? "…" : ""})` : "";
      parts.unshift(`${plural(c.toCall.length, "client à rappeler", "clients à rappeler")}${who}`);
    }
    return head + parts.join(", ") + tail;
  };
  for (const names of [c.toCall.slice(0, 2), c.toCall.slice(0, 1), []]) {
    const body = build(names.map((n) => n.slice(0, 20)));
    if (body.length <= 160) return body;
  }
  return build([]);
}

export interface RecapReport {
  sent: number;
  skippedEmpty: number;
}

export async function runRecap(deps: RecapDeps): Promise<RecapReport> {
  const now = (deps.now ?? (() => new Date()))();
  const report: RecapReport = { sent: 0, skippedEmpty: 0 };
  if (!isRecapTime(now)) return report;

  const today = parisDate(now);
  // /app/r : lien court ; l'ouverture est comptée « depuis le récap » dans la mesure d'usage.
  const link = `${deps.appUrl.replace(/\/$/, "")}/app/r`;
  for (const a of await deps.store.candidates(today)) {
    // Rien à faire pour l'instant : on ne marque pas la journée, un passage plus tard (avant 19 h) pourra envoyer.
    const body = recapBody(await deps.store.content(a.id), link);
    if (!body) {
      report.skippedEmpty++;
      continue;
    }
    if (!(await deps.store.claim(a.id, today))) continue;
    try {
      await deps.sendSms(a.relay_number, a.owner_phone, body);
      report.sent++;
    } catch (err) {
      console.error("Échec récap du soir", { artisanId: a.id, err: String(err) });
    }
  }
  return report;
}
