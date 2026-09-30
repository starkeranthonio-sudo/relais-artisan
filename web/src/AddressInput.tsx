import { useEffect, useId, useRef, useState } from "react";

// Base Adresse Nationale (IGN) : API publique, gratuite, sans clé.
// https://geoservices.ign.fr/documentation/services/services-geoplateforme/geocodage
const GEOCODE_URL = "https://data.geopf.fr/geocodage/search";
const MIN_CHARS = 3;
const DEBOUNCE_MS = 250;

interface Suggestion {
  id: string;
  label: string; // "12 Rue des Lilas 78140 Vélizy-Villacoublay"
  line1: string; // "12 Rue des Lilas"
  line2: string; // "78140 Vélizy-Villacoublay"
}

interface GeoFeature {
  properties: { id: string; label: string; name: string; postcode?: string; city?: string };
}

async function searchAddresses(q: string, signal: AbortSignal): Promise<Suggestion[]> {
  const url = `${GEOCODE_URL}?${new URLSearchParams({ q, autocomplete: "1", limit: "5" })}`;
  const res = await fetch(url, { signal });
  if (!res.ok) return [];
  const { features } = (await res.json()) as { features: GeoFeature[] };
  return features.map(({ properties: p }) => ({
    id: p.id,
    label: p.label,
    line1: p.name,
    line2: [p.postcode, p.city].filter(Boolean).join(" "),
  }));
}

/**
 * Champ adresse avec suggestions sous le champ (combobox accessible au clavier).
 * La saisie libre reste possible : si l'API ne répond pas, le client tape son adresse normalement.
 */
export function AddressInput({ value, onChange, labelledBy }: { value: string; onChange: (v: string) => void; labelledBy?: string }) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const skipNextSearch = useRef(false);
  const listId = useId();

  useEffect(() => {
    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < MIN_CHARS) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchAddresses(q, controller.signal)
        .then((list) => {
          setSuggestions(list);
          setActive(-1);
          setOpen(list.length > 0);
        })
        .catch(() => {}); // réseau coupé ou requête annulée : saisie libre
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value]);

  function pick(s: Suggestion) {
    skipNextSearch.current = true;
    onChange(s.label);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      pick(suggestions[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const visible = open && value.trim().length >= MIN_CHARS;

  return (
    <div className="combobox">
      <input
        type="text"
        role="combobox"
        aria-labelledby={labelledBy}
        aria-expanded={visible}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={visible && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setOpen(false)}
        placeholder="Commencez à taper : 12 rue des Lilas…"
      />
      {visible && (
        <ul id={listId} role="listbox" className="suggestions">
          {suggestions.map((s, i) => (
            <li
              key={s.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : undefined}
              // mousedown (et pas click) : se déclenche avant le blur du champ qui ferme la liste
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
            >
              <span className="s-line1">{s.line1}</span>
              <span className="s-line2">{s.line2}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
