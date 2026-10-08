import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { useApp, useLoad } from "./context.tsx";
import { formatPhone, nationalDigits, toE164 } from "./format.ts";
import { checkTemplate, DEFAULT_CLIENT_SMS, renderClientSms, toGsm7 } from "./smsTemplate.ts";
import { currentTier, INVITEE_REWARD, nextTier, TIERS } from "./founders.ts";
import type { Profile } from "./types.ts";

/** Règles des opérateurs pour un expéditeur SMS alphanumérique. */
const SENDER_RE = /^(?=.*[A-Za-z])[A-Za-z0-9]{1,11}$/;

/** « Élec Martin & Fils » → « ElecMartinF » : accents retirés (É → E), espaces et symboles supprimés, 11 caractères max. */
function toSenderName(raw: string): string {
  return raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]/g, "").slice(0, 11);
}

export function SetupPage() {
  const { api } = useApp();
  const { data: profile, error, reload } = useLoad(() => api.getProfile(), [api]);

  if (error) return <section className="screen"><p className="error">{error}</p></section>;
  if (profile === undefined) return <section className="screen"><p className="muted">Chargement…</p></section>;
  if (profile === null) return <section className="screen"><p>Profil introuvable. Contactez le support.</p></section>;

  return (
    <section className="screen">
      <header className="screen-head">
        <h1>Installation</h1>
        <p className="lead">3 minutes, une seule fois. Ensuite, chaque appel manqué est récupéré automatiquement.</p>
      </header>
      <TestDrive profile={profile} onDone={reload} />
      {profile.relay_number ? <Steps relay={profile.relay_number} /> : <Pending />}
      <SmsTemplateEditor profile={profile} onSaved={reload} />
      <GoogleReviewLink profile={profile} onSaved={reload} />
      <RecapToggle enabled={profile.daily_recap} onChange={reload} />
      <Referral profile={profile} onChange={reload} />
      <ProfileForm profile={profile} onSaved={reload} />
      <SignOut />
    </section>
  );
}

function Pending() {
  return (
    <div className="panel">
      <h2>Votre numéro relais</h2>
      <p className="muted small">Vous êtes testeur fondateur : votre numéro dédié vous sera attribué à l'ouverture commerciale. Vous recevrez un SMS avec le code à taper pour l'activer (3 minutes).</p>
    </div>
  );
}

function Steps({ relay }: { relay: string }) {
  const code = `**61*${nationalDigits(relay)}**20#`;
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* presse-papiers indisponible : le code reste affiché */
    }
  }

  return (
    <ol className="steps">
      <li className="panel">
        <span className="step-num">1</span>
        <h2>Votre numéro relais</h2>
        <p className="big-number">{formatPhone(relay)}</p>
        <p className="muted small">Les appels que vous ne prenez pas y sont renvoyés. Vos clients continuent d'appeler votre numéro habituel.</p>
      </li>
      <li className="panel">
        <span className="step-num">2</span>
        <h2>Activez le renvoi sur votre portable</h2>
        <p className="muted small">Ouvrez le clavier de votre téléphone, tapez ce code puis appuyez sur Appeler :</p>
        <div className="code-box">
          <code>{code}</code>
          <button className="btn-secondary" onClick={copy}>{copied ? "Copié" : "Copier"}</button>
        </div>
        <a className="btn-primary" href={`tel:${code.replace(/#/g, "%23")}`}>Activer (Android)</a>
        <p className="muted small">
          Sur iPhone, tapez le code à la main dans le clavier du téléphone. Votre portable sonne 20 secondes avant de renvoyer l'appel.
          Pour désactiver plus tard : <code>##61#</code>
        </p>
      </li>
      <li className="panel">
        <span className="step-num">3</span>
        <h2>Faites un essai</h2>
        <p className="muted small">
          Demandez à un proche de vous appeler et ne décrochez pas. Il doit recevoir un SMS à votre nom dans les 30 secondes.
          Sinon, vérifiez le code de l'étape 2.
        </p>
      </li>
    </ol>
  );
}

