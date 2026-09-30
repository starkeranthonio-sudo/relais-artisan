import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { Link, Navigate, NavLink, Outlet, Route, Routes } from "react-router";
import { supabase } from "../lib/supabase.ts";
import { supabaseApi } from "./api.ts";
import { LoginPage, SignupPage } from "./AuthPages.tsx";
import { AppProvider, useApp } from "./context.tsx";
import { demoApi } from "./demoApi.ts";
import { LeadDetailPage } from "./LeadDetailPage.tsx";
import { LeadsPage } from "./LeadsPage.tsx";
import { QuotesPage } from "./QuotesPage.tsx";
import { SetupPage } from "./SetupPage.tsx";
import { StatsPage } from "./StatsPage.tsx";
import "./app.css";

/** Espace artisan. `demo` : données fictives, sans compte (démonstration commerciale). */
export function ArtisanApp({ demo }: { demo: boolean }) {
  const base = demo ? "/demo" : "/app";
  useEffect(() => {
    document.title = "Relais Artisan";
  }, []);
  return (
    <AppProvider value={{ api: demo ? demoApi : supabaseApi, base }}>
      <Routes>
        {!demo && <Route path="connexion" element={<LoginPage />} />}
        {!demo && <Route path="inscription" element={<SignupPage />} />}
        <Route element={demo ? <Shell /> : <RequireSession><Shell /></RequireSession>}>
          <Route index element={<LeadsPage />} />
          <Route path="demandes/:id" element={<LeadDetailPage />} />
          <Route path="devis" element={<QuotesPage />} />
          <Route path="bilan" element={<StatsPage />} />
          <Route path="installation" element={<SetupPage />} />
        </Route>
        <Route path="*" element={<Navigate to={base} replace />} />
      </Routes>
    </AppProvider>
  );
}

function RequireSession({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  if (session === undefined) return <div className="screen-center muted">Chargement…</div>;
  if (!session) return <Navigate to="/app/connexion" replace />;
  return children;
}

const TABS = [
  { to: "", label: "Demandes", icon: "M4 6h16M4 12h16M4 18h10", end: true },
  { to: "devis", label: "Devis", icon: "M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5", end: false },
  { to: "bilan", label: "Bilan", icon: "M5 20V11M12 20V5M19 20v-6", end: false },
  { to: "installation", label: "Réglages", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1", end: false },
];

function Shell() {
  const { api, base } = useApp();
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
