import { useState } from "react";
import { Link } from "react-router";
import { useApp, useLoad } from "./context.tsx";
import { clientLabel, leadStage, relativeTime, STAGE_LABEL, URGENCY_LABEL } from "./format.ts";
import type { Lead } from "./types.ts";

type Filter = "active" | "all";

export function LeadsPage() {
  const { api, base } = useApp();
  const { data: leads, error } = useLoad(() => api.listLeads(), [api]);
  const [filter, setFilter] = useState<Filter>("active");

  const visible = (leads ?? []).filter((l) => filter === "all" || leadStage(l) !== "closed");
  const toHandle = (leads ?? []).filter((l) => leadStage(l) === "to_handle").length;

  return (
    <section className="screen">
      <header className="screen-head">
        <h1>Demandes</h1>
        {toHandle > 0 && <p className="lead"><strong className="accent">{toHandle} à rappeler</strong></p>}
      </header>

      <div className="tabs-inline" role="tablist">
        <button role="tab" aria-selected={filter === "active"} onClick={() => setFilter("active")}>En cours</button>
        <button role="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")}>Toutes</button>
      </div>

      {error && <p className="error">{error}</p>}
      {!leads && !error && <p className="muted">Chargement…</p>}
      {leads && visible.length === 0 && (
        <div className="empty">
          <p className="empty-title">Aucune demande pour l'instant</p>
          <p className="muted">Chaque appel que vous ne pouvez pas prendre arrivera ici, avec un SMS déjà envoyé au client.</p>
          <Link className="btn-secondary" to={`${base}/installation`}>Vérifier l'installation</Link>
        </div>
      )}

      <ul className="list">
        {visible.map((l) => <LeadRow key={l.id} lead={l} href={`${base}/demandes/${l.id}`} />)}
      </ul>
    </section>
  );
}

function LeadRow({ lead: l, href }: { lead: Lead; href: string }) {
  const stage = leadStage(l);
  return (
    <li>
      <Link to={href} className={`row stage-${stage}`}>
        <div className="row-top">
          <span className="row-title">{clientLabel(l)}</span>
          <span className="row-time">{relativeTime(l.form_submitted_at ?? l.last_call_at)}</span>
        </div>
        <div className="row-meta">
          <span className={`badge badge-${stage}`}>{STAGE_LABEL[stage]}</span>
          {l.urgency === "urgent" && stage !== "closed" && <span className="badge badge-urgent">{URGENCY_LABEL.urgent}</span>}
          {l.work_type && <span className="muted">{l.work_type}</span>}
        </div>
        <p className="row-body">
          {l.ai_summary ??
            (l.call_count > 1
              ? `A appelé ${l.call_count} fois. SMS envoyé, en attente de sa demande.`
              : "Appel manqué. SMS envoyé, en attente de sa demande.")}
        </p>
      </Link>
    </li>
  );
}
