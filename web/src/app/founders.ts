/** Programme « Testeurs fondateurs » : métiers proposés et paliers de parrainage. */

export const TRADES = [
  "Plombier", "Chauffagiste", "Électricien", "Serrurier", "Couvreur", "Menuisier",
  "Peintre", "Maçon", "Carreleur", "Climaticien", "Multiservice", "Autre métier du bâtiment",
];

export interface Tier {
  referrals: number; // confrères au SIRET vérifié
  title: string;
  short: string;      // libellé court sous le cercle de la frise
  detail: string;
}

/** Avantages valables à l'ouverture commerciale. Pas d'argent, pas de « à vie » (voir les conditions). */
export const TIERS: Tier[] = [
  { referrals: 1, title: "Membre fondateur", short: "Membre fondateur", detail: "Accès en avant-première et groupe WhatsApp avec le fondateur" },
  { referrals: 3, title: "Tarif fondateur", short: "29 €/mois garanti", detail: "29 € au lieu de 39 € par mois, garanti 24 mois" },
  { referrals: 5, title: "2 mois offerts", short: "2 mois offerts", detail: "Et la configuration faite pour vous" },
  { referrals: 10, title: "6 mois offerts", short: "6 mois offerts", detail: "Le maximum du programme" },
];

/** Avantage du confrère invité (récompense des deux côtés). */
export const INVITEE_REWARD = "1 mois offert en plus";

/** Prix au lancement (HT). */
export const PRICE = 39;
export const FOUNDER_PRICE = 29;

export function currentTier(verified: number): Tier | null {
  return [...TIERS].reverse().find((t) => verified >= t.referrals) ?? null;
}

export function nextTier(verified: number): Tier | null {
  return TIERS.find((t) => verified < t.referrals) ?? null;
}
