import { randomToken } from "./missed-call.ts";
import { formatFrench, toE164 } from "./phone.ts";
import { type Result, startTestDrive, type TesterArtisan, type TesterDeps, verifySiret } from "./testers.ts";
import { type Answers, interestOf, isComplete, isValidAnswer } from "./survey.ts";
import type { SendSms } from "./twilio.ts";

/**
 * Parcours « Testeurs fondateurs » RelaisArti, sans compte : infos → essai → SIRET (ou photo de devis) → lien de parrainage.
 * Le testeur est identifié par un jeton secret (lien personnel envoyé par SMS).
 */

export type SiretStatus = "none" | "verified" | "pending_manual" | "rejected";
export type FunnelStep =
  | "info_submitted" | "test_sent" | "survey_answer" | "survey_completed" | "siret_verified" | "siret_manual" | "siret_skipped" | "completed";

export interface Tester {
  id: string;
  token: string;
  referral_code: string;
  first_name: string;
  last_name: string;
  siret_status: SiretStatus;
  completed_at: string | null;
  survey: Answers;
  survey_completed_at: string | null;
  artisan: TesterArtisan & { test_drives_used: number; siret_company_name: string | null };
}

export interface NewTester {
  businessName: string;
  firstName: string;
  lastName: string;
  phone: string;
  trade: string | null;
  postalCode: string | null;
  referredBy: string | null;
  token: string;
}

