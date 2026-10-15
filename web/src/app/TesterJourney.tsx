import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { supabase } from "../lib/supabase.ts";
import { toE164 } from "./format.ts";
import { currentTier, FOUNDER_PRICE, INVITEE_REWARD, nextTier, PRICE } from "./founders.ts";
import { RewardsTrack } from "./RewardsTrack.tsx";
import { TradesHero } from "./TradesHero.tsx";
import { CONTACT_EMAIL, FREE_TEXT_QUESTION, SURVEY_QUESTIONS } from "./survey.ts";
import { logStep, savedToken, TesterError, testerApi, type TesterState } from "./testerApi.ts";
import "./app.css";

/**
 * Parcours « Testeurs fondateurs » RelaisArti, sans compte :
 * /testeurs : présentation → infos ; /testeurs/moi/<jeton> : essai → questions → lien de parrainage.
 */

const STEPS = ["Infos", "Essai", "Questions", "Partage"];

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

const BENEFITS = [
  "Le client qui tombe sur votre répondeur est pris en charge en quelques secondes, à votre nom.",
  "Vous recevez sa demande résumée : travaux, adresse, urgence, photos. Prêt à rappeler.",
  "Vos devis sont relancés tout seuls, jusqu'à ce que le client réponde.",
];

/** Rassurance affichée juste sous le bouton (gratuité, absence d'engagement, rien à installer). */
function Reassurance() {
  return <p className="reassure">Gratuit · Sans engagement · Sans carte bancaire · Sans changer de numéro</p>;
}

/** Prénom et entreprise d'un artisan arrivé par son lien de prospection, pour l'accueillir et pré-remplir le formulaire. */
function useProspectPrefill(code: string | null) {
  const [prefill, setPrefill] = useState<{ first_name: string | null; business_name: string } | null>(null);
  useEffect(() => {
    if (!code || !/^[a-z0-9]{6,10}$/i.test(code)) return;
    supabase.rpc("prospect_prefill", { p_code: code }).then(({ data }) => {
      const row = (data as { first_name: string | null; business_name: string }[] | null)?.[0];
      if (row) setPrefill(row);
    });
  }, [code]);
  return prefill;
}

export function TesterLanding() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const ref = params.get("parrain");
  const prospect = params.get("p");
  const prefill = useProspectPrefill(prospect);
  const [step, setStep] = useState<"intro" | "info">("intro");

  useEffect(() => {
    document.title = "Testeurs fondateurs – RelaisArti";
    // Compté après 2 s de page visible : un aperçu de lien (chargé en arrière-plan puis fermé) n'est pas une visite.
    const timer = setTimeout(() => {
      if (document.visibilityState === "visible") {
        logStep("landing_view", ref, { source: ref ? "parrainage" : prospect ? "prospection" : "direct", ...(prospect && { prospect: prospect.slice(0, 10).toLowerCase() }) });
      }
    }, 2000);
    const token = savedToken.get();
    if (token) navigate(`/testeurs/moi/${token}`, { replace: true });
    return () => clearTimeout(timer);
  }, [ref, prospect, navigate]);

  const start = () => {
    logStep("intro_next", ref, prospect ? { prospect: prospect.slice(0, 10).toLowerCase() } : {});
    setStep("info");
    window.scrollTo(0, 0);
  };

  return (
    <main className="founders">
      <p className="eyebrow">{prefill?.first_name ? `Bonjour ${prefill.first_name}` : "RelaisArti"}</p>
      {step === "intro" ? (
        <>
          <TradesHero />
          <h1 className="hero-title">Ne perdez plus un client à cause d'un appel manqué</h1>
          {ref && <p className="invite">Un confrère vous invite : <strong>{INVITEE_REWARD}</strong> à l'ouverture.</p>}
          <ul className="benefits">
            {BENEFITS.map((b) => <li key={b}>{b}</li>)}
          </ul>
          <button className="btn-primary cta" onClick={start}>Tester en 1 minute</button>
          <Reassurance />
          <div className="try-box">
            <strong>L'essai : 1 minute sur votre téléphone</strong>
            <span>Vous recevez le SMS que recevrait votre client et vous voyez la demande arriver, comme si vous aviez raté son appel.</span>
          </div>
          <Conditions />
        </>
      ) : (
        <InfoStep referral={ref} prospect={prospect} prefill={prefill} onBack={() => setStep("intro")} />
      )}
      <ContactLine />
    </main>
  );
}

