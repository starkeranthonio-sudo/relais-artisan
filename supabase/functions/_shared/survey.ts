/**
 * Questions de qualification des testeurs (Mom Test : faits vécus, pas d'opinion sur l'idée).
 * Les identifiants et valeurs doivent rester identiques à web/src/app/survey.ts (libellés affichés).
 */
export const SURVEY: Record<string, readonly string[]> = {
  missed_calls: ["0", "1-2", "3-5", "6-10", "10+", "unknown"],               // appels manqués la semaine dernière
  after_miss: ["call_back_hour", "call_back_evening", "forget", "no_message"], // que se passe-t-il après un appel manqué
  quotes_per_month: ["0-5", "6-15", "16-30", "30+"],
  follow_up: ["always", "sometimes", "rarely", "never"],                     // relance des devis sans réponse
  would_pay: ["yes_launch", "yes_if_job", "maybe", "no_price", "no_need"],   // prêt à payer 39 €/mois à l'ouverture
};
export const REQUIRED_QUESTIONS = Object.keys(SURVEY);
export const FREE_TEXT_MAX = 500;

export type Answers = Record<string, string>;
export type Interest = "chaud" | "tiede" | "froid";

export function isValidAnswer(q: string, value: string): boolean {
  if (q === "free_text") return value.length <= FREE_TEXT_MAX;
  return SURVEY[q]?.includes(value) ?? false;
}

export function isComplete(a: Answers): boolean {
  return REQUIRED_QUESTIONS.every((q) => a[q]);
}

/**
 * Chaud : prêt à payer ET a le problème (appels manqués, oublis, devis peu relancés).
 * Froid : ne paiera pas, ou n'a manifestement pas le problème.
 * Tiède : le reste.
 */
export function interestOf(a: Answers): Interest {
  const pays = a.would_pay === "yes_launch" || a.would_pay === "yes_if_job";
  const hasPain = ["3-5", "6-10", "10+"].includes(a.missed_calls) ||
    ["forget", "no_message"].includes(a.after_miss) ||
    ["rarely", "never"].includes(a.follow_up);
  const noPain = a.missed_calls === "0" && a.follow_up === "always";
  if (a.would_pay === "no_price" || a.would_pay === "no_need" || noPain) return "froid";
  if (pays && hasPain) return "chaud";
  return "tiede";
}