function ProfileForm({ profile, onSaved }: { profile: Profile; onSaved: () => void }) {
  const { api } = useApp();
  const [name, setName] = useState(profile.business_name);
  const [phone, setPhone] = useState(formatPhone(profile.owner_phone));
  const [sender, setSender] = useState(profile.sms_sender);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    const e164 = toE164(phone);
    if (name.trim().length < 2) return setMsg({ ok: false, text: "Nom trop court." });
    if (!e164) return setMsg({ ok: false, text: "Numéro de portable invalide." });
    if (!SENDER_RE.test(sender)) {
      return setMsg({ ok: false, text: "Nom d'expéditeur : 11 caractères maximum, lettres et chiffres uniquement (au moins une lettre)." });
    }
    try {
      await api.updateProfile({ business_name: name.trim(), owner_phone: e164, sms_sender: sender });
      setMsg({ ok: true, text: "Enregistré." });
      onSaved();
    } catch {
      setMsg({ ok: false, text: "Enregistrement impossible." });
    }
  }

  return (
    <form className="panel stack" onSubmit={save}>
      <h2>Mon entreprise</h2>
      <label className="field">
        <span className="label">Nom de l'entreprise</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">Expéditeur des SMS à vos clients</span>
        <input
          type="text"
          maxLength={11}
          autoCapitalize="off"
          value={sender}
          onChange={(e) => setSender(toSenderName(e.target.value))}
        />
        <span className="hint">11 caractères maximum, sans espace ni accent. Vos clients verront : <strong>{sender || "…"}</strong></span>
      </label>
      <label className="field">
        <span className="label">Portable qui reçoit les demandes</span>
        <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      {msg && <p className={msg.ok ? "success" : "error"}>{msg.text}</p>}
      <button className="btn-secondary">Enregistrer</button>
    </form>
  );
}

function SignOut() {
  const { api, base } = useApp();
  const navigate = useNavigate();
  if (api.demo) return null;
  return (
    <button className="btn-ghost" onClick={() => api.signOut().then(() => navigate(`${base}/connexion`))}>
      Se déconnecter
    </button>
  );
}

