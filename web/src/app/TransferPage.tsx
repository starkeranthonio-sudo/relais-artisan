import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { supabase } from "../lib/supabase.ts";
import { URGENCY_LABEL } from "./format.ts";
import { DEMO_TRANSFER_TOKEN, fetchTransferPreview, respondToTransfer, TransferError, type TransferPreview } from "./transferApi.ts";
import "./app.css";

/**
 * Page ouverte depuis le SMS d'invitation (/t/<jeton>).
 * Un confrère non inscrit voit un aperçu du chantier et doit créer son compte pour obtenir les coordonnées du client.
 */
export function TransferPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [declined, setDeclined] = useState(false);
  const demo = token === DEMO_TRANSFER_TOKEN;

  useEffect(() => {
    document.title = "Un client pour vous – RelaisArti";
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
  }, []);

  useEffect(() => {
    if (session === undefined) return;
    fetchTransferPreview(token)
      .then(setPreview)
      .catch((e) => setError(e instanceof TransferError ? e.message : "Page indisponible."));
  }, [token, session]);

  async function respond(action: "accept" | "decline") {
    setBusy(true);
    setError(null);
    try {
      const { leadId } = await respondToTransfer(token, action);
      if (action === "decline") setDeclined(true);
      else navigate(demo ? "/demo/demandes/l1" : `/app/demandes/${leadId}`);
    } catch (e) {
      // Connecté avec Google / Apple mais fiche artisan pas encore complétée.
      if (e instanceof TransferError && e.status === 401 && session) {
        navigate(`/app/bienvenue?next=${encodeURIComponent(`/t/${token}`)}`);
        return;
      }
      setError(e instanceof TransferError ? e.message : "Action impossible. Réessayez.");
    } finally {
      setBusy(false);
    }
  }

  const next = encodeURIComponent(`/t/${token}`);

  if (error && !preview) return <main className="auth"><h1>Lien invalide</h1><p className="lead">{error}</p></main>;
  if (!preview || session === undefined) return <main className="auth"><p className="muted">Chargement…</p></main>;

  if (preview.leadId) {
    return (
      <main className="auth">
        <h1>Client déjà accepté</h1>
        <p className="lead">Vous avez pris ce client en charge.</p>
        <Link className="btn-primary" to={`/app/demandes/${preview.leadId}`}>Voir la demande</Link>
      </main>
    );
  }

  return (
    <main className="auth">
      <p className="eyebrow">Un client pour vous</p>
      <h1>{preview.fromName} vous transmet un chantier</h1>

      <div className="panel">
        <div className="row-meta">
          {preview.workType && <span className="badge">{preview.workType}</span>}
          {preview.urgency && <span className={`badge ${preview.urgency === "urgent" ? "badge-urgent" : ""}`}>{URGENCY_LABEL[preview.urgency]}</span>}
        </div>
        {preview.city && <p className="big-city">{preview.city}</p>}
        {preview.summary && <p className="summary">{preview.summary}</p>}
        {preview.note && <p className="quote-text muted">« {preview.note} » — {preview.fromName}</p>}
      </div>

      {declined ? (
        <p className="lead">C'est noté, {preview.fromName} a été prévenu.</p>
      ) : preview.status === "pending" ? (
        session && !demo ? (
          preview.isSender ? (
            <p className="muted">Vous avez transmis ce client. Votre confrère va recevoir le lien.</p>
          ) : (
            <div className="stack">
              {error && <p className="error">{error}</p>}
              <button className="btn-primary" disabled={busy} onClick={() => respond("accept")}>Je prends ce client</button>
              <button className="btn-ghost" disabled={busy} onClick={() => respond("decline")}>Je ne peux pas</button>
              <p className="muted small">En acceptant, vous recevez le nom, le téléphone et l'adresse du client. Il est prévenu que vous allez l'appeler.</p>
            </div>
          )
        ) : (
          <div className="stack">
            <p>Pour voir les coordonnées du client et le contacter, créez votre compte gratuit (1 minute).</p>
            <Link className="btn-primary" to={`/app/inscription?next=${next}`}>Créer mon compte gratuit</Link>
            <Link className="btn-secondary" to={`/app/connexion?next=${next}`}>J'ai déjà un compte</Link>
            <p className="muted small">RelaisArti récupère vos appels manqués et relance vos devis automatiquement.</p>
          </div>
        )
      ) : (
        <p className="lead">
          {preview.status === "expired" ? "Cette transmission a expiré." : "Ce client a déjà été pris en charge."}
        </p>
      )}
    </main>
  );
}
