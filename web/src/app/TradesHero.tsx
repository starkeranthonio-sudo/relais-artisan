/**
 * Scène d'accueil du parcours testeur : les métiers visés (plombier, électricien, peintre, maçon, couvreur, carreleur,
 * chauffagiste), toutes couleurs de peau, flottent autour d'un téléphone qui passe de « Appel manqué » à « Client pris en charge ».
 * Personnages 3D : Microsoft Fluent Emoji (licence MIT, public/metiers/LICENSE-fluentui-emoji.txt).
 */

interface Figure {
  img: string;
  label: string;
  tool: string;
  x: number; // position du centre, en % de la scène
  y: number;
  size: number; // px
  delay: number; // s, décalage du flottement
}

const FIGURES: Figure[] = [
  { img: "plombier-1", label: "Plombier", tool: "outil-cle", x: 13, y: 20, size: 74, delay: 0 },
  { img: "electricienne-1", label: "Électricienne", tool: "outil-eclair", x: 50, y: 9, size: 70, delay: 0.8 },
  { img: "peintre-1", label: "Peintre", tool: "outil-pinceau", x: 87, y: 20, size: 74, delay: 1.6 },
  { img: "macon-1", label: "Maçon", tool: "outil-brique", x: 9, y: 54, size: 70, delay: 2.4 },
  { img: "couvreuse-1", label: "Couvreuse", tool: "outil-echelle", x: 91, y: 54, size: 70, delay: 0.4 },
  { img: "chauffagiste-1", label: "Chauffagiste", tool: "outil-caisse", x: 20, y: 84, size: 66, delay: 1.2 },
  { img: "peintre-2", label: "Peintre", tool: "outil-pinceau", x: 50, y: 92, size: 64, delay: 2 },
  { img: "carreleur-1", label: "Carreleur", tool: "outil-marteau", x: 80, y: 84, size: 66, delay: 2.8 },
];

const src = (name: string) => `/metiers/${name}.webp`;

export function TradesHero() {
  return (
    <div className="trades-hero" aria-hidden="true">
      <div className="hero-glow" />
      {FIGURES.map((f, i) => (
        <div
          key={f.img}
          className="hero-figure"
          style={{ left: `${f.x}%`, top: `${f.y}%`, width: f.size, height: f.size, animationDelay: `${-f.delay}s` }}
        >
          <img src={src(f.img)} alt="" width={f.size} height={f.size} decoding="async" />
          <img className="hero-tool" src={src(f.tool)} alt="" width={26} height={26} decoding="async" />
          <span className="hero-label" style={{ animationDelay: `${i * 1.5}s` }}>{f.label}</span>
        </div>
      ))}
      <div className="hero-phone">
        <span className="hero-ring" />
        <span className="hero-ring hero-ring-2" />
        <img src={src("telephone")} alt="" width={58} height={58} />
        <span className="hero-chip hero-chip-missed">Appel manqué</span>
        <span className="hero-chip hero-chip-saved">Client pris en charge</span>
      </div>
    </div>
  );
}
