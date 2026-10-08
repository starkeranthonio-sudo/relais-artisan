import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { URGENCY_LABEL } from "./format.ts";
import { savedToken } from "./testerApi.ts";
import type { Urgency } from "./types.ts";
import "./app.css";

interface Preview {
  clientName: string | null;
  workType: string | null;
  urgency: Urgency | null;
  address: string | null;
  description: string | null;
  summary: string | null;
}

/** Lien du SMS « Nouvelle demande » d'un testeur : la demande telle qu'il la recevrait en vrai. */
export function EssaiPreview() {
  const { token = "" } = useParams();
  const [data, setData] = useState<{ businessName: string; preview?: Preview } | null>(null);
  const [error, setError] = useState(false);
  const mySpace = savedToken.get();

  useEffect(() => {
    document.title = "Votre demande d'essai – RelaisArti";
    const base = (import.meta.env.VITE_FUNCTIONS_URL as string).replace(/\/$/, "");
    fetch(`${base}/request-form?t=${encodeURIComponent(token)}`, { headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string } })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true));
  }, [token]);

  if (error) return <main className="founders"><h1>Lien invalide</h1></main>;
  if (!data) return <main className="founders"><p className="muted">Chargement…</p></main>;
  const p = data.preview;

  return (
    <main className="founders">
      <p className="eyebrow">RelaisArti · Essai</p>
      <h1>Voilà ce que vous recevrez à chaque appel manqué</h1>
      {p ? (
        <div className="panel">
          <div className="row-meta">
            {p.workType && <span className="badge">{p.workType}</span>}
            {p.urgency && <span className={`badge ${p.urgency === "urgent" ? "badge-urgent" : ""}`}>{URGENCY_LABEL[p.urgency]}</span>}
          </div>
          {p.summary && <p className="summary">{p.summary}</p>}
          <dl className="facts">
            {p.clientName && <><dt>Client</dt><dd>{p.clientName}</dd></>}
            {p.address && <><dt>Adresse</dt><dd>{p.address}</dd></>}
            {p.description && <><dt>Message du client</dt><dd className="quote-text">{p.description}</dd></>}
          </dl>
        </div>
      ) : (
        <p className="lead">La demande n'a pas encore été remplie.</p>
      )}
      <p className="muted">
        En vrai, vous ouvrez cette fiche depuis le SMS, vous appelez le client en un clic, et vous déclarez votre devis : il est relancé tout seul.
      </p>
      {mySpace && <Link className="btn-primary cta" to={`/testeurs/moi/${mySpace}`}>Continuer mon inscription</Link>}
    </main>
  );
}
