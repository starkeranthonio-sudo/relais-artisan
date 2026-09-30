import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";
import { supabase } from "../lib/supabase.ts";
import { toE164 } from "./format.ts";

function AuthLayout({ title, lead, children }: { title: string; lead: string; children: React.ReactNode }) {
  return (
    <main className="auth">
      <p className="eyebrow">Relais Artisan</p>
      <h1>{title}</h1>
      <p className="lead">{lead}</p>
      {children}
    </main>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) return setError("Email ou mot de passe incorrect.");
    navigate("/app", { replace: true });
  }

  return (
    <AuthLayout title="Connexion" lead="Retrouvez vos demandes et vos devis.">
      <form className="stack" onSubmit={onSubmit}>
        <label className="field">
          <span className="label">Email</span>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Mot de passe</span>
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn-primary" disabled={busy}>{busy ? "Connexion…" : "Se connecter"}</button>
      </form>
      <p className="auth-switch">Pas encore de compte ? <Link to="/app/inscription">Créer un compte</Link></p>
    </AuthLayout>
  );
}

export function SignupPage() {
  const navigate = useNavigate();
  const [businessName, setBusinessName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ownerPhone = toE164(phone);
    if (businessName.trim().length < 2) return setError("Indiquez le nom de votre entreprise.");
    if (!ownerPhone) return setError("Numéro de portable invalide (ex. : 06 12 34 56 78).");
    if (password.length < 8) return setError("Mot de passe : 8 caractères minimum.");
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { business_name: businessName.trim(), owner_phone: ownerPhone },
        emailRedirectTo: `${window.location.origin}/app/installation`,
      },
    });
    setBusy(false);
    if (error) return setError(error.message.includes("registered") ? "Un compte existe déjà avec cet email." : "Inscription impossible. Réessayez.");
    if (data.session) navigate("/app/installation", { replace: true });
    else setCheckEmail(true);
  }

  if (checkEmail) {
    return (
      <AuthLayout title="Vérifiez vos emails" lead={`Nous avons envoyé un lien de confirmation à ${email}. Cliquez dessus pour activer votre compte.`}>
        <p className="auth-switch"><Link to="/app/connexion">Retour à la connexion</Link></p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Ne perdez plus un client" lead="Créez votre compte en 1 minute. Vos appels manqués deviennent des demandes claires, et vos devis sont relancés automatiquement.">
      <form className="stack" onSubmit={onSubmit} noValidate>
        <label className="field">
          <span className="label">Nom de l'entreprise</span>
          <input type="text" autoComplete="organization" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Ex. : Dupont Plomberie" />
          <span className="hint">C'est le nom que verront vos clients dans les SMS.</span>
        </label>
        <label className="field">
          <span className="label">Votre portable</span>
          <input type="tel" autoComplete="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="06 12 34 56 78" />
          <span className="hint">Vous y recevrez les nouvelles demandes par SMS.</span>
        </label>
        <label className="field">
          <span className="label">Email</span>
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Mot de passe</span>
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8 caractères minimum" />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn-primary" disabled={busy}>{busy ? "Création…" : "Créer mon compte"}</button>
      </form>
      <p className="auth-switch">Déjà inscrit ? <Link to="/app/connexion">Se connecter</Link></p>
      <p className="auth-switch"><Link to="/demo">Voir une démonstration</Link></p>
    </AuthLayout>
  );
}
