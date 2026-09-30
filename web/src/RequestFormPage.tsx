import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiError, fetchFormInfo, type FormInfo, submitRequest, type Urgency } from "./api.ts";
import { AddressInput } from "./AddressInput.tsx";
import { shrinkPhoto } from "./image.ts";

const MAX_PHOTOS = 3;

const URGENCIES: { value: Urgency; label: string; hint: string }[] = [
  { value: "urgent", label: "Urgent", hint: "aujourd'hui" },
  { value: "week", label: "Cette semaine", hint: "dans les jours qui viennent" },
  { value: "flexible", label: "Pas pressé", hint: "devis, projet" },
];

type State =
  | { kind: "loading" }
  | { kind: "invalid"; message: string }
  | { kind: "form"; info: FormInfo }
  | { kind: "done"; businessName: string };

interface PhotoItem {
  blob: Blob;
  url: string;
}

export function RequestFormPage({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    fetchFormInfo(token)
      .then((info) => setState(info.submitted ? { kind: "done", businessName: info.businessName } : { kind: "form", info }))
      .catch((e) => setState({ kind: "invalid", message: e instanceof ApiError ? e.message : "Page indisponible. Merci de réessayer." }));
  }, [token]);

  useEffect(() => {
    if (state.kind === "form" || state.kind === "done") {
      document.title = `${state.kind === "form" ? state.info.businessName : state.businessName} – Votre demande`;
    }
  }, [state]);

  return (
    <main className="page">
      {state.kind === "loading" && <div className="center muted" aria-busy="true">Chargement…</div>}
      {state.kind === "invalid" && (
        <div className="center">
          <h1>Lien invalide</h1>
          <p className="muted">{state.message}</p>
        </div>
      )}
      {state.kind === "done" && <Thanks businessName={state.businessName} />}
      {state.kind === "form" && (
        <RequestForm token={token} info={state.info} onDone={() => setState({ kind: "done", businessName: state.info.businessName })} />
      )}
      <footer className="footer">
        Vos informations sont transmises uniquement à cet artisan pour traiter votre demande.
      </footer>
    </main>
  );
}

function Thanks({ businessName }: { businessName: string }) {
  return (
    <div className="center">
      <svg className="check" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <h1>Demande envoyée</h1>
      <p><strong>{businessName}</strong> a bien reçu votre demande et vous recontacte rapidement.</p>
      <p className="muted small">Vous pouvez fermer cette page.</p>
    </div>
  );
}

function RequestForm({ token, info, onDone }: { token: string; info: FormInfo; onDone: () => void }) {
  const [workType, setWorkType] = useState("");
  const [description, setDescription] = useState("");
  const [urgency, setUrgency] = useState<Urgency | "">("");
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<{ message: string; fields: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  // Le message d'erreur disparaît dès que le client corrige un champ.
  const fields = [workType, description, urgency, address].join("|");
  const error = failure?.fields === fields ? failure.message : null;

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setPhotoBusy(true);
    try {
      const room = MAX_PHOTOS - photos.length;
      const added: PhotoItem[] = [];
      for (const file of Array.from(files).slice(0, room)) {
        const blob = await shrinkPhoto(file);
        added.push({ blob, url: URL.createObjectURL(blob) });
      }
      setPhotos((prev) => [...prev, ...added]);
    } catch {
      fail("Impossible de lire cette photo. Essayez-en une autre.");
    } finally {
      setPhotoBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function removePhoto(i: number) {
    setPhotos((prev) => {
      URL.revokeObjectURL(prev[i].url);
      return prev.filter((_, j) => j !== i);
    });
  }

  function fail(message: string) {
    setFailure({ message, fields });
    requestAnimationFrame(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!workType) return fail("Choisissez le type de travaux.");
    if (description.trim().length < 5) return fail("Décrivez votre besoin en quelques mots.");
    if (!urgency) return fail("Indiquez si c'est urgent.");
    if (address.trim().length < 3) return fail("Indiquez l'adresse ou la ville de l'intervention.");
    setFailure(null);
    setSending(true);
    try {
      await submitRequest(token, { name, workType, description, address, urgency, photos: photos.map((p) => p.blob) });
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) return onDone();
      fail(err instanceof ApiError ? err.message : "Envoi impossible. Vérifiez votre connexion et réessayez.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <header className="intro">
        <p className="eyebrow">{info.businessName}</p>
        <h1>Désolé d'avoir manqué votre appel</h1>
        <p className="lead">Décrivez votre besoin en 1 minute, je vous recontacte rapidement.</p>
      </header>

      <fieldset>
        <legend>Type de travaux</legend>
        <div className="chips">
          {info.workTypes.map((w) => (
            <label key={w} className={`chip${workType === w ? " selected" : ""}`}>
              <input type="radio" name="work_type" value={w} checked={workType === w} onChange={() => setWorkType(w)} />
              {w}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="field">
        <span className="label">Votre besoin</span>
        <textarea
          rows={4}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Ex. : fuite sous l'évier de la cuisine depuis ce matin, l'eau coule en continu."
        />
      </label>

      <fieldset>
        <legend>Urgence</legend>
        <div className="segmented">
          {URGENCIES.map((u) => (
            <label key={u.value} className={`segment${urgency === u.value ? " selected" : ""}`}>
              <input type="radio" name="urgency" value={u.value} checked={urgency === u.value} onChange={() => setUrgency(u.value)} aria-label={`${u.label}, ${u.hint}`} />
              <span className="segment-label">{u.label}</span>
              <span className="segment-hint">{u.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <span className="label" id="address-label">Adresse de l'intervention</span>
        <AddressInput value={address} onChange={setAddress} labelledBy="address-label" />
      </div>

      <div className="field">
        <span className="label">Photos<span className="optional">facultatif, {MAX_PHOTOS} max.</span></span>
        <p className="hint">Une photo aide beaucoup à préparer l'intervention.</p>
        <div className="photos">
          {photos.map((p, i) => (
            <div key={p.url} className="thumb">
              <img src={p.url} alt={`Photo ${i + 1}`} />
              <button type="button" className="remove" onClick={() => removePhoto(i)} aria-label={`Retirer la photo ${i + 1}`}>×</button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS && (
            <button type="button" className="add-photo" onClick={() => fileInput.current?.click()} disabled={photoBusy}>
              {photoBusy ? "…" : "+ Photo"}
            </button>
          )}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => addPhotos(e.target.files)}
        />
      </div>

      <label className="field">
        <span className="label">Votre prénom<span className="optional">facultatif</span></span>
        <input type="text" autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
      </label>

      {error && <p ref={errorRef} className="error" role="alert">{error}</p>}

      <div className="submit-bar">
        <button type="submit" className="submit" disabled={sending || photoBusy}>
          {sending ? "Envoi…" : "Envoyer ma demande"}
        </button>
      </div>
    </form>
  );
}