export interface ProgramStore {
  findByPhone(phone: string): Promise<{ token: string } | null>;
  findByToken(token: string): Promise<Tester | null>;
  findIdByReferralCode(code: string): Promise<string | null>;
  createTester(t: NewTester): Promise<Tester>;
  setSiretStatus(testerId: string, status: SiretStatus, proof?: { path: string; siret: string | null }): Promise<void>;
  markCompleted(testerId: string, at: Date): Promise<void>;
  /** Filleuls inscrits avec le lien, et filleuls « comptés » (parcours terminé avec l'essai fait). */
  referralCounts(testerId: string): Promise<{ registered: number; counted: number }>;
  uploadProof(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  logFunnel(testerId: string, step: FunnelStep, sessionId: string | null, props?: Record<string, unknown>): Promise<void>;
  /** Suppression RGPD : fiche, demandes, messages, photo de devis. L'entonnoir ne garde que des étapes anonymes. */
  deleteTester(testerId: string): Promise<void>;
  saveAnswers(testerId: string, answers: Answers): Promise<void>;
  completeSurvey(testerId: string, interest: "chaud" | "tiede" | "froid", at: Date): Promise<void>;
}

export interface ProgramDeps {
  store: ProgramStore;
  testerDeps: TesterDeps; // essai et vérification SIRET (réutilisés)
  sendSms: SendSms;
  appUrl: string;
  newToken?: () => string;
  now?: () => Date;
}

const fail = (status: number, error: string, code?: string) => ({ ok: false as const, status, error, ...(code ? { code } : {}) });
const personalLink = (appUrl: string, token: string) => `${appUrl.replace(/\/$/, "")}/testeurs/moi/${token}`;
const clean = (s: unknown, max: number) => (typeof s === "string" ? s.trim().replace(/\s+/g, " ").slice(0, max) : "");

const referralLink = (appUrl: string, code: string) => `${appUrl.replace(/\/$/, "")}/testeurs?parrain=${code}`;

/** Renvoyé seulement à un numéro déjà inscrit qui se réinscrit (lien perdu). */
export function personalLinkSms(firstName: string, link: string): string {
  return `RelaisArti - ${firstName}, votre espace testeur (parrainage et avantages) : ${link}`;
}

/** Dernier message du parcours : merci, on vous recontacte ; lien de parrainage seulement si SIRET fourni. */
export function thankYouSms(firstName: string, link: string | null): string {
  const name = firstName.split(/[\s-]/)[0].slice(0, 15); // l'expéditeur « RelaisArti » s'affiche déjà
  return link
    ? `Merci ${name}, vous voilà testeur fondateur ! On vous contacte à l'ouverture. Votre lien de parrainage : ${link}`
    : `Merci ${name}, vous voilà inscrit comme testeur ! On vous contacte dès que l'outil sera disponible.`;
}

/** SIRET ajouté après la fin du parcours : on envoie le lien de parrainage. */
export function referralLinkSms(firstName: string, link: string): string {
  return `${firstName.split(/[\s-]/)[0].slice(0, 15)}, votre SIRET est enregistré. Votre lien de parrainage à partager : ${link}`;
}

export interface RegisterInput {
  businessName: unknown;
  firstName: unknown;
  lastName: unknown;
  phone: unknown;
  trade?: unknown;
  postalCode?: unknown;
  ref?: unknown;
  sessionId?: unknown;
}

/** Étape « Infos » : crée le testeur et envoie son lien personnel par SMS. */
export async function register(input: RegisterInput, deps: ProgramDeps): Promise<Result<{ token: string } | { existing: true }>> {
  const businessName = clean(input.businessName, 100);
  const firstName = clean(input.firstName, 50);
  const lastName = clean(input.lastName, 50);
  const phone = toE164(clean(input.phone, 20));
  const postalCode = clean(input.postalCode, 5);
  if (businessName.length < 2) return fail(400, "Indiquez le nom de votre entreprise.");
  if (firstName.length < 1 || lastName.length < 1) return fail(400, "Indiquez votre prénom et votre nom.");
  if (!/^\+33[67]\d{8}$/.test(phone)) return fail(400, "Numéro de portable invalide (ex. : 06 12 34 56 78).");
  if (postalCode && !/^\d{5}$/.test(postalCode)) return fail(400, "Code postal : 5 chiffres.");

  // Déjà inscrit : on ne révèle rien à l'écran, on renvoie son lien personnel par SMS au numéro inscrit.
  const existing = await deps.store.findByPhone(phone);
  if (existing) {
    await sendQuietly(deps, phone, personalLinkSms(firstName, personalLink(deps.appUrl, existing.token)));
    return { ok: true, value: { existing: true } };
  }

  const ref = clean(input.ref, 32).toLowerCase();
  const referredBy = ref ? await deps.store.findIdByReferralCode(ref) : null;
  const token = (deps.newToken ?? (() => randomToken(16)))();
  const tester = await deps.store.createTester({
    businessName, firstName, lastName, phone, token, referredBy,
    trade: clean(input.trade, 60) || null,
    postalCode: postalCode || null,
  });
  await deps.store.logFunnel(tester.id, "info_submitted", sessionOf(input.sessionId), { ref: ref || null });
  // Pas de SMS RelaisArti ici : le premier SMS reçu est celui de l'essai ; le remerciement arrive à la fin.
  return { ok: true, value: { token } };
}

export interface TesterState {
  firstName: string;
  businessName: string;
  phone: string;
  testDrivesUsed: number;
  siretStatus: SiretStatus;
  companyName: string | null;
  completed: boolean;
  surveyDone: boolean;
  answers: Answers;
  referralCode: string | null; // seulement si le SIRET est vérifié ou en cours de vérification manuelle
  referrals: { registered: number; counted: number };
}

export async function getState(token: string, deps: ProgramDeps): Promise<Result<TesterState>> {
  const t = await deps.store.findByToken(token);
  if (!t) return fail(404, "Lien invalide.");
  const canRefer = t.siret_status === "verified" || t.siret_status === "pending_manual";
  return {
    ok: true,
    value: {
      firstName: t.first_name,
      businessName: t.artisan.business_name,
      phone: formatFrench(t.artisan.owner_phone),
      testDrivesUsed: t.artisan.test_drives_used,
      siretStatus: t.siret_status,
      companyName: t.artisan.siret_company_name,
      completed: t.completed_at !== null,
      surveyDone: t.survey_completed_at !== null,
      answers: t.survey ?? {},
      referralCode: canRefer ? t.referral_code : null,
      referrals: await deps.store.referralCounts(t.id),
    },
  };
}

export async function testDrive(token: string, sessionId: unknown, deps: ProgramDeps): Promise<Result<null>> {
  const t = await deps.store.findByToken(token);
  if (!t) return fail(404, "Lien invalide.");
  const r = await startTestDrive(t.artisan, deps.testerDeps);
  if (r.ok) await deps.store.logFunnel(t.id, "test_sent", sessionOf(sessionId));
  return r;
}

export async function checkSiret(token: string, siret: unknown, sessionId: unknown, deps: ProgramDeps): Promise<Result<{ companyName: string }>> {
  const t = await deps.store.findByToken(token);
  if (!t) return fail(404, "Lien invalide.");
  const r = await verifySiret(t.artisan, String(siret ?? ""), deps.testerDeps);
  if (r.ok) {
    await deps.store.setSiretStatus(t.id, "verified");
    await deps.store.logFunnel(t.id, "siret_verified", sessionOf(sessionId));
    await sendReferralIfAlreadyDone(t, deps);
    return r;
  }
  // Introuvable dans la base publique : l'interface propose la photo d'un devis.
  return r.status === 404 ? fail(404, r.error, "not_found") : r;
}

export const PROOF_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

/** Vérification manuelle : photo (ou PDF) d'un devis à son nom. Le lien de parrainage est donné tout de suite ; ses filleuls comptent après validation. */
export async function sendProof(
  token: string, file: { bytes: Uint8Array; type: string }, siret: unknown, sessionId: unknown, deps: ProgramDeps,
): Promise<Result<null>> {
  const t = await deps.store.findByToken(token);
  if (!t) return fail(404, "Lien invalide.");
  const ext = PROOF_TYPES[file.type];
  if (!ext) return fail(400, "Format accepté : photo (JPEG, PNG) ou PDF.");
  if (file.bytes.length > 5 * 1024 * 1024) return fail(400, "Fichier trop lourd (5 Mo maximum).");
  const digits = String(siret ?? "").replace(/\D/g, "");
  const path = `${t.id}/${Date.now()}.${ext}`;
  await deps.store.uploadProof(path, file.bytes, file.type);
  await deps.store.setSiretStatus(t.id, "pending_manual", { path, siret: /^\d{14}$/.test(digits) ? digits : null });
  await deps.store.logFunnel(t.id, "siret_manual", sessionOf(sessionId));
  await sendReferralIfAlreadyDone(t, deps);
  return { ok: true, value: null };
}

export async function skipSiret(token: string, sessionId: unknown, deps: ProgramDeps): Promise<Result<null>> {
  const t = await deps.store.findByToken(token);
  if (!t) return fail(404, "Lien invalide.");
  await deps.store.logFunnel(t.id, "siret_skipped", sessionOf(sessionId));
  return { ok: true, value: null };
}

export async function complete(token: string, sessionId: unknown, deps: ProgramDeps): Promise<Result<null>> {
  const t = await deps.store.findByToken(token);
  if (!t) return fail(404, "Lien invalide.");
  if (!t.completed_at) {
    await deps.store.markCompleted(t.id, (deps.now ?? (() => new Date()))());
    await deps.store.logFunnel(t.id, "completed", sessionOf(sessionId));
    const canRefer = t.siret_status === "verified" || t.siret_status === "pending_manual";
    await sendQuietly(deps, t.artisan.owner_phone, thankYouSms(t.first_name, canRefer ? referralLink(deps.appUrl, t.referral_code) : null));
  }
  return { ok: true, value: null };
}

/** Parcours déjà terminé sans SIRET, puis SIRET ajouté : le lien de parrainage arrive par SMS. */
async function sendReferralIfAlreadyDone(t: Tester, deps: ProgramDeps) {
  if (t.completed_at) await sendQuietly(deps, t.artisan.owner_phone, referralLinkSms(t.first_name, referralLink(deps.appUrl, t.referral_code)));
}

/** Une réponse aux questions : enregistrée tout de suite (on voit où les gens abandonnent). */
export async function answerQuestion(token: string, q: unknown, value: unknown, sessionId: unknown, deps: ProgramDeps): Promise<Result<null>> {
  const t = await deps.store.findByToken(token);
  if (!t) return fail(404, "Lien invalide.");
  const key = String(q ?? "");
  const v = typeof value === "string" ? value.trim() : "";
  if (!isValidAnswer(key, v)) return fail(400, "Réponse invalide.");
  await deps.store.saveAnswers(t.id, { ...(t.survey ?? {}), [key]: v });
  await deps.store.logFunnel(t.id, "survey_answer", sessionOf(sessionId), { q: key });
  return { ok: true, value: null };
}

/** Fin des questions : calcul du niveau d'intérêt (chaud / tiède / froid). */
export async function finishSurvey(token: string, sessionId: unknown, deps: ProgramDeps): Promise<Result<{ interest: string }>> {
  const t = await deps.store.findByToken(token);
  if (!t) return fail(404, "Lien invalide.");
  if (!isComplete(t.survey ?? {})) return fail(400, "Répondez à toutes les questions.");
  const interest = interestOf(t.survey);
  if (!t.survey_completed_at) {
    await deps.store.completeSurvey(t.id, interest, (deps.now ?? (() => new Date()))());
    await deps.store.logFunnel(t.id, "survey_completed", sessionOf(sessionId), { interest });
  }
  return { ok: true, value: { interest } };
}

/** Droit à l'effacement : le testeur supprime lui-même toutes ses données depuis son espace. */
export async function deleteTester(token: string, deps: ProgramDeps): Promise<Result<null>> {
  const t = await deps.store.findByToken(token);
  if (!t) return fail(404, "Lien invalide ou données déjà supprimées.");
  await deps.store.deleteTester(t.id);
  return { ok: true, value: null };
}

function sessionOf(s: unknown): string | null {
  return typeof s === "string" && s.length >= 8 && s.length <= 64 ? s : null;
}

async function sendQuietly(deps: ProgramDeps, to: string, body: string) {
  try {
    await deps.sendSms("", to, body); // expéditeur par défaut « RelaisArti »
  } catch (err) {
    console.error("Échec SMS lien personnel", String(err));
  }
}
