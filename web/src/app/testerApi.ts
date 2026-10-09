import { supabase } from "../lib/supabase.ts";

const URL_TESTERS = `${(import.meta.env.VITE_FUNCTIONS_URL as string).replace(/\/$/, "")}/testers`;
const HEADERS = { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string };

export type SiretStatus = "none" | "verified" | "pending_manual" | "rejected";

export interface TesterState {
  firstName: string;
  businessName: string;
  phone: string;
  testDrivesUsed: number;
  siretStatus: SiretStatus;
  companyName: string | null;
  completed: boolean;
  surveyDone: boolean;
  answers: Record<string, string>;
  referralCode: string | null;
  /** counted : filleuls allés au bout du parcours (essai fait) ; ce sont eux qui font monter les paliers. */
  referrals: { registered: number; counted: number };
}

export class TesterError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Identifiant aléatoire du navigateur, pour suivre l'entonnoir sans compte (aucune donnée personnelle). */
export function sessionId(): string {
  try {
    let id = localStorage.getItem("ra_session");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("ra_session", id);
    }
    return id;
  } catch {
    return "nostorage-" + Math.random().toString(36).slice(2, 12);
  }
}

/** Étapes « visiteur » (avant inscription) : page ouverte, présentation lue, lien partagé. */
export function logStep(step: "landing_view" | "intro_next" | "share_clicked", ref: string | null, props: Record<string, unknown> = {}) {
  if (ref === "demo123" || location.pathname.endsWith("/demo")) return; // parcours de démonstration : rien n'est compté
  void supabase.from("funnel_events").insert({ session_id: sessionId(), ref: ref?.slice(0, 32) || null, step, props }).then(({ error }) => {
    if (error) console.warn("Étape non enregistrée", step, error.message);
  });
}

async function parse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new TesterError(body.error ?? "Une erreur est survenue. Réessayez.", res.status, body.code);
  return body as T;
}

const post = <T>(body: Record<string, unknown>) =>
  fetch(URL_TESTERS, { method: "POST", headers: { ...HEADERS, "Content-Type": "application/json" }, body: JSON.stringify({ ...body, sessionId: sessionId() }) })
    .then((r) => parse<T>(r));

/** /testeurs/moi/demo : parcours de démonstration, sans appel au serveur ni SMS. */
const DEMO = "demo";
const demoState: TesterState = {
  firstName: "Jean", businessName: "Dupont Plomberie", phone: "06 12 34 56 78", testDrivesUsed: 0, siretStatus: "none",
  companyName: null, completed: false, surveyDone: false, answers: {}, referralCode: null, referrals: { registered: 3, counted: 2 },
};
const wait = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 400));

const realApi = {
  register: (info: Record<string, string>) => post<{ token?: string; existing?: true }>({ action: "register", ...info }),
  state: (token: string) => fetch(`${URL_TESTERS}?t=${encodeURIComponent(token)}`, { headers: HEADERS }).then((r) => parse<TesterState>(r)),
  testDrive: (t: string) => post({ action: "test_drive", t }),
  verifySiret: (t: string, siret: string) => post<{ companyName: string }>({ action: "verify_siret", t, siret }),
  skipSiret: (t: string) => post({ action: "skip_siret", t }),
  complete: (t: string) => post({ action: "complete", t }),
  remove: (t: string) => post({ action: "delete", t }),
  answer: (t: string, q: string, value: string) => post({ action: "answer", t, q, value }),
  finishSurvey: (t: string) => post<{ interest: string }>({ action: "finish_survey", t }),
  sendProof: (t: string, siret: string, file: File) => {
    const form = new FormData();
    form.set("t", t);
    form.set("siret", siret);
    form.set("sessionId", sessionId());
    form.set("file", file);
    return fetch(URL_TESTERS, { method: "POST", headers: HEADERS, body: form }).then((r) => parse(r));
  },
};

export const testerApi: typeof realApi = {
  ...realApi,
  state: (t) => (t === DEMO ? wait({ ...demoState }) : realApi.state(t)),
  testDrive: (t) => (t === DEMO ? wait((demoState.testDrivesUsed++, {})) : realApi.testDrive(t)),
  verifySiret: (t, siret) => {
    if (t !== DEMO) return realApi.verifySiret(t, siret);
    if (siret.replace(/\s/g, "") !== "92759307900050") {
      return Promise.reject(new TesterError("SIRET introuvable dans la base publique (démo : essayez 927 593 079 00050, ou envoyez une photo).", 404, "not_found"));
    }
    Object.assign(demoState, { siretStatus: "verified", companyName: "AZUR PLOMBERIE", referralCode: "demo123" });
    return wait({ companyName: "AZUR PLOMBERIE" });
  },
  sendProof: (t, siret, file) =>
    t === DEMO ? wait((Object.assign(demoState, { siretStatus: "pending_manual", referralCode: "demo123" }), {})) : realApi.sendProof(t, siret, file),
  skipSiret: (t) => (t === DEMO ? wait({}) : realApi.skipSiret(t)),
  complete: (t) => (t === DEMO ? wait((demoState.completed = true, {})) : realApi.complete(t)),
  remove: (t) => (t === DEMO ? wait({}) : realApi.remove(t)),
  answer: (t, q, value) => (t === DEMO ? wait((demoState.answers = { ...demoState.answers, [q]: value }, {})) : realApi.answer(t, q, value)),
  finishSurvey: (t) => (t === DEMO ? wait((demoState.surveyDone = true, { interest: "chaud" })) : realApi.finishSurvey(t)),
};

const TOKEN_KEY = "ra_tester_token";
export const savedToken = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
  set: (t: string) => {
    if (t === DEMO) return;
    try {
      localStorage.setItem(TOKEN_KEY, t);
    } catch {
      /* stockage indisponible : le lien personnel par SMS reste valable */
    }
  },
};
