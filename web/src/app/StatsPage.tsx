import { useState } from "react";
import { useApp, useLoad } from "./context.tsx";
import { euros } from "./format.ts";

const SUBSCRIPTION_EUROS = 59;

export function StatsPage() {
  const { api } = useApp();
  const [now] = useState(() => new Date());
  const [month, setMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const { data: s, error } = useLoad(() => api.monthStats(month), [api, month.getTime()]);

  const isCurrent = month.getFullYear() === now.getFullYear() && month.getMonth() === now.getMonth();
  const label = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(month);
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  const decided = s ? s.quotesWon + s.quotesLost : 0;

  return (
    <section className="screen">
      <header className="screen-head">
        <h1>Bilan</h1>
        <div className="month-switch">
          <button onClick={() => shift(-1)} aria-label="Mois précédent">‹</button>
          <span className="month-label">{label}</span>
          <button onClick={() => shift(1)} disabled={isCurrent} aria-label="Mois suivant">›</button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}
      {!s && !error && <p className="muted">Chargement…</p>}
      {s && (
        <>
          <div className="hero-stat">
            <span className="eyebrow">Devis signés</span>
            <span className="hero-value">{euros(s.wonAmountCents)}</span>
            <span className="muted">{s.quotesWon} chantier{s.quotesWon > 1 ? "s" : ""} gagné{s.quotesWon > 1 ? "s" : ""}</span>
          </div>

          <dl className="stat-grid">
            <Stat value={s.missedCalls} label="appels manqués reçus" />
            <Stat value={s.clientsTexted} label="clients recontactés par SMS" />
            <Stat value={s.requests} label="demandes détaillées" />
            <Stat value={s.quotesSent} label="devis envoyés" />
            <Stat value={decided ? `${Math.round((s.quotesWon / decided) * 100)} %` : "—"} label="taux de signature" />
            <Stat value={s.quotesLost} label="devis perdus" />
          </dl>

          {s.wonAmountCents > 0 && (
            <p className="roi">
              Votre abonnement coûte {SUBSCRIPTION_EUROS} € par mois. En {label.split(" ")[0]}, vous avez signé{" "}
              <strong>{euros(s.wonAmountCents)}</strong> de travaux.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
