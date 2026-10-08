import { type FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { supabase } from "../lib/supabase.ts";
import { toE164 } from "./format.ts";

/** Page où revenir après connexion (seulement un chemin interne, jamais un autre site). */
function useNext(fallback: string): string {
  const [params] = useSearchParams();
  const next = params.get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}

const PROVIDERS = {
  google: import.meta.env.VITE_AUTH_GOOGLE === "true",
  apple: import.meta.env.VITE_AUTH_APPLE === "true",
};
export const REFERRAL_STORAGE_KEY = "ra_parrain";

/** « Continuer avec Google / Apple » (affichés seulement si le fournisseur est configuré dans Supabase). */
function SocialButtons({ next, referralCode }: { next: string; referralCode?: string }) {
  const [error, setError] = useState<string | null>(null);
  if (!PROVIDERS.google && !PROVIDERS.apple) return null;

  async function go(provider: "google" | "apple") {
    setError(null);
    try {
      if (referralCode) localStorage.setItem(REFERRAL_STORAGE_KEY, referralCode);
    } catch {
      /* stockage indisponible : le parrainage sera perdu, la connexion fonctionne quand même */
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}${next}` },
    });
    if (error) setError("Connexion impossible pour le moment. Utilisez votre email.");
  }

  return (
    <div className="social">
      {PROVIDERS.apple && (
        <button type="button" className="btn-social" onClick={() => go("apple")}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.37 12.6c-.02-2.1 1.72-3.12 1.8-3.17-.98-1.43-2.5-1.63-3.05-1.65-1.3-.13-2.53.76-3.19.76-.66 0-1.67-.74-2.75-.72-1.41.02-2.72.82-3.45 2.09-1.47 2.55-.38 6.33 1.06 8.4.7 1.01 1.53 2.15 2.62 2.11 1.05-.04 1.45-.68 2.72-.68 1.27 0 1.63.68 2.74.66 1.13-.02 1.85-1.03 2.54-2.05.8-1.17 1.13-2.3 1.15-2.36-.03-.01-2.2-.85-2.22-3.36zM14.3 6.43c.58-.7.97-1.68.86-2.65-.83.03-1.84.55-2.44 1.25-.54.62-1.01 1.61-.88 2.56.93.07 1.88-.47 2.46-1.16z"/></svg>
          Continuer avec Apple
        </button>
      )}
      {PROVIDERS.google && (
        <button type="button" className="btn-social" onClick={() => go("google")}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.24 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.6 10.6 0 0 0 12 1 11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/>
          </svg>
          Continuer avec Google
        </button>
      )}
      {error && <p className="error">{error}</p>}
      <div className="divider"><span>ou avec votre email</span></div>
    </div>
  );
}

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
  const next = useNext("/app");
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
    navigate(next, { replace: true });
  }

  return (
    <AuthLayout title="Connexion" lead="Retrouvez vos demandes et vos devis.">
      <SocialButtons next={next} />
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
      <p className="auth-switch">Pas encore de compte ? <Link to={`/app/inscription${next !== "/app" ? `?next=${encodeURIComponent(next)}` : ""}`}>Créer un compte</Link></p>
    </AuthLayout>
  );
}

export function SignupPage() {
  const navigate = useNavigate();
  const next = useNext("/app/installation");
  const [params] = useSearchParams();
  const referralCode = params.get("parrain") ?? undefined;
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
        data: { business_name: businessName.trim(), owner_phone: ownerPhone, referral_code: referralCode },
        emailRedirectTo: `${window.location.origin}${next}`,
      },
    });
    setBusy(false);
    if (error) return setError(error.message.includes("registered") ? "Un compte existe déjà avec cet email." : "Inscription impossible. Réessayez.");
    if (data.session) navigate(next, { replace: true });
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
      <SocialButtons next={next} referralCode={referralCode} />
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
      <p className="auth-switch">Déjà inscrit ? <Link to={`/app/connexion${next !== "/app/installation" ? `?next=${encodeURIComponent(next)}` : ""}`}>Se connecter</Link></p>
      <p className="auth-switch"><Link to="/demo">Voir une démonstration</Link></p>
    </AuthLayout>
  );
}

/**
 * Premier passage après une connexion Google / Apple : on demande ce qui manque pour envoyer les SMS
 * (nom affiché aux clients, portable qui reçoit les demandes).
 */
export function WelcomePage() {
  const navigate = useNavigate();
  const next = useNext("/app/installation");
  const [businessName, setBusinessName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ownerPhone = toE164(phone);
    if (businessName.trim().length < 2) return setError("Indiquez le nom de votre entreprise.");
    if (!ownerPhone) return setError("Numéro de portable invalide (ex. : 06 12 34 56 78).");
    let referralCode: string | null = null;
    try {
      referralCode = localStorage.getItem(REFERRAL_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("create_my_artisan", {
      p_business_name: businessName.trim(),
      p_owner_phone: ownerPhone,
      p_referral_code: referralCode,
    });
    setBusy(false);
    if (error) return setError("Enregistrement impossible. Vérifiez les informations et réessayez.");
    try {
      localStorage.removeItem(REFERRAL_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    navigate(next, { replace: true });
  }

  return (
    <AuthLayout title="Bienvenue" lead="Deux informations et c'est terminé.">
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
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn-primary" disabled={busy}>{busy ? "Enregistrement…" : "Continuer"}</button>
      </form>
    </AuthLayout>
  );
}
