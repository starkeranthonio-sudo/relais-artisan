import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate, useParams } from "react-router";
import { supabase } from "../lib/supabase.ts";
import { supabaseApi } from "./api.ts";
import { LoginPage, SignupPage, WelcomePage } from "./AuthPages.tsx";
import { AppProvider, useApp } from "./context.tsx";
import { demoApi } from "./demoApi.ts";
import { LeadDetailPage } from "./LeadDetailPage.tsx";
import { LeadsPage } from "./LeadsPage.tsx";
import { ProspectionPage } from "./ProspectionPage.tsx";
import { QuotesPage } from "./QuotesPage.tsx";
import { SetupPage } from "./SetupPage.tsx";
import { StatsPage } from "./StatsPage.tsx";
import "./app.css";

/** Espace artisan. `demo` : données fictives, sans compte (démonstration commerciale). */
export function ArtisanApp({ demo }: { demo: boolean }) {
  const base = demo ? "/demo" : "/app";
  useEffect(() => {
    document.title = "RelaisArti";
  }, []);
  return (
    <AppProvider value={{ api: demo ? demoApi : supabaseApi, base }}>
      <Routes>
        {!demo && <Route path="connexion" element={<LoginPage />} />}
        {!demo && <Route path="inscription" element={<SignupPage />} />}
        {!demo && <Route path="bienvenue" element={<RequireSession allowNoProfile><WelcomePage /></RequireSession>} />}
        <Route element={demo ? <Shell /> : <RequireSession><Shell /></RequireSession>}>
          <Route index element={<LeadsPage />} />
          <Route path="demandes/:id" element={<LeadDetailPage />} />
          <Route path="l/:token" element={<LeadFromSms />} />
          <Route path="r" element={<Navigate to={base} replace />} />
          <Route path="b/:month" element={<MonthlyLink />} />
          <Route path="devis" element={<QuotesPage />} />
          <Route path="bilan" element={<StatsPage />} />
          <Route path="installation" element={<SetupPage />} />
          {!demo && <Route path="prospection" element={<ProspectionPage />} />}
        </Route>
        <Route path="*" element={<Navigate to={base} replace />} />
      </Routes>
    </AppProvider>
  );
}

function RequireSession({ children, allowNoProfile = false }: { children: React.ReactNode; allowNoProfile?: boolean }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [hasProfile, setHasProfile] = useState<boolean | undefined>(undefined);
  const { pathname } = useLocation();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  // Compte Google / Apple sans fiche artisan : on passe d'abord par « Bienvenue ».
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId || allowNoProfile) return;
    supabaseApi.getProfile().then((p) => setHasProfile(p !== null), () => setHasProfile(true));
  }, [userId, allowNoProfile]);

  if (session === undefined) return <div className="screen-center muted">Chargement…</div>;
  // Après connexion, on revient sur la page demandée (ex. la demande ouverte depuis le SMS).
  if (!session) return <Navigate to={`/app/connexion${pathname !== "/app" ? `?next=${encodeURIComponent(pathname)}` : ""}`} replace />;
  if (!allowNoProfile) {
    if (hasProfile === undefined) return <div className="screen-center muted">Chargement…</div>;
    if (!hasProfile) return <Navigate to={`/app/bienvenue?next=${encodeURIComponent(pathname)}`} replace />;
  }
  return children;
}

const TABS = [
  { to: "", label: "Demandes", icon: "M4 6h16M4 12h16M4 18h10", end: true },
  { to: "devis", label: "Devis", icon: "M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5", end: false },
  { to: "bilan", label: "Bilan", icon: "M5 20V11M12 20V5M19 20v-6", end: false },
  { to: "installation", label: "Réglages", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1", end: false },
];

/** Lien court du SMS « Nouvelle demande » (/app/l/<jeton>) : ouvre la fiche correspondante. */
function LeadFromSms() {
  const { token = "" } = useParams();
  const { api, base } = useApp();
  const navigate = useNavigate();
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    api.leadIdByToken(token).then((id) => (id ? navigate(`${base}/demandes/${id}`, { replace: true }) : setMissing(true)));
  }, [api, base, navigate, token]);
  return missing ? <section className="screen"><p>Demande introuvable.</p><Link to={base}>Voir mes demandes</Link></section> : null;
}

/** Lien du SMS de bilan mensuel (/app/b/AAAA-MM) : ouvre le bilan de ce mois-là. */
function MonthlyLink() {
  const { month = "" } = useParams();
  const { base } = useApp();
  return <Navigate to={`${base}/bilan${/^\d{4}-\d{2}$/.test(month) ? `?mois=${month}` : ""}`} replace />;
}

function Shell() {
  const { api, base } = useApp();
  const { pathname } = useLocation();

  // Une ouverture par chargement de l'espace artisan ; « sms » si on arrive par le lien du SMS (déclencheur externe).
  const [openedFrom] = useState(() =>
    pathname.includes("/l/") ? "sms" : /\/r\/?$/.test(pathname) ? "recap" : pathname.includes("/b/") ? "monthly" : "direct"
  );
  useEffect(() => {
    api.track("app_open", { source: openedFrom });
  }, [api, openedFrom]);
  return (
    <div className="shell">
      {api.demo && (
        <div className="demo-banner">
          <span>Démonstration · données fictives</span>
          <Link to="/app/inscription">Créer mon compte</Link>
        </div>
      )}
      <div className="shell-content">
        <Outlet />
      </div>
      <nav className="tabbar" aria-label="Navigation principale">
        {TABS.map((t) => (
          <NavLink key={t.label} to={t.to ? `${base}/${t.to}` : base} end={t.end} className="tab">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={t.icon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{t.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
