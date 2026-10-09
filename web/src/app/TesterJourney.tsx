import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { toE164 } from "./format.ts";
import { currentTier, FOUNDER_PRICE, INVITEE_REWARD, nextTier, PRICE, TRADES } from "./founders.ts";
import { RewardsTrack } from "./RewardsTrack.tsx";
import { CONTACT_EMAIL, FREE_TEXT_QUESTION, SURVEY_QUESTIONS } from "./survey.ts";
import { logStep, savedToken, TesterError, testerApi, type TesterState } from "./testerApi.ts";
import "./app.css";

/**
 * Parcours « Testeurs fondateurs » RelaisArti, sans compte :
 * /testeurs : présentation → infos ; /testeurs/moi/<jeton> : essai → SIRET → lien de parrainage.
 */

const STEPS = ["Infos", "Essai", "Questions", "SIRET", "Partage"];

/** Barre d'avancement : pourcentage + étapes, avec un mot d'encouragement. */
function Progress({ current }: { current: number }) {
  const left = STEPS.length - 1 - current;
  const pct = Math.round(((current + 0.5) / STEPS.length) * 100);
  return (
    <div className="progress-wrap">
      <div className="progress-head">
        <span>Étape {current + 1} sur {STEPS.length}</span>
        <span className="accent">{left === 0 ? "Dernière étape !" : left === 1 ? "Plus qu'une étape !" : `Plus que ${left} étapes`}</span>
      </div>
      <div className="progress-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${pct}%` }} />
      </div>
    <ol className="stepper" aria-label="Étapes">
      {STEPS.map((s, i) => (
        <li key={s} className={i < current ? "done" : i === current ? "current" : ""} aria-current={i === current ? "step" : undefined}>
          <span>{i + 1}</span>
          {s}
        </li>
      ))}
    </ol>
    </div>
  );
}

const FEATURES: [string, string][] = [
  ["Appel manqué = SMS immédiat", "Quand vous ne pouvez pas décrocher, votre client reçoit en quelques secondes un SMS à votre nom pour décrire son besoin."],
  ["La demande résumée par SMS", "Travaux, adresse, urgence, photos : vous recevez un résumé clair, prêt à rappeler."],
  ["Vos devis relancés tout seuls", "À J+3, J+7 et J+14, jusqu'à ce que le client réponde. Vous signez plus de chantiers."],
  ["Votre bilan du mois", "Appels récupérés, devis gagnés, montant signé : vous voyez ce que l'outil vous rapporte."],
  ["Entre confrères", "Pas votre métier ? Transmettez le chantier à un confrère. Chantier fini ? Demandez un avis Google en un clic."],
];

export function TesterLanding() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const ref = params.get("parrain");
  const [step, setStep] = useState<"intro" | "info">("intro");

  useEffect(() => {
    document.title = "Testeurs fondateurs – RelaisArti";
    logStep("landing_view", ref, { source: ref ? "parrainage" : "direct" });
    const token = savedToken.get();
    if (token) navigate(`/testeurs/moi/${token}`, { replace: true });
  }, [ref, navigate]);

  return (
    <main className="founders">
      <p className="eyebrow">RelaisArti · Testeurs fondateurs</p>
      {step === "intro" ? (
        <>
          <h1>Ne perdez plus un client à cause d'un appel manqué</h1>
          <p className="lead">L'outil des artisans du bâtiment qui n'ont pas le temps de décrocher sur un chantier.</p>
          {ref && <p className="invite">Un confrère vous invite : <strong>{INVITEE_REWARD}</strong> à l'ouverture.</p>}
          <ul className="features">
            {FEATURES.map(([title, text]) => (
              <li key={title}><strong>{title}</strong><span>{text}</span></li>
            ))}
          </ul>
          <p className="muted small">Sans changer de numéro, sans application à installer. {PRICE} € HT/mois à l'ouverture, sans engagement.</p>
          <button className="btn-primary cta" onClick={() => { logStep("intro_next", ref); setStep("info"); }}>
            Devenir testeur fondateur
          </button>
          <p className="muted small center-text">Gratuit pendant la phase de test. <Link to="/demo">Voir une démonstration</Link></p>
          <Conditions />
        </>
      ) : (
        <InfoStep referral={ref} onBack={() => setStep("intro")} />
      )}
      <ContactLine />
    </main>
  );
}