function InfoStep({ referral, prospect, prefill, onBack }: {
  referral: string | null; prospect: string | null; prefill: { first_name: string | null; business_name: string } | null; onBack: () => void;
}) {
  const navigate = useNavigate();
  const [f, setF] = useState({ firstName: prefill?.first_name ?? "", businessName: prefill?.business_name ?? "", phone: "" });
  const [error, setError] = useState<{ field: keyof typeof f; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [existing, setExisting] = useState(false);
  // Pré-remplissage arrivé après l'ouverture du formulaire : on complète seulement les champs encore vides.
  useEffect(() => {
    if (prefill) setF((cur) => ({ ...cur, firstName: cur.firstName || prefill.first_name || "", businessName: cur.businessName || prefill.business_name }));
  }, [prefill]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    setF({ ...f, [k]: e.target.value });
    if (error?.field === k) setError(null);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.firstName.trim()) return setError({ field: "firstName", text: "Indiquez votre prénom." });
    if (f.businessName.trim().length < 2) return setError({ field: "businessName", text: "Indiquez le nom de votre entreprise." });
    const phone = toE164(f.phone);
    if (!phone || !/^\+33[67]/.test(phone)) return setError({ field: "phone", text: "Un numéro de portable en 06 ou 07, par exemple 06 12 34 56 78." });
    setBusy(true);
    setError(null);
    try {
      const r = await testerApi.register({ ...f, ref: referral ?? "", prospect: prospect ?? "" });
      if (r.token) {
        savedToken.set(r.token);
        navigate(`/testeurs/moi/${r.token}`);
      } else setExisting(true);
    } catch (err) {
      setError({ field: "phone", text: err instanceof TesterError ? err.message : "Inscription impossible. Vérifiez votre connexion." });
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

  const fieldError = (k: keyof typeof f) => error?.field === k && <span className="field-error" role="alert">{error.text}</span>;
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <Progress current={0} />
      <h1>Où vous envoie-t-on l'essai ?</h1>
      <p className="lead">Un SMS arrive dans quelques secondes sur votre portable : c'est l'essai.</p>
      <label className="field">
        <span className="label">Prénom</span>
        <input type="text" autoComplete="given-name" value={f.firstName} onChange={set("firstName")} aria-invalid={error?.field === "firstName"} />
        {fieldError("firstName")}
      </label>
      <label className="field">
        <span className="label">Nom de l'entreprise</span>
        <input type="text" autoComplete="organization" value={f.businessName} onChange={set("businessName")} placeholder="Ex. : Dupont Plomberie" aria-invalid={error?.field === "businessName"} />
        {fieldError("businessName")}
      </label>
      <label className="field">
        <span className="label">Votre portable</span>
        <input type="tel" inputMode="tel" autoComplete="tel" value={f.phone} onChange={set("phone")} placeholder="06 12 34 56 78" aria-invalid={error?.field === "phone"} />
        {fieldError("phone")}
      </label>
      <button className="btn-primary cta" disabled={busy}>{busy ? "Envoi…" : "Recevoir l'essai par SMS"}</button>
      <p className="reassure">Votre numéro sert uniquement à l'essai. Aucune publicité, suppression à tout moment.</p>
      <button type="button" className="btn-ghost" onClick={onBack}>Retour</button>
    </form>
  );
}

// ---------------------------------------------------------------- Espace personnel : essai → questions → partage

export function TesterSpace() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<TesterState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3 | null>(null);
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
      .then((s) => setStep(s.completed || s.surveyDone ? 3 : s.testCompleted ? 2 : 1))
      .catch((e) => {
        // Inscription supprimée (ou lien périmé) : on oublie ce lien sur ce téléphone et on repart de l'accueil.
        if (e instanceof TesterError && e.status === 404) {
          savedToken.clear();
          navigate("/testeurs", { replace: true });
          return;
        }
        setError(e instanceof TesterError ? e.message : "Page indisponible.");
      });
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
      {step === 3 && <ShareStep token={token} state={state} />}
      <DeleteData token={token} onDeleted={() => setDeleted(true)} />
      <ContactLine />
    </main>
  );
}

