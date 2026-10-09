// Libellés des questions de qualification. Identifiants et valeurs identiques à supabase/functions/_shared/survey.ts.

export interface SurveyQuestion {
  id: string;
  title: string;
  hint?: string;
  options: { value: string; label: string }[];
}

export const SURVEY_QUESTIONS: SurveyQuestion[] = [
  {
    id: "missed_calls",
    title: "La semaine dernière, combien d'appels avez-vous manqués ?",
    hint: "Regardez votre journal d'appels si besoin.",
    options: [
      { value: "0", label: "Aucun" }, { value: "1-2", label: "1 à 2" }, { value: "3-5", label: "3 à 5" },
      { value: "6-10", label: "6 à 10" }, { value: "10+", label: "Plus de 10" }, { value: "unknown", label: "Je ne sais pas" },
    ],
  },
  {
    id: "after_miss",
    title: "Quand vous ratez un appel, que se passe-t-il le plus souvent ?",
    options: [
      { value: "call_back_hour", label: "Je rappelle dans l'heure" },
      { value: "call_back_evening", label: "Je rappelle le soir" },
      { value: "forget", label: "J'oublie parfois de rappeler" },
      { value: "no_message", label: "Je ne sais pas qui a appelé (pas de message)" },
    ],
  },
  {
    id: "quotes_per_month",
    title: "Combien de devis envoyez-vous par mois ?",
    options: [
      { value: "0-5", label: "0 à 5" }, { value: "6-15", label: "6 à 15" }, { value: "16-30", label: "16 à 30" }, { value: "30+", label: "Plus de 30" },
    ],
  },
  {
    id: "follow_up",
    title: "Relancez-vous vos devis restés sans réponse ?",
    options: [
      { value: "always", label: "Toujours" }, { value: "sometimes", label: "Parfois" },
      { value: "rarely", label: "Rarement" }, { value: "never", label: "Jamais" },
    ],
  },
  {
    id: "would_pay",
    title: "Quand RelaisArti sera disponible, l'abonnement coûtera 39 € par mois. Seriez-vous prêt à le prendre ?",
    options: [
      { value: "yes_launch", label: "Oui, dès l'ouverture" },
      { value: "yes_if_job", label: "Oui, si ça me fait signer au moins 1 chantier" },
      { value: "maybe", label: "Peut-être, je veux voir" },
      { value: "no_price", label: "Non, c'est trop cher" },
      { value: "no_need", label: "Non, je n'en ai pas besoin" },
    ],
  },
];

export const FREE_TEXT_QUESTION = "Qu'est-ce qui vous ferait l'adopter tout de suite ?";

/** Adresse de contact affichée (questions, données personnelles). */
export const CONTACT_EMAIL = "akpahstarker0@gmail.com";
