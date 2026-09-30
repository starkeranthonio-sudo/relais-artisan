import { type FormEvent, useState } from "react";
import { Link, useParams } from "react-router";
import { useApp, useLoad } from "./context.tsx";
import { clientLabel, euros, followupStatus, formatPhone, leadStage, parseEuros, relativeTime, shortDate, STAGE_LABEL, URGENCY_LABEL } from "./format.ts";
import type { Lead } from "./types.ts";

export function LeadDetailPage() {
  const { id = "" } = useParams();
  const { api, base } = useApp();
  const { data: lead, error, reload } = useLoad(() => api.getLead(id), [api, id]);
  const { data: photos } = useLoad(() => api.photoUrls(lead?.photo_paths ?? []), [api, lead?.photo_paths.join()]);

  if (error) return <section className="screen"><p className="error">{error}</p></section>;
  if (lead === undefined) return <section className="screen"><p className="muted">Chargement…</p></section>;
  if (lead === null) return <section className="screen"><p>Demande introuvable.</p><Link to={base}>Retour</Link></section>;

  const stage = leadStage(lead);
  const mapsUrl = lead.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.address)}` : null;

  return (
    <section className="screen">
      <Link to={base} className="back">‹ Demandes</Link>
      <header className="screen-head">
        <div className="row-meta">
          <span className={`badge badge-${stage}`}>{STAGE_LABEL[stage]}</span>
          {lead.urgency && <span className={`badge ${lead.urgency === "urgent" ? "badge-urgent" : ""}`}>{URGENCY_LABEL[lead.urgency]}</span>}
        </div>
        <h1>{clientLabel(lead)}</h1>
        <p className="lead">{formatPhone(lead.client_phone)} · {relativeTime(lead.form_submitted_at ?? lead.last_call_at)}</p>
      </header>

      <div className="actions-2">
        <a className="btn-primary" href={`tel:${lead.client_phone}`}>Appeler</a>
        <a className="btn-secondary" href={`sms:${lead.client_phone}`}>SMS</a>
      </div>

      {lead.form_submitted_at ? (
        <div className="panel">
          {lead.ai_summary && <p className="summary">{lead.ai_summary}</p>}
          <dl className="facts">
            {lead.work_type && <><dt>Travaux</dt><dd>{lead.work_type}</dd></>}
            {lead.address && <><dt>Adresse</dt><dd>{mapsUrl ? <a href={mapsUrl} target="_blank" rel="noreferrer">{lead.address}</a> : lead.address}</dd></>}
            {lead.description && <><dt>Message du client</dt><dd className="quote-text">{lead.description}</dd></>}
          </dl>
          {photos && photos.length > 0 && (
            <div className="photo-grid">
              {photos.map((src, i) => (
                <a key={src} href={src} target="_blank" rel="noreferrer"><img src={src} alt={`Photo ${i + 1} du client`} /></a>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="panel">
          <p>
            {lead.call_count > 1 ? `Ce client a appelé ${lead.call_count} fois. ` : ""}
            Un SMS lui a été envoyé automatiquement avec le lien pour décrire son besoin. Vous serez prévenu par SMS dès qu'il l'aura rempli.
          </p>
          <p className="muted small">Vous pouvez aussi le rappeler directement.</p>
        </div>
      )}

      <QuoteSection lead={lead} onChange={reload} />

      {stage !== "closed" && (
        <div className="status-actions">
          {lead.status !== "contacted" && !lead.quote && (
            <button className="btn-ghost" onClick={() => api.setLeadStatus(lead.id, "contacted").then(reload)}>Marquer comme contacté</button>
          )}
          <button className="btn-ghost" onClick={() => api.setLeadStatus(lead.id, "closed").then(reload)}>Classer la demande</button>
        </div>
      )}
    </section>
  );
}

function QuoteSection({ lead, onChange }: { lead: Lead; onChange: () => void }) {
  const { api } = useApp();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = lead.quote;

  async function declareQuote(e: FormEvent) {
    e.preventDefault();
    const cents = amount.trim() ? parseEuros(amount) : null;
    if (amount.trim() && cents === null) return setError("Montant invalide.");
    setBusy(true);
    try {
      await api.createQuote(lead.id, cents, new Date());
      onChange();
    } catch {
      setError("Impossible d'enregistrer le devis. Réessayez.");
    } finally {
      setBusy(false);
    }
  }

  if (!q) {
    return (
      <form className="panel quote-form" onSubmit={declareQuote}>
        <h2>Devis</h2>
        <p className="muted small">Dès que vous avez envoyé votre devis, dites-le ici : le client sera relancé automatiquement par SMS à J+3, J+7 et J+14, jusqu'à ce qu'il réponde.</p>
        <label className="field">
          <span className="label">Montant HT <span className="optional">facultatif</span></span>
          <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Ex. : 1 250" />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn-primary" disabled={busy}>{busy ? "Enregistrement…" : "J'ai envoyé un devis"}</button>
      </form>
    );
  }

  return (
    <div className="panel">
      <h2>Devis{q.amount_cents !== null ? ` · ${euros(q.amount_cents)}` : ""}</h2>
      <p>Envoyé le {shortDate(q.sent_at)}</p>
      <p className="muted small">{followupStatus(q)}</p>
      {q.status === "pending" && <QuoteDecision quoteId={q.id} hasAmount={q.amount_cents !== null} onChange={onChange} />}
    </div>
  );
}

/** Boutons Gagné / Perdu ; demande le montant au moment du « gagné » s'il manque (utile pour le bilan). */
export function QuoteDecision({ quoteId, hasAmount, onChange }: { quoteId: string; hasAmount: boolean; onChange: () => void }) {
  const { api } = useApp();
  const [askAmount, setAskAmount] = useState(false);
  const [amount, setAmount] = useState("");

  async function decide(status: "won" | "lost") {
    if (status === "won" && !hasAmount && !askAmount) return setAskAmount(true);
    const cents = askAmount ? parseEuros(amount) : undefined;
    await api.setQuoteStatus(quoteId, status, cents ?? undefined);
    onChange();
  }

  return (
    <div className="decision">
      {askAmount && (
        <label className="field">
          <span className="label">Montant signé HT</span>
          <input type="text" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Ex. : 1 250" />
        </label>
      )}
      <div className="actions-2">
        <button className="btn-primary" onClick={() => decide("won")}>{askAmount ? "Valider" : "Gagné"}</button>
        {!askAmount && <button className="btn-secondary" onClick={() => decide("lost")}>Perdu</button>}
        {askAmount && <button className="btn-secondary" onClick={() => setAskAmount(false)}>Annuler</button>}
      </div>
    </div>
  );
}
