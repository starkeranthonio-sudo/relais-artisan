import { useState } from "react";
import { Link } from "react-router";
import { useApp, useLoad } from "./context.tsx";
import { clientLabel, euros, followupStatus, shortDate } from "./format.ts";
import { QuoteDecision } from "./LeadDetailPage.tsx";
import type { QuoteStatus } from "./types.ts";

const TABS: { value: QuoteStatus; label: string }[] = [
  { value: "pending", label: "En attente" },
  { value: "won", label: "Gagnés" },
  { value: "lost", label: "Perdus" },
];

export function QuotesPage() {
  const { api, base } = useApp();
  const { data: quotes, error, reload } = useLoad(() => api.listQuotes(), [api]);
  const [tab, setTab] = useState<QuoteStatus>("pending");

  const visible = (quotes ?? []).filter((q) => q.status === tab);
  const total = visible.reduce((s, q) => s + (q.amount_cents ?? 0), 0);

  return (
    <section className="screen">
      <header className="screen-head">
        <h1>Devis</h1>
        {visible.length > 0 && total > 0 && (
          <p className="lead">{visible.length} devis · <strong>{euros(total)}</strong> {tab === "pending" ? "en jeu" : tab === "won" ? "signés" : "perdus"}</p>
        )}
      </header>

      <div className="tabs-inline" role="tablist">
        {TABS.map((t) => (
          <button key={t.value} role="tab" aria-selected={tab === t.value} onClick={() => setTab(t.value)}>
            {t.label}
            <span className="count">{(quotes ?? []).filter((q) => q.status === t.value).length}</span>
          </button>
        ))}
      </div>

      {error && <p className="error">{error}</p>}
      {!quotes && !error && <p className="muted">Chargement…</p>}
      {quotes && visible.length === 0 && (
        <div className="empty">
          <p className="empty-title">{tab === "pending" ? "Aucun devis en attente" : tab === "won" ? "Pas encore de devis gagné" : "Aucun devis perdu"}</p>
          {tab === "pending" && <p className="muted">Ouvrez une demande et touchez « J'ai envoyé un devis » : les relances partent toutes seules.</p>}
        </div>
      )}

      <ul className="list">
        {visible.map((q) => (
          <li key={q.id} className="row">
            <Link to={`${base}/demandes/${q.lead.id}`} className="row-link">
              <div className="row-top">
                <span className="row-title">{clientLabel(q.lead)}</span>
                <span className="row-amount">{q.amount_cents !== null ? euros(q.amount_cents) : "—"}</span>
              </div>
              <div className="row-meta">
                {q.lead.work_type && <span className="muted">{q.lead.work_type}</span>}
                <span className="muted">· envoyé le {shortDate(q.sent_at)}</span>
              </div>
              <p className={`row-body ${q.stop_reason === "client_replied" && q.status === "pending" ? "accent" : ""}`}>{followupStatus(q)}</p>
            </Link>
            {q.status === "pending" && <QuoteDecision quoteId={q.id} hasAmount={q.amount_cents !== null} onChange={reload} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
