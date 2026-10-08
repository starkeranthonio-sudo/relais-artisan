import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useApp, useLoad } from "./context.tsx";
import { euros } from "./format.ts";

const SUBSCRIPTION_EUROS = 39;

export function StatsPage() {
  const { api } = useApp();
  const [now] = useState(() => new Date());
  const [params] = useSearchParams();
  // ?mois=AAAA-MM (lien du SMS de bilan mensuel) ; sinon le mois en cours.
  const [month, setMonth] = useState(() => {
    const m = /^(\d{4})-(\d{2})$/.exec(params.get("mois") ?? "");
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1) : new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const { data: s, error } = useLoad(() => api.monthStats(month), [api, month.getTime()]);
  const prevMonth = new Date(month.getFullYear(), month.getMonth() - 1, 1);
  const { data: prev } = useLoad(() => api.monthStats(prevMonth), [api, prevMonth.getTime()]);
  const { data: history } = useLoad(() => api.wonByMonth(), [api]);
  useEffect(() => {
    api.track("stats_view");
  }, [api]);

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
            <Progress current={s.wonAmountCents} currentCount={s.quotesWon} prev={prev} prevLabel={monthName(prevMonth)} best={isBestMonth(month, s.wonAmountCents, history)} />
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

const monthName = (d: Date) => new Intl.DateTimeFormat("fr-FR", { month: "long" }).format(d);
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** Meilleur mois : plus de montant signé que tous les mois précédents (et au moins un mois précédent avec du chiffre). */
function isBestMonth(month: Date, amount: number, history: Record<string, number> | undefined): boolean {
  if (!history || amount <= 0) return false;
  const key = monthKey(month);
  const previous = Object.entries(history).filter(([k]) => k < key).map(([, v]) => v);
  return previous.some((v) => v > 0) && amount > Math.max(...previous);
}

/** Récompense « soi » : progression par rapport au mois précédent. */
function Progress({ current, currentCount, prev, prevLabel, best }: {
  current: number; currentCount: number; prev: { wonAmountCents: number; quotesWon: number } | undefined; prevLabel: string; best: boolean;
}) {
  if (!prev) return null;
  const diffCount = currentCount - prev.quotesWon;
  const diffAmount = current - prev.wonAmountCents;
  return (
    <div className="progress">
      {best && <span className="badge badge-best">Meilleur mois</span>}
      {(prev.quotesWon > 0 || currentCount > 0) && (
        <span className={`small ${diffAmount > 0 ? "accent" : "muted"}`}>
          {diffCount === 0 ? "Autant de chantiers" : `${diffCount > 0 ? "+" : ""}${diffCount} chantier${Math.abs(diffCount) > 1 ? "s" : ""}`}
          {diffAmount !== 0 && ` (${diffAmount > 0 ? "+" : "−"}${euros(Math.abs(diffAmount))})`} par rapport à {prevLabel}
        </span>
      )}
    </div>
  );
}
