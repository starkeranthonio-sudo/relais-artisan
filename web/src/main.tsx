import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { RequestFormPage } from "./RequestFormPage.tsx";

// Essai de couleurs : ?accent=jaune pour comparer avec l'orange.
const accent = new URLSearchParams(window.location.search).get("accent");
if (accent) document.documentElement.dataset.accent = accent;

// Routage minimal en V1 : /d/<jeton> = page de demande du client. L'espace artisan (/app) arrive à l'étape 4.
const match = /^\/d\/([A-Za-z0-9]+)\/?$/.exec(window.location.pathname);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {match ? <RequestFormPage token={match[1]} /> : (
      <main className="page">
        <div className="card center">
          <h1>Relais Artisan</h1>
          <p className="muted">Ne perdez plus un client à cause d'un appel manqué.</p>
        </div>
      </main>
    )}
  </StrictMode>,
);
