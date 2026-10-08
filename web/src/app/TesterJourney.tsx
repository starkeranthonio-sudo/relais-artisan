import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { toE164 } from "./format.ts";
import { currentTier, FOUNDER_PRICE, INVITEE_REWARD, nextTier, PRICE, TIERS, TRADES } from "./founders.ts";
import { logStep, savedToken, TesterError, testerApi, type TesterState } from "./testerApi.ts";
import "./app.css";

/**
 * Parcours « Testeurs fondateurs » RelaisArti, sans compte :
 * /testeurs : présentation → infos ; /testeurs/moi/<jeton> : essai → SIRET → lien de parrainage.
 */

const STEPS = ["Infos", "Essai", "SIRET", "Partage"];

function Progress({ current }: { current: number }) {
  return (
    <ol className="stepper" aria-label="Étapes">
      {STEPS.map((s, i) => (
        <li key={s} className={i < current ? "done" : i === current ? "current" : ""} aria-current={i === current ? "step" : undefined}>
          <span>{i + 1}</span>
          {s}
        </li>
      ))}
    </ol>
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
      <p className="muted small">Vos informations servent uniquement au programme de test RelaisArti. Vous pouvez demander leur suppression à tout moment.</p>
    </form>
  );
}

// ---------------------------------------------------------------- Espace personnel : essai → SIRET → partage

export function TesterSpace() {
  const { token = "" } = useParams();
  const [state, setState] = useState<TesterState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3 | null>(null);

  const reload = () =>
    testerApi.state(token).then((s) => {
      setState(s);
      return s;
    });

  useEffect(() => {
    document.title = "Mon espace testeur – RelaisArti";
    savedToken.set(token);
    reload()
      .then((s) => setStep(s.referralCode || s.completed ? 3 : s.testDrivesUsed > 0 ? 2 : 1))
      .catch((e) => setError(e instanceof TesterError ? e.message : "Page indisponible."));
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <main className="founders"><h1>Lien invalide</h1><p className="lead">{error}</p><Link to="/testeurs">S'inscrire</Link></main>;
  if (!state || !step) return <main className="founders"><p className="muted">Chargement…</p></main>;

  return (
    <main className="founders">
      <p className="eyebrow">RelaisArti · {state.businessName}</p>
      <Progress current={step} />
      {step === 1 && <TestStep token={token} state={state} onNext={() => reload().then(() => setStep(2))} />}
      {step === 2 && <SiretStep token={token} state={state} onNext={() => reload().then(() => setStep(3))} />}
      {step === 3 && <ShareStep token={token} state={state} onAddSiret={() => setStep(2)} />}
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
        <li>Vous recevez <strong>le SMS envoyé à vos clients</strong>, à votre nom.</li>
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
      <h1>Votre SIRET</h1>
      <p className="lead">Il prouve que vous êtes un vrai artisan du bâtiment. Il est nécessaire pour obtenir votre lien de parrainage et vos avantages.</p>
      <form className="stack" onSubmit={verify}>
        <label className="field">
          <span className="label">SIRET (14 chiffres)</span>
          <input type="text" inputMode="numeric" maxLength={17} value={siret} onChange={(e) => setSiret(e.target.value.replace(/[^\d ]/g, ""))} placeholder="123 456 789 00012" />
          <span className="hint">Il figure sur vos devis et factures.</span>
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
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!state.completed) void testerApi.complete(token);
  }, [token, state.completed]);

  if (!state.referralCode) {
    return (
      <div className="stack">
        <h1>Merci {state.firstName}, vous êtes inscrit</h1>
        <p className="lead">Vous serez parmi les premiers prévenus à l'ouverture.</p>
        <p>Ajoutez votre SIRET pour obtenir votre lien de parrainage et gagner des avantages en invitant vos confrères.</p>
        <button className="btn-primary cta" onClick={onAddSiret}>Ajouter mon SIRET</button>
      </div>
    );
  }

  const link = `${window.location.origin}/testeurs?parrain=${state.referralCode}`;
  const message = `Je teste RelaisArti : quand je rate un appel, le client reçoit un SMS à mon nom et mes devis sont relancés tout seuls. Inscris-toi comme testeur avec mon lien (${INVITEE_REWARD} pour toi) : ${link}`;
  const verified = state.referrals.verified;
  const next = nextTier(verified);
  const reached = currentTier(verified);
  const track = (channel: string) => logStep("share_clicked", state.referralCode, { channel });

  async function copy() {
    track("copy");
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* presse-papiers indisponible */
    }
  }

  return (
    <div className="stack">
      <h1>Invitez vos confrères</h1>
      <p className="lead">Chaque confrère du bâtiment qui s'inscrit avec votre lien et dont le SIRET est vérifié vous fait monter d'un palier. Il reçoit {INVITEE_REWARD}.</p>

      <div className="share-link"><code>{link}</code></div>
      <div className="actions-2">
        <a className="btn-primary" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" onClick={() => track("whatsapp")}>WhatsApp</a>
        <a className="btn-secondary" href={`sms:?&body=${encodeURIComponent(message)}`} onClick={() => track("sms")}>SMS</a>
      </div>
      <button className="btn-secondary" onClick={copy}>{copied ? "Message copié" : "Copier le message"}</button>

      <div className="panel">
        <p>
          <strong className="accent">{verified} confrère{verified > 1 ? "s" : ""} vérifié{verified > 1 ? "s" : ""}</strong>
          {state.referrals.registered > verified && <span className="muted"> · {state.referrals.registered - verified} en attente de SIRET</span>}
        </p>
        <ol className="tiers">
          {TIERS.map((t) => (
            <li key={t.referrals} className={verified >= t.referrals ? "done" : next === t ? "next" : ""}>
              <span className="tier-count">{t.referrals}</span>
              <span><strong>{t.title}</strong><span className="muted small"> · {t.detail}</span></span>
            </li>
          ))}
        </ol>
        {reached && <p className="small muted">Palier atteint : {reached.title}.</p>}
        {next && <p className="small muted">Encore {next.referrals - verified} pour « {next.title} ».</p>}
      </div>
      {state.siretStatus === "pending_manual" && <p className="muted small">Votre SIRET est en cours de vérification : vos parrainages comptent dès maintenant.</p>}
      <p className="muted small">Gardez le SMS « votre espace testeur » : il vous ramène ici pour suivre vos parrainages.</p>
      <Conditions />
    </div>
  );
}

