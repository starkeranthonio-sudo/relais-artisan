import { lazy, Suspense } from "react";
import { BrowserRouter, Link, Route, Routes, useParams } from "react-router";
import { RequestFormPage } from "./RequestFormPage.tsx";

// L'espace artisan est chargé à part : la page client (/d/…), ouverte en 4G depuis un SMS, reste légère.
const ArtisanApp = lazy(() => import("./app/ArtisanApp.tsx").then((m) => ({ default: m.ArtisanApp })));

function RequestFormRoute() {
  const { token = "" } = useParams();
  return <RequestFormPage token={token} />;
}

function Home() {
  return (
    <main className="page">
      <div className="center">
        <p className="eyebrow">Relais Artisan</p>
        <h1>Ne perdez plus un client à cause d'un appel manqué</h1>
        <p className="lead">Chaque appel manqué reçoit un SMS à votre nom, la demande vous arrive résumée, vos devis sont relancés automatiquement.</p>
        <Link className="submit home-cta" to="/app/inscription">Créer mon compte</Link>
        <Link to="/demo" className="home-link">Voir une démonstration</Link>
      </div>
    </main>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/d/:token" element={<RequestFormRoute />} />
        <Route path="/app/*" element={<Suspense fallback={null}><ArtisanApp demo={false} /></Suspense>} />
        <Route path="/demo/*" element={<Suspense fallback={null}><ArtisanApp demo /></Suspense>} />
        <Route path="*" element={<Home />} />
      </Routes>
    </BrowserRouter>
  );
}
