/** Paliers de parrainage (identiques à web/src/app/founders.ts). */
export const TIERS = [
  { referrals: 1, title: "Membre fondateur" },
  { referrals: 3, title: "Tarif fondateur" },
  { referrals: 5, title: "2 mois offerts" },
  { referrals: 10, title: "6 mois offerts" },
] as const;

export const tierReachedAt = (count: number) => TIERS.find((t) => t.referrals === count) ?? null;
export const nextTierAfter = (count: number) => TIERS.find((t) => t.referrals > count) ?? null;

const firstName = (name: string) => name.trim().split(/[\s-]/)[0].slice(0, 15);

/**
 * SMS au parrain quand un filleul va au bout : merci, progression ou palier débloqué, et toujours son lien
 * (« un autre nom en tête ? ») pour relancer le partage.
 */
export function sponsorSms(sponsorFirstName: string, refereeFirstName: string, count: number, link: string): string {
  const me = firstName(sponsorFirstName);
  const friend = firstName(refereeFirstName) || "Un confrère";
  const reached = tierReachedAt(count);
  const next = nextTierAfter(count);
  if (reached && !next) return `Bravo ${me} ! Avec ${friend}, 10 confrères : « ${reached.title} » débloqué. Merci ! Votre lien : ${link}`;
  if (reached) return `Bravo ${me} ! Avec ${friend}, vous avez ${count} confrère${count > 1 ? "s" : ""} : « ${reached.title} » débloqué. Votre lien : ${link}`;
  return `${friend} s'est inscrit grâce à vous, merci ! ${count} sur ${next!.referrals} pour « ${next!.title} ». Votre lien : ${link}`;
}
