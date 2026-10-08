import { clientSmsBody, randomToken } from "./missed-call.ts";
import type { SendSms } from "./twilio.ts";

/** Programme « Testeurs fondateurs » : essai simulé et vérification du SIRET. */

export const MAX_TEST_DRIVES = 3;

export interface TesterArtisan {
  id: string;
  business_name: string;
  owner_phone: string;
  relay_number: string | null;
  sms_sender?: string;
  client_sms_template?: string | null;
  siret: string | null;
}

export interface TesterStore {
  /** Réserve un essai (atomique, plafonné à MAX_TEST_DRIVES). false si le plafond est atteint. */
  claimTestDrive(artisanId: string): Promise<boolean>;
  releaseTestDrive(artisanId: string): Promise<void>;
  createTestLead(artisanId: string, clientPhone: string, token: string, at: Date): Promise<string>;
  logClientSms(artisanId: string, leadId: string, body: string, sid: string): Promise<void>;
  /** Enregistre le SIRET vérifié. false si ce SIRET est déjà rattaché à un autre compte. */
  saveSiret(artisanId: string, siret: string, companyName: string, at: Date): Promise<boolean>;
}

export interface TesterDeps {
  store: TesterStore;
  sendSms: SendSms;
  appUrl: string;
  /** Recherche dans la base Sirene (API Recherche d'entreprises), remplaçable dans les tests. */
  lookupSiret?: (siret: string) => Promise<SiretLookup | null>;
  now?: () => Date;
  newToken?: () => string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

/**
 * Essai : simule un appel manqué. L'artisan reçoit sur son portable le SMS que recevraient ses clients (à son nom,
 * avec son message), remplit la demande comme un client, puis reçoit « Nouvelle demande ». Le vrai parcours, sans renvoi d'appel.
 */
export async function startTestDrive(artisan: TesterArtisan, deps: TesterDeps): Promise<Result<null>> {
  if (!(await deps.store.claimTestDrive(artisan.id))) {
    return { ok: false, status: 429, error: `Vous avez déjà fait vos ${MAX_TEST_DRIVES} essais.` };
  }
  const now = (deps.now ?? (() => new Date()))();
  const token = (deps.newToken ?? randomToken)();
  try {
    const leadId = await deps.store.createTestLead(artisan.id, artisan.owner_phone, token, now);
    const body = clientSmsBody(artisan.business_name, `${deps.appUrl.replace(/\/$/, "")}/d/${token}`, artisan.client_sms_template);
    const { sid } = await deps.sendSms(artisan.relay_number ?? "", artisan.owner_phone, body, artisan.sms_sender);
    await deps.store.logClientSms(artisan.id, leadId, body, sid);
  } catch (err) {
    console.error("Échec de l'essai", { artisanId: artisan.id, err: String(err) });
    await deps.store.releaseTestDrive(artisan.id);
    return { ok: false, status: 502, error: "Envoi du SMS impossible. Réessayez dans un instant." };
  }
  return { ok: true, value: null };
}

// ---------------------------------------------------------------- SIRET

/** Contrôle de format et clé de Luhn (vrai pour tous les SIRET sauf La Poste, sans intérêt ici). */
export function isValidSiretFormat(siret: string): boolean {
  if (!/^\d{14}$/.test(siret)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = Number(siret[13 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export interface SiretLookup {
  siret: string;
  companyName: string;
  section: string | null;   // « F » = construction
  active: boolean;          // établissement actif
}

/** Recherche d'un SIRET dans l'API publique Recherche d'entreprises (gratuite, sans clé). */
export async function lookupSiretApi(siret: string): Promise<SiretLookup | null> {
  const res = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${siret}&per_page=5`);
  if (!res.ok) throw new Error(`API Recherche d'entreprises ${res.status}`);
  const { results } = await res.json() as {
    results: {
      nom_complet: string;
      section_activite_principale: string | null;
      siege?: { siret: string; etat_administratif: string };
      matching_etablissements?: { siret: string; etat_administratif: string }[];
    }[];
  };
  for (const r of results ?? []) {
    const etab = [r.siege, ...(r.matching_etablissements ?? [])].find((e) => e?.siret === siret);
    if (etab) return { siret, companyName: r.nom_complet, section: r.section_activite_principale, active: etab.etat_administratif === "A" };
  }
  return null;
}

export async function verifySiret(artisan: TesterArtisan, raw: string, deps: TesterDeps): Promise<Result<{ companyName: string }>> {
  const siret = raw.replace(/\s/g, "");
  if (!isValidSiretFormat(siret)) return { ok: false, status: 400, error: "Ce SIRET n'est pas valide (14 chiffres, vérifiez la saisie)." };
  if (artisan.siret === siret) return { ok: false, status: 409, error: "Ce SIRET est déjà vérifié sur votre compte." };

  let found: SiretLookup | null;
  try {
    found = await (deps.lookupSiret ?? lookupSiretApi)(siret);
  } catch (err) {
    console.error("Recherche SIRET indisponible", String(err));
    return { ok: false, status: 503, error: "Vérification indisponible pour le moment. Réessayez plus tard." };
  }
  if (!found) {
    return {
      ok: false, status: 404,
      error: "SIRET introuvable dans la base publique (c'est le cas de certains micro-entrepreneurs). Envoyez-nous une photo d'un devis à votre nom pour une vérification manuelle.",
    };
  }
  if (!found.active) return { ok: false, status: 422, error: "Cet établissement est indiqué comme fermé dans la base Sirene." };
  if (found.section !== "F") return { ok: false, status: 422, error: "Ce SIRET n'est pas celui d'une entreprise du bâtiment." };

  const now = (deps.now ?? (() => new Date()))();
  if (!(await deps.store.saveSiret(artisan.id, siret, found.companyName, now))) {
    return { ok: false, status: 409, error: "Ce SIRET est déjà utilisé par un autre compte." };
  }
  return { ok: true, value: { companyName: found.companyName } };
}
