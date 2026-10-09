import { INVITEE_REWARD, TIERS } from "./founders.ts";

/**
 * Frise des avantages du parrainage : un cercle par palier (nombre de confrères inscrits jusqu'au bout), l'avantage dessous,
 * une ligne qui se remplit avec la progression.
 */
export function RewardsTrack({ count = 0, showInvitee = true }: { count?: number; showInvitee?: boolean }) {
  const last = TIERS[TIERS.length - 1].referrals;
  // Remplissage de la ligne : proportionnel entre deux paliers (les cercles sont régulièrement espacés).
  const reachedIndex = TIERS.filter((t) => count >= t.referrals).length - 1;
  const next = TIERS[reachedIndex + 1];
  const prevCount = reachedIndex >= 0 ? TIERS[reachedIndex].referrals : 0;
  const partial = next ? Math.min(1, (count - prevCount) / (next.referrals - prevCount)) : 0;
  const segments = TIERS.length - 1;
  const fill = count >= last ? 100 : Math.max(0, ((reachedIndex + (reachedIndex >= 0 ? partial : 0)) / segments) * 100);

  return (
    <div className="rewards">
      <div className="rewards-track" style={{ ["--fill" as string]: `${fill}%` }}>
        {TIERS.map((t) => {
          const done = count >= t.referrals;
          const isNext = next === t;
          return (
            <div key={t.referrals} className={`reward${done ? " done" : ""}${isNext ? " next" : ""}`}>
              <span className="reward-circle" aria-label={`${t.referrals} confrère${t.referrals > 1 ? "s" : ""}`}>
                {done ? (
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : t.referrals}
              </span>
              <span className="reward-label">{t.short}</span>
              <span className="reward-count">{t.referrals} confrère{t.referrals > 1 ? "s" : ""}</span>
            </div>
          );
        })}
      </div>
      {showInvitee && <p className="rewards-invitee">Votre confrère, lui, reçoit <strong>{INVITEE_REWARD}</strong> en s'inscrivant avec votre lien.</p>}
    </div>
  );
}
