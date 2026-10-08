import { useEffect } from "react";
import { Link, useSearchParams } from "react-router";
import { INVITEE_REWARD, TIERS } from "./founders.ts";
import "./app.css";

/** Page publique du programme « Testeurs fondateurs » (cible des liens de parrainage : /testeurs?parrain=<code>). */
export function FoundersPage() {
  const [params] = useSearchParams();
  const parrain = params.get("parrain");
  const signup = `/app/inscription${parrain ? `?parrain=${encodeURIComponent(parrain)}` : ""}`;

  useEffect(() => {
    document.title = "Testeurs fondateurs – Relais Artisan";
  }, []);

  return (
    <main className="founders">
      <p className="eyebrow">Testeurs fondateurs</p>
      <h1>Ne perdez plus un client à cause d'un appel manqué</h1>
      <p className="lead">
        Quand vous ne pouvez pas décrocher, votre client reçoit tout de suite un SMS à votre nom pour décrire son besoin.
        Vous recevez la demande résumée, et vos devis sont relancés automatiquement.
      </p>
      {parrain && <p className="invite">Un confrère vous invite : <strong>{INVITEE_REWARD}</strong> à l'ouverture.</p>}

      <Link className="btn-primary cta" to={signup}>Devenir testeur gratuitement</Link>
      <p className="muted small center-text">1 minute. Essai immédiat sur votre téléphone. Sans carte bancaire.</p>

      <section className="founders-section">
        <h2>Comment ça marche</h2>
        <ol className="how">
          <li><strong>Vous créez votre compte.</strong> Nom de l'entreprise, portable, métier.</li>
          <li><strong>Vous faites l'essai.</strong> On simule un appel manqué : vous recevez le SMS que recevraient vos clients, à votre nom.</li>
          <li><strong>À l'ouverture</strong>, vous recevez votre numéro relais et le code à taper sur votre portable. 3 minutes, sans changer de numéro.</li>
        </ol>
      </section>

      <section className="founders-section">
        <h2>Invitez vos confrères, gagnez des avantages</h2>
        <ol className="tiers">
          {TIERS.map((t) => (
            <li key={t.referrals}>
              <span className="tier-count">{t.referrals}</span>
              <span><strong>{t.title}</strong><span className="muted small"> · {t.detail}</span></span>
            </li>
          ))}
        </ol>
        <p className="muted small">Chaque confrère invité reçoit aussi {INVITEE_REWARD}.</p>
      </section>

      <section className="founders-section" id="conditions">
        <h2>Conditions du programme</h2>
        <ul className="conditions">
          <li>Le programme est gratuit et sans engagement. Aucun paiement n'est demandé pendant la phase de test.</li>
          <li>Un parrainage compte quand le confrère invité crée son compte avec votre lien <strong>et</strong> que son SIRET est vérifié comme entreprise du bâtiment en activité. Un seul compte par SIRET ; pas de parrainage de son propre compte.</li>
          <li>Les avantages s'appliquent à l'ouverture commerciale du service (abonnement payant), sur le compte du parrain et de l'invité. Ils ne sont ni cumulables avec une autre offre, ni échangeables contre de l'argent. Maximum : 6 mois offerts.</li>
          <li>Le tarif fondateur (49 € HT/mois au lieu de 59 € HT/mois) est garanti 24 mois à partir de la souscription.</li>
          <li>Si le service n'ouvre pas commercialement, aucun avantage n'est dû et aucun paiement n'aura été demandé. Vous pouvez supprimer votre compte à tout moment.</li>
          <li>Aucun tirage au sort : les avantages dépendent uniquement du nombre de confrères vérifiés.</li>
        </ul>
      </section>

      <Link className="btn-primary cta" to={signup}>Devenir testeur gratuitement</Link>
      <p className="muted small center-text"><Link to="/demo">Voir une démonstration</Link> · <Link to="/app/connexion">Déjà inscrit ? Se connecter</Link></p>
    </main>
  );
}