function InfoStep({ referral, onBack }: { referral: string | null; onBack: () => void }) {
  const navigate = useNavigate();
  const [f, setF] = useState({ businessName: "", firstName: "", lastName: "", phone: "", trade: "", postalCode: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [existing, setExisting] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (f.businessName.trim().length < 2) return setError("Indiquez le nom de votre entreprise.");
    if (!f.firstName.trim() || !f.lastName.trim()) return setError("Indiquez votre prénom et votre nom.");
    if (!toE164(f.phone) || !/^\+33[67]/.test(toE164(f.phone)!)) return setError("Numéro de portable invalide (ex. : 06 12 34 56 78). Il sert à l'essai.");
    if (f.postalCode && !/^\d{5}$/.test(f.postalCode)) return setError("Code postal : 5 chiffres.");
    setBusy(true);
    setError(null);
    try {
      const r = await testerApi.register({ ...f, ref: referral ?? "" });
      if (r.token) {
        savedToken.set(r.token);
        navigate(`/testeurs/moi/${r.token}`);
      } else setExisting(true);
    } catch (err) {
      setError(err instanceof TesterError ? err.message : "Inscription impossible. Vérifiez votre connexion.");
    } finally {
      setBusy(false);
    }
  }

  if (existing) {
    return (
      <div className="stack">
        <h1>Vous êtes déjà inscrit</h1>
        <p className="lead">Nous venons de vous renvoyer par SMS le lien de votre espace testeur.</p>
      </div>
    );
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <Progress current={0} />
      <h1>Vos informations</h1>
      <label className="field">
        <span className="label">Nom de l'entreprise</span>
        <input type="text" autoComplete="organization" value={f.businessName} onChange={set("businessName")} placeholder="Ex. : Dupont Plomberie" />
      </label>
      <div className="field-row half">
        <label className="field">
          <span className="label">Prénom</span>
          <input type="text" autoComplete="given-name" value={f.firstName} onChange={set("firstName")} />
        </label>
        <label className="field">
          <span className="label">Nom</span>
          <input type="text" autoComplete="family-name" value={f.lastName} onChange={set("lastName")} />
        </label>
      </div>
      <label className="field">
        <span className="label">Votre portable</span>
        <input type="tel" inputMode="tel" autoComplete="tel" value={f.phone} onChange={set("phone")} placeholder="06 12 34 56 78" />
        <span className="hint">Indispensable : c'est sur ce numéro que vous vivrez l'essai.</span>
      </label>
      <div className="field-row">
        <label className="field">
          <span className="label">Métier</span>
          <select value={f.trade} onChange={set("trade")}>
            <option value="">Choisir…</option>
            {TRADES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="label">Code postal</span>
          <input type="text" inputMode="numeric" maxLength={5} value={f.postalCode} onChange={(e) => setF({ ...f, postalCode: e.target.value.replace(/\D/g, "") })} />
        </label>
      </div>
      <p className="hint tight">Métier et code postal : facultatifs, ils nous aident à vous proposer des confrères proches.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn-primary cta" disabled={busy}>{busy ? "Inscription…" : "Suivant"}</button>
      <button type="button" className="btn-ghost" onClick={onBack}>Retour</button>
      <p className="muted small">Vos informations servent uniquement au programme de test RelaisArti et à vous prévenir de l'ouverture. Vous pourrez les supprimer à tout moment depuis votre espace testeur.</p>
    </form>
  );
}

// ---------------------------------------------------------------- Espace personnel : essai → SIRET → partage

export function TesterSpace() {
  const { token = "" } = useParams();
  const [state, setState] = useState<TesterState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3 | 4 | null>(null);
  const [deleted, setDeleted] = useState(false);

  const reload = () =>
    testerApi.state(token).then((s) => {
      setState(s);
      return s;
    });

  useEffect(() => {
    document.title = "Mon espace testeur – RelaisArti";
    savedToken.set(token);
    reload()
      .then((s) => setStep(s.referralCode || s.completed ? 4 : s.surveyDone ? 3 : s.testDrivesUsed > 0 ? 2 : 1))
      .catch((e) => setError(e instanceof TesterError ? e.message : "Page indisponible."));
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (deleted) {
    return (
      <main className="founders">
        <p className="eyebrow">RelaisArti</p>
        <h1>Vos données ont été supprimées</h1>
        <p className="lead">Merci d'avoir testé RelaisArti.</p>
      </main>
    );
  }
  if (error) return <main className="founders"><h1>Lien invalide</h1><p className="lead">{error}</p><Link to="/testeurs">S'inscrire</Link></main>;
  if (!state || !step) return <main className="founders"><p className="muted">Chargement…</p></main>;

  return (
    <main className="founders">
      <p className="eyebrow">RelaisArti · {state.businessName}</p>
      <Progress current={step} />
      {step === 1 && <TestStep token={token} state={state} onNext={() => reload().then(() => setStep(2))} />}
      {step === 2 && <SurveyStep token={token} state={state} onNext={() => reload().then(() => setStep(3))} />}
      {step === 3 && <SiretStep token={token} state={state} onNext={() => reload().then(() => setStep(4))} />}
      {step === 4 && <ShareStep token={token} state={state} onAddSiret={() => setStep(3)} />}
      <DeleteData token={token} onDeleted={() => setDeleted(true)} />
      <ContactLine />
    </main>
  );
}

function TestStep({ token, state, onNext }: { token: string; state: TesterState; onNext: () => void }) {
  const [sent, setSent] = useState(state.testDrivesUsed > 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await testerApi.testDrive(token);
      setSent(true);
    } catch (err) {
      setError(err instanceof TesterError ? err.message : "Envoi impossible. Réessayez.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <h1>{state.firstName}, vivez l'essai</h1>
      <p className="lead">On simule un appel manqué d'un de vos clients. Vous allez voir exactement ce qu'il reçoit, puis ce que vous recevez.</p>
      <ol className="how">
        <li>Vous recevez <strong>le SMS envoyé à vos clients</strong>. Il arrive au nom de votre entreprise ({state.businessName}), comme pour eux.</li>
        <li>Touchez le lien et <strong>décrivez un besoin comme si vous étiez le client</strong> (une fuite, une panne…).</li>
        <li>Une minute après, vous recevez <strong>« Nouvelle demande »</strong> : c'est ce que vous recevrez à chaque appel manqué.</li>
      </ol>
      {sent ? (
        <p className="success">SMS envoyé au {state.phone}. Ouvrez-le et suivez le lien.</p>
      ) : (
        <button className="btn-primary cta" onClick={send} disabled={busy}>{busy ? "Envoi…" : "Recevoir l'essai sur mon portable"}</button>
      )}
      {error && <p className="error">{error}</p>}
      {sent && <button className="btn-primary cta" onClick={onNext}>J'ai fait l'essai : suivant</button>}
      {sent && state.testDrivesUsed < 3 && <button className="btn-ghost" onClick={send} disabled={busy}>Renvoyer le SMS d'essai</button>}
      {!sent && <button className="btn-ghost" onClick={onNext}>Passer cette étape</button>}
    </div>
  );
}

/** Questions de qualification : une par écran, réponse en un clic, enregistrée tout de suite. */
function SurveyStep({ token, state, onNext }: { token: string; state: TesterState; onNext: () => void }) {
  const total = SURVEY_QUESTIONS.length + 1; // + la question libre
  const firstUnanswered = SURVEY_QUESTIONS.findIndex((q) => !state.answers[q.id]);
  const [index, setIndex] = useState(firstUnanswered === -1 ? SURVEY_QUESTIONS.length : firstUnanswered);
  const [answers, setAnswers] = useState<Record<string, string>>(state.answers);
  const [text, setText] = useState(state.answers.free_text ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(qId: string, value: string) {
    setBusy(true);
    setError(null);
    try {
      await testerApi.answer(token, qId, value);
      setAnswers({ ...answers, [qId]: value });
      setIndex(index + 1);
    } catch (err) {
      setError(err instanceof TesterError ? err.message : "Réponse non enregistrée. Réessayez.");
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      if (text.trim()) await testerApi.answer(token, "free_text", text.trim().slice(0, 500));
      await testerApi.finishSurvey(token);
      onNext();
    } catch (err) {
      setError(err instanceof TesterError ? err.message : "Envoi impossible. Réessayez.");
    } finally {
      setBusy(false);
    }
  }

  const q = SURVEY_QUESTIONS[index];
  return (
    <div className="stack">
      <p className="eyebrow">Question {Math.min(index + 1, total)} sur {total}</p>
      {q ? (
        <>
          <h1 className="question">{q.title}</h1>
          {q.hint && <p className="muted small">{q.hint}</p>}
          <div className="choices">
            {q.options.map((o) => (
              <button key={o.value} className={`choice${answers[q.id] === o.value ? " selected" : ""}`} disabled={busy} onClick={() => choose(q.id, o.value)}>
                {o.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <h1 className="question">{FREE_TEXT_QUESTION}</h1>
          <p className="muted small">Facultatif, mais votre avis nous aide énormément.</p>
          <textarea rows={4} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex. : que ça marche avec mon numéro actuel, un prix plus bas, une appli…" />
          <button className="btn-primary cta" disabled={busy} onClick={finish}>{busy ? "Envoi…" : "Terminer les questions"}</button>
        </>
      )}
      {error && <p className="error">{error}</p>}
      {index > 0 && <button className="btn-ghost" disabled={busy} onClick={() => setIndex(index - 1)}>Question précédente</button>}
    </div>
  );
}

function SiretStep({ token, state, onNext }: { token: string; state: TesterState; onNext: () => void }) {
  const [siret, setSiret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsProof, setNeedsProof] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  if (state.siretStatus === "verified" || state.siretStatus === "pending_manual") {
    return (
      <div className="stack">
        <h1>SIRET {state.siretStatus === "verified" ? "vérifié" : "en cours de vérification"}</h1>
        <p className="lead">{state.siretStatus === "verified" ? state.companyName : "Nous vérifions votre devis sous 48 h."}</p>
        <button className="btn-primary cta" onClick={onNext}>Suivant</button>
      </div>
    );
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await testerApi.verifySiret(token, siret);
      onNext();
    } catch (err) {
      if (err instanceof TesterError && err.code === "not_found") setNeedsProof(true);
      setError(err instanceof TesterError ? err.message : "Vérification impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function sendProof() {
    if (!file) return setError("Choisissez une photo ou un PDF.");
    setBusy(true);
    setError(null);
    try {
      await testerApi.sendProof(token, siret, file);
      onNext();
    } catch (err) {
      setError(err instanceof TesterError ? err.message : "Envoi impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <h1>Gagnez des avantages en invitant vos confrères</h1>
      <p className="lead">Plus vous faites inscrire de confrères du bâtiment, plus vous gagnez :</p>
      <RewardsTrack />
      <h2 className="siret-title">Votre SIRET</h2>
      <p className="muted">Il prouve que vous êtes un vrai artisan du bâtiment. Il est nécessaire pour obtenir votre lien de parrainage.</p>
      <form className="stack" onSubmit={verify}>
        <label className="field">
          <span className="label">SIRET (14 chiffres)</span>
          <input type="text" inputMode="numeric" maxLength={17} value={siret} onChange={(e) => setSiret(e.target.value.replace(/[^\d ]/g, ""))} placeholder="123 456 789 00012" />
          <span className="hint">Il figure sur vos devis et factures. Avec ou sans espaces.</span>
        </label>
        <button className={needsProof ? "btn-secondary" : "btn-primary cta"} disabled={busy || siret.replace(/\s/g, "").length !== 14}>
          {busy ? "Vérification…" : needsProof ? "Vérifier à nouveau" : "Vérifier"}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {needsProof && (
        <div className="stack proof">
          <p className="muted small">Pas d'inquiétude : certains micro-entrepreneurs n'apparaissent pas dans la base publique. Envoyez-nous une photo, nous vérifions sous 48 h.</p>
          <label className="field">
            <span className="label">Photo d'un devis ou d'une facture à votre nom</span>
            <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <button className="btn-primary cta" disabled={busy || !file} onClick={sendProof}>{busy ? "Envoi…" : "Envoyer pour vérification"}</button>
        </div>
      )}
      <button className="btn-ghost" onClick={() => { void testerApi.skipSiret(token); onNext(); }}>Plus tard (pas de lien de parrainage)</button>
    </div>
  );
}

function ShareStep({ token, state, onAddSiret }: { token: string; state: TesterState; onAddSiret: () => void }) {
  const [copied, setCopied] = useState<"message" | "lien" | null>(null);

  useEffect(() => {
    if (!state.completed) void testerApi.complete(token);
  }, [token, state.completed]);

  if (!state.referralCode) {
    return (
      <div className="stack">
        <h1>Merci {state.firstName}, vous êtes inscrit</h1>
        <p className="lead">Vous serez parmi les premiers prévenus à l'ouverture. Un SMS de confirmation de RelaisArti vous est envoyé.</p>
        <p>Ajoutez votre SIRET pour obtenir votre lien de parrainage et gagner des avantages en invitant vos confrères.</p>
        <button className="btn-primary cta" onClick={onAddSiret}>Ajouter mon SIRET</button>
      </div>
    );
  }

  const link = `${window.location.origin}/testeurs?parrain=${state.referralCode}`;
  const message = `Salut ! Je teste RelaisArti : quand je rate un appel sur un chantier, le client reçoit tout de suite un SMS à mon nom, et mes devis sont relancés tout seuls. Inscris-toi comme testeur avec mon lien, tu auras ${INVITEE_REWARD} : ${link}`;
  const count = state.referrals.counted;
  const next = nextTier(count);
  const reached = currentTier(count);
  const track = (channel: string) => logStep("share_clicked", state.referralCode, { channel });

  async function copy(what: "message" | "lien") {
    track(what === "lien" ? "copy_link" : "copy_message");
    try {
      await navigator.clipboard.writeText(what === "lien" ? link : message);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* presse-papiers indisponible */
    }
  }

  async function nativeShare() {
    track("share_sheet");
    try {
      await navigator.share({ title: "RelaisArti", text: message });
    } catch {
      /* partage annulé */
    }
  }

  return (
    <div className="stack">
      <h1>Invitez vos confrères</h1>
      <p className="lead">Votre lien est personnel : chaque confrère qui s'inscrit avec lui et va au bout de son inscription vous fait avancer d'un cran.</p>

      <RewardsTrack count={count} />
      <p className="small center-text">
        <strong className="accent">{count} confrère{count > 1 ? "s" : ""} inscrit{count > 1 ? "s" : ""}</strong>
        {state.referrals.registered > count && <span className="muted"> · {state.referrals.registered - count} en cours d'inscription</span>}
        {reached && <span className="muted"> · palier atteint : {reached.title}</span>}
        {next && <span className="muted"> · encore {next.referrals - count} pour « {next.title} »</span>}
      </p>

      <div className="message-preview">
        <p className="message-preview-title">Le message envoyé à vos confrères</p>
        <p>{message}</p>
      </div>

      {"share" in navigator && (
        <button className="btn-primary cta btn-icon" onClick={nativeShare}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Partager (WhatsApp, SMS, Messenger…)
        </button>
      )}
      <div className="share-grid">
        <a className="btn-secondary btn-icon" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" onClick={() => track("whatsapp")}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#25D366" d="M12 2a10 10 0 00-8.6 15.1L2 22l5-1.3A10 10 0 1012 2zm0 18.2a8.2 8.2 0 01-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1112 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 01-3.3-2.9c-.3-.4.3-.4.7-1.4.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a.9.9 0 00-.7.3 2.8 2.8 0 00-.9 2.1 4.9 4.9 0 001 2.6 11.2 11.2 0 004.3 3.8c1.6.7 2.2.7 3 .6a2.6 2.6 0 001.7-1.2 2.1 2.1 0 00.1-1.2c0-.1-.2-.2-.4-.3z" /></svg>
          WhatsApp
        </a>
        <a className="btn-secondary btn-icon" href={`sms:?&body=${encodeURIComponent(message)}`} onClick={() => track("sms")}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H8l-4 4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
          SMS
        </a>
      </div>
      <div className="share-grid">
        <button className="btn-secondary" onClick={() => copy("message")}>{copied === "message" ? "Message copié" : "Copier le message"}</button>
        <button className="btn-secondary" onClick={() => copy("lien")}>{copied === "lien" ? "Lien copié" : "Copier le lien"}</button>
      </div>
      <div className="share-link"><code>{link}</code></div>

      {state.siretStatus === "pending_manual" && <p className="muted small">Votre SIRET est en cours de vérification : vos parrainages comptent dès maintenant.</p>}
      <p className="muted small">Votre lien vous a aussi été envoyé par SMS par RelaisArti. Revenez sur cette page depuis ce téléphone pour suivre vos parrainages.</p>
      <Conditions />
    </div>
  );
}

function DeleteData({ token, onDeleted }: { token: string; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await testerApi.remove(token);
      savedToken.clear();
      onDeleted();
    } catch (err) {
      setError(err instanceof TesterError ? err.message : "Suppression impossible. Réessayez.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="delete-box">
      {!confirm ? (
        <button className="btn-ghost small" onClick={() => setConfirm(true)}>Supprimer mes données</button>
      ) : (
        <div className="stack">
          <p className="small">Supprimer définitivement votre inscription, votre essai et vos parrainages ? Cette action est irréversible.</p>
          {error && <p className="error">{error}</p>}
          <div className="actions-2">
            <button className="btn-danger" disabled={busy} onClick={remove}>{busy ? "Suppression…" : "Oui, supprimer"}</button>
            <button className="btn-secondary" onClick={() => setConfirm(false)}>Annuler</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ContactLine() {
  return (
    <p className="contact-line">
      Une question ? Écrivez-moi : <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
    </p>
  );
}

function Conditions() {
  return (
    <details className="conditions-box" id="conditions">
      <summary>Conditions du programme</summary>
      <ul className="conditions">
        <li>Le programme est gratuit et sans engagement. Aucun paiement n'est demandé pendant la phase de test.</li>
        <li>Un parrainage compte quand le confrère invité s'inscrit avec votre lien <strong>et</strong> va au bout de son inscription, essai compris (il reçoit le SMS d'essai sur son portable, ce qui garantit un vrai numéro). Le SIRET du confrère n'est pas obligatoire. Un seul compte par numéro de portable ; pas de parrainage de son propre compte.</li>
        <li>Les avantages s'appliquent à l'ouverture commerciale du service (abonnement à {PRICE} € HT/mois), sur le compte du parrain et de l'invité. Ils ne sont ni cumulables avec une autre offre, ni échangeables contre de l'argent. Maximum : 6 mois offerts.</li>
        <li>Le tarif fondateur ({FOUNDER_PRICE} € HT/mois au lieu de {PRICE} €) est garanti 24 mois à partir de la souscription.</li>
        <li>Si le service n'ouvre pas commercialement, aucun avantage n'est dû et aucun paiement n'aura été demandé. Vous pouvez supprimer vos données à tout moment depuis votre espace testeur.</li>
        <li>Aucun tirage au sort : les avantages dépendent uniquement du nombre de confrères inscrits jusqu'au bout.</li>
      </ul>
      <p className="small conditions-title">Vos données</p>
      <ul className="conditions">
        <li><strong>Ce que nous collectons</strong> : nom de l'entreprise, prénom, nom, portable, métier et code postal (facultatifs), SIRET et, si besoin, la photo d'un devis ; la demande que vous remplissez pendant l'essai.</li>
        <li><strong>Pourquoi</strong> : faire fonctionner l'essai, vérifier que vous êtes artisan du bâtiment, compter vos parrainages, et vous prévenir de l'ouverture. Aucune revente, aucune publicité de tiers.</li>
        <li><strong>Combien de temps</strong> : pendant le programme de test, puis 12 mois après l'ouverture si vous ne devenez pas client.</li>
        <li><strong>Vos droits</strong> : vous pouvez supprimer toutes vos données à tout moment avec le bouton « Supprimer mes données » de votre espace testeur, ou demander l'accès, la correction ou la suppression par email à {CONTACT_EMAIL}.</li>
      </ul>
    </details>
  );
}