/** Programme testeurs fondateurs : SIRET vérifié, paliers de parrainage, partage du lien. */
function Referral({ profile, onChange }: { profile: Profile; onChange: () => void }) {
  const { api } = useApp();
  const { data: referrals } = useLoad(() => api.referrals(), [api]);
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/testeurs?parrain=${profile.referral_code}`;
  const message = `Je teste RelaisArti : mes appels manqués deviennent des demandes claires et mes devis sont relancés tout seuls. Inscris-toi comme testeur avec mon lien, tu auras ${INVITEE_REWARD} : ${link}`;
  const verified = referrals?.verified ?? 0;
  const reached = currentTier(verified);
  const next = nextTier(verified);

  async function share() {
    api.track("referral_share", { channel: "share" in navigator ? "share" : "copy" });
    if (navigator.share) {
      try {
        await navigator.share({ title: "RelaisArti", text: message });
        return;
      } catch {
        /* partage annulé : on copie le message */
      }
    }
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* presse-papiers indisponible */
    }
  }

  return (
    <div className="panel stack">
      <div>
        <p className="eyebrow">Testeurs fondateurs</p>
        <h2>Invitez vos confrères</h2>
        <p className="muted small">Chaque confrère du bâtiment qui s'inscrit avec votre lien vous rapproche du palier suivant, et il reçoit {INVITEE_REWARD}.</p>
      </div>

      <ol className="tiers">
        {TIERS.map((t) => (
          <li key={t.referrals} className={verified >= t.referrals ? "done" : next === t ? "next" : ""}>
            <span className="tier-count">{t.referrals}</span>
            <span><strong>{t.title}</strong><span className="muted small"> · {t.detail}</span></span>
          </li>
        ))}
      </ol>
      <p className="small">
        <strong className="accent">{verified} confrère{verified > 1 ? "s" : ""} vérifié{verified > 1 ? "s" : ""}</strong>
        {reached && <span className="muted"> · palier atteint : {reached.title}</span>}
        {next && <span className="muted"> · encore {next.referrals - verified} pour « {next.title} »</span>}
      </p>
      {referrals && referrals.names.length > verified && (
        <p className="muted small">{referrals.names.length - verified} confrère(s) inscrit(s) en attente de vérification de leur SIRET.</p>
      )}

      <div className="actions-2">
        <button className="btn-primary" onClick={share}>{copied ? "Message copié" : "Partager"}</button>
        <a className="btn-secondary" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" onClick={() => api.track("referral_share", { channel: "whatsapp" })}>WhatsApp</a>
      </div>
      <a className="btn-ghost" href={`sms:?&body=${encodeURIComponent(message)}`} onClick={() => api.track("referral_share", { channel: "sms" })}>Envoyer par SMS</a>

      <SiretBlock profile={profile} onChange={onChange} />
      <p className="muted small">Avantages valables à l'ouverture commerciale. <a href="/testeurs#conditions" target="_blank" rel="noreferrer">Conditions du programme</a></p>
    </div>
  );
}

/** SIRET : seuls les comptes vérifiés comptent dans les paliers de leur parrain. */
function SiretBlock({ profile, onChange }: { profile: Profile; onChange: () => void }) {
  const { api } = useApp();
  const [siret, setSiret] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (profile.siret_verified_at) {
    return <p className="success small">SIRET vérifié · {profile.siret_company_name}</p>;
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const { companyName } = await api.verifySiret(siret);
      api.track("siret_verified");
      setMsg({ ok: true, text: `Vérifié : ${companyName}` });
      onChange();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Vérification impossible." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="siret" onSubmit={verify}>
      <label className="field">
        <span className="label">Votre SIRET <span className="optional">pour que votre compte compte chez votre parrain</span></span>
        <input type="text" inputMode="numeric" value={siret} onChange={(e) => setSiret(e.target.value.replace(/[^\d ]/g, ""))} placeholder="123 456 789 00012" maxLength={17} />
      </label>
      {msg && <p className={msg.ok ? "success" : "error"}>{msg.text}</p>}
      <button className="btn-secondary" disabled={busy || siret.replace(/\s/g, "").length !== 14}>{busy ? "Vérification…" : "Vérifier"}</button>
    </form>
  );
}

/** Essai : simule un appel manqué pour vivre le vrai parcours sur son propre téléphone. */
function TestDrive({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const { api } = useApp();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const left = Math.max(0, 3 - profile.test_drives_used);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await api.testDrive();
      api.track("test_drive", { n: profile.test_drives_used + 1 });
      setSent(true);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Essai impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel stack test-drive">
      <div>
        <p className="eyebrow">Essai</p>
        <h2>Vivez-le sur votre téléphone</h2>
        <p className="muted small">On simule un appel manqué. Vous recevez le SMS que recevraient vos clients, à votre nom. Remplissez la demande comme un client : 1 minute après, vous recevez « Nouvelle demande » et elle s'affiche ici.</p>
      </div>
      {sent ? (
        <p className="success">SMS envoyé au {formatPhone(profile.owner_phone)}. Ouvrez-le et touchez le lien.</p>
      ) : (
        <button className="btn-primary" onClick={go} disabled={busy || left === 0}>
          {busy ? "Envoi…" : left === 0 ? "Essais utilisés" : "Faire l'essai"}
        </button>
      )}
      {error && <p className="error">{error}</p>}
      <p className="muted small">{left} essai{left > 1 ? "s" : ""} restant{left > 1 ? "s" : ""}.</p>
    </div>
  );
}

/** SMS récapitulatif de 18 h : activé par défaut, désactivable. */
function RecapToggle({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  const { api } = useApp();
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      await api.updateProfile({ daily_recap: !on });
      setOn(!on);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel toggle-row">
      <div>
        <h2>SMS de suivi</h2>
        <p className="muted small">Vers 18 h, du lundi au samedi, s'il y a des clients à rappeler ou des devis à classer. Et le 1er du mois, votre bilan.</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="SMS de suivi"
        className={`switch${on ? " on" : ""}`}
        disabled={busy}
        onClick={toggle}
      >
        <span />
      </button>
    </div>
  );
}

/** Le SMS envoyé au client après un appel manqué, écrit par l'artisan (investissement : l'outil devient « le sien »). */
function SmsTemplateEditor({ profile, onSaved }: { profile: Profile; onSaved: () => void }) {
  const { api } = useApp();
  const [text, setText] = useState(profile.client_sms_template ?? DEFAULT_CLIENT_SMS);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const check = checkTemplate(text, profile.business_name);
  const isDefault = text.trim() === DEFAULT_CLIENT_SMS;

  async function save() {
    if (!check.ok) return setMsg({ ok: false, text: check.reason });
    try {
      await api.updateProfile({ client_sms_template: isDefault ? null : text.trim() });
      api.track("sms_template_saved", { custom: !isDefault, length: check.length });
      setMsg({ ok: true, text: "Enregistré. Vos prochains clients recevront ce message." });
      onSaved();
    } catch {
      setMsg({ ok: false, text: "Enregistrement impossible." });
    }
  }

  return (
    <div className="panel stack">
      <div>
        <h2>Votre message aux clients</h2>
        <p className="muted small">Envoyé juste après un appel manqué. Écrivez-le avec vos mots. <code>{"{nom}"}</code> = votre entreprise, <code>{"{lien}"}</code> = la page où le client décrit son besoin (obligatoire).</p>
      </div>
      <textarea rows={4} maxLength={300} value={text} onChange={(e) => { setText(e.target.value); setMsg(null); }} />
      <div className="sms-preview">
        <span className="sms-preview-from">{profile.sms_sender}</span>
        <p>{toGsm7(renderClientSms(text, profile.business_name))}</p>
      </div>
      <p className={`small ${check.ok ? "muted" : "accent"}`}>{check.ok ? `${check.length}/160 caractères · 1 SMS` : check.reason}</p>
      {msg && <p className={msg.ok ? "success" : "error"}>{msg.text}</p>}
      <div className="actions-2">
        <button className="btn-primary" onClick={save} disabled={!check.ok}>Enregistrer</button>
        <button className="btn-secondary" onClick={() => { setText(DEFAULT_CLIENT_SMS); setMsg(null); }} disabled={isDefault}>Texte par défaut</button>
      </div>
    </div>
  );
}

/** Lien d'avis Google de l'artisan, utilisé par « Chantier terminé : demander un avis ». */
function GoogleReviewLink({ profile, onSaved }: { profile: Profile; onSaved: () => void }) {
  const { api } = useApp();
  const [url, setUrl] = useState(profile.google_review_url ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    const clean = url.trim();
    if (clean && !/^https:\/\/\S+$/.test(clean)) return setMsg({ ok: false, text: "Collez le lien complet, qui commence par https://" });
    try {
      await api.updateProfile({ google_review_url: clean || null });
      setMsg({ ok: true, text: clean ? "Enregistré." : "Lien supprimé." });
      onSaved();
    } catch {
      setMsg({ ok: false, text: "Enregistrement impossible." });
    }
  }

  return (
    <form className="panel stack" onSubmit={save}>
      <div>
        <h2>Avis Google</h2>
        <p className="muted small">
          Quand un chantier est terminé, demandez un avis à votre client en un clic. Plus d'avis, c'est plus d'appels.
          Votre lien se trouve dans votre fiche Google : <strong>Demander des avis</strong> → copier le lien.
        </p>
      </div>
      <label className="field">
        <span className="label">Votre lien d'avis Google</span>
        <input type="url" inputMode="url" value={url} onChange={(e) => { setUrl(e.target.value); setMsg(null); }} placeholder="https://g.page/r/…/review" />
      </label>
      {msg && <p className={msg.ok ? "success" : "error"}>{msg.text}</p>}
      <button className="btn-secondary">Enregistrer</button>
    </form>
  );
}