function TestStep({ token, state, onNext }: { token: string; state: TesterState; onNext: () => void }) {
  const [sent, setSent] = useState(state.testDrivesUsed > 0);
  const [done, setDone] = useState(state.testCompleted);
  const [used, setUsed] = useState(state.testDrivesUsed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tant que la demande d'essai n'est pas remplie, on vérifie toutes les 4 s (la page se débloque toute seule).
  useEffect(() => {
    if (!sent || done) return;
    const id = setInterval(() => {
      testerApi.state(token).then((s) => s.testCompleted && setDone(true)).catch(() => {});
    }, 4000);
    return () => clearInterval(id);
  }, [sent, done, token]);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await testerApi.testDrive(token);
      setSent(true);
      setUsed((u) => u + 1);
    } catch (err) {
      setError(err instanceof TesterError ? err.message : "Envoi impossible. Réessayez.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="stack">
        <div className="success-box">
          <p className="success-title">Essai réussi, votre numéro est confirmé</p>
          <p>Vous avez vu ce que reçoivent vos clients, et vous avez reçu « Nouvelle demande » : c'est ce qui arrivera à chaque appel manqué.</p>
        </div>
        <button className="btn-primary cta" onClick={onNext}>Suivant</button>
      </div>
    );
  }

  return (
    <div className="stack">
      <h1>{state.firstName}, vivez l'essai</h1>
      <p className="lead">On simule un appel manqué d'un de vos clients. Vous allez voir exactement ce qu'il reçoit, puis ce que vous recevez.</p>

      <div className="important">
        <p className="important-title">Important pour valider votre inscription</p>
        <p>
          Vous allez recevoir un SMS au nom de <strong>{state.businessName}</strong>. <strong>Ouvrez-le, touchez le lien et remplissez la demande</strong> comme
          si vous étiez le client (une fuite, une panne…). C'est ce qui confirme votre numéro et valide votre inscription
          {" "}— et la fait compter pour le confrère qui vous a invité.
        </p>
      </div>

      {!sent ? (
        <button className="btn-primary cta" onClick={send} disabled={busy}>{busy ? "Envoi…" : "Recevoir l'essai sur mon portable"}</button>
      ) : (
        <>
          <div className="waiting" role="status">
            <span className="spinner" aria-hidden="true" />
            <span>SMS envoyé au {state.phone}. En attente de votre demande… cette page se débloque toute seule.</span>
          </div>
          {used < 3 && <button className="btn-secondary" onClick={send} disabled={busy}>{busy ? "Envoi…" : "Je n'ai rien reçu : renvoyer le SMS"}</button>}
          {used >= 3 && <p className="muted small">Toujours rien reçu ? Écrivez-moi à {CONTACT_EMAIL}, je valide votre inscription.</p>}
        </>
      )}
      {error && <p className="error">{error}</p>}
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

function ShareStep({ token, state }: { token: string; state: TesterState }) {
  const [copied, setCopied] = useState<"message" | "lien" | null>(null);

  useEffect(() => {
    if (!state.completed) void testerApi.complete(token);
  }, [token, state.completed]);

  if (!state.referralCode) return <p className="muted">Chargement…</p>;


  const link = `${window.location.origin}/testeurs?parrain=${state.referralCode}`;
  const message = `Salut, je teste RelaisArti. Teste en 3 min, avec mon lien t'as ${INVITEE_REWARD} : ${link}`;
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
        <li>Un parrainage compte quand le confrère invité s'inscrit avec votre lien <strong>et</strong> va au bout de son inscription, essai compris (il reçoit le SMS d'essai sur son portable, ce qui garantit un vrai numéro). Un seul compte par numéro de portable ; pas de parrainage de son propre compte.</li>
        <li>Les avantages s'appliquent à l'ouverture commerciale du service (abonnement à {PRICE} € HT/mois), sur le compte du parrain et de l'invité. Ils ne sont ni cumulables avec une autre offre, ni échangeables contre de l'argent. Maximum : 6 mois offerts.</li>
        <li>Le tarif fondateur ({FOUNDER_PRICE} € HT/mois au lieu de {PRICE} €) s'applique pendant 6 mois à partir de la souscription.</li>
        <li>Si le service n'ouvre pas commercialement, aucun avantage n'est dû et aucun paiement n'aura été demandé. Vous pouvez supprimer vos données à tout moment depuis votre espace testeur.</li>
        <li>Aucun tirage au sort : les avantages dépendent uniquement du nombre de confrères inscrits jusqu'au bout.</li>
      </ul>
      <p className="small conditions-title">Vos données</p>
      <ul className="conditions">
        <li><strong>Ce que nous collectons</strong> : prénom, nom de l'entreprise, portable, vos réponses aux questions et la demande que vous remplissez pendant l'essai.</li>
        <li><strong>Pourquoi</strong> : faire fonctionner l'essai, compter vos parrainages, et vous prévenir de l'ouverture. Aucune revente, aucune publicité de tiers.</li>
        <li><strong>Combien de temps</strong> : pendant le programme de test, puis 12 mois après l'ouverture si vous ne devenez pas client.</li>
        <li><strong>Vos droits</strong> : vous pouvez supprimer toutes vos données à tout moment avec le bouton « Supprimer mes données » de votre espace testeur, ou demander l'accès, la correction ou la suppression par email à {CONTACT_EMAIL}.</li>
      </ul>
    </details>
  );
}