function Conditions() {
  return (
    <details className="conditions-box" id="conditions">
      <summary>Conditions du programme</summary>
      <ul className="conditions">
        <li>Le programme est gratuit et sans engagement. Aucun paiement n'est demandé pendant la phase de test.</li>
        <li>Un parrainage compte quand le confrère invité s'inscrit avec votre lien <strong>et</strong> que son SIRET est vérifié comme entreprise du bâtiment en activité (vérification automatique ou sur justificatif). Un seul compte par SIRET ; pas de parrainage de son propre compte.</li>
        <li>Les avantages s'appliquent à l'ouverture commerciale du service (abonnement à {PRICE} € HT/mois), sur le compte du parrain et de l'invité. Ils ne sont ni cumulables avec une autre offre, ni échangeables contre de l'argent. Maximum : 6 mois offerts.</li>
        <li>Le tarif fondateur ({FOUNDER_PRICE} € HT/mois au lieu de {PRICE} €) est garanti 24 mois à partir de la souscription.</li>
        <li>Si le service n'ouvre pas commercialement, aucun avantage n'est dû et aucun paiement n'aura été demandé. Vous pouvez demander la suppression de vos données à tout moment.</li>
        <li>Aucun tirage au sort : les avantages dépendent uniquement du nombre de confrères vérifiés.</li>
      </ul>
    </details>
  );
}
