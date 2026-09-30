import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { useApp, useLoad } from "./context.tsx";
import { formatPhone, nationalDigits, toE164 } from "./format.ts";
import type { Profile } from "./types.ts";

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
      {profile.relay_number ? <Steps relay={profile.relay_number} /> : <Pending />}
      <ProfileForm profile={profile} onSaved={reload} />
      <SignOut />
    </section>
  );
}

function Pending() {
  return (
    <div className="panel">
      <h2>Votre numéro relais est en préparation</h2>
      <p className="muted">Nous activons votre numéro dédié sous 24 h ouvrées. Vous recevrez un SMS dès qu'il est prêt, avec le code à taper pour l'activer.</p>
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
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    const e164 = toE164(phone);
    if (name.trim().length < 2) return setMsg({ ok: false, text: "Nom trop court." });
    if (!e164) return setMsg({ ok: false, text: "Numéro de portable invalide." });
    try {
      await api.updateProfile({ business_name: name.trim(), owner_phone: e164 });
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
        <span className="label">Nom affiché dans les SMS</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
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
