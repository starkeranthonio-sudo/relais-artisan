import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { formatPhone, relativeTime, toE164 } from "./format.ts";
import { TRADES } from "./founders.ts";
import {
  buildMessage, type Channel, DAILY_LIMIT, DEFAULT_TEMPLATES, FOLLOW_UP_AFTER_DAYS, isMobile, loadTemplates, needsFollowUp, type Progress, type Prospect,
  prospectApi, type ProspectSource, type ProspectStatus, saveTemplates, smsHref, SOURCES, type Templates, whatsappHref,
} from "./prospection.ts";

type Filter = "todo" | "followup" | "ongoing" | "all";

const STATUS_LABEL: Record<ProspectStatus, string> = {
  nouveau: "À contacter", contacte: "Contacté", interesse: "Intéressé", pas_interesse: "Pas intéressé", stop: "STOP",
};

/** /app/prospection : liste des artisans à contacter, message personnalisé prêt à envoyer, suivi du lien de chacun. */
export function ProspectionPage() {
  const [prospects, setProspects] = useState<Prospect[] | null>(null);
  const [progress, setProgress] = useState<Map<string, Progress>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("todo");
  const [templates, setTemplates] = useState<Templates>(loadTemplates);
  const [showTemplates, setShowTemplates] = useState(false);

  useEffect(() => {
    document.title = "Prospection – RelaisArti";
    Promise.all([prospectApi.list(), prospectApi.progress()])
      .then(([list, prog]) => (setProspects(list), setProgress(prog)))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const replace = (p: Prospect) => setProspects((list) => list?.map((x) => (x.id === p.id ? p : x)) ?? null);
  const all = prospects ?? [];
  const groups = useMemo(() => {
    const followup = all.filter((p) => needsFollowUp(p, progress.get(p.code)));
    return {
      todo: all.filter((p) => p.status === "nouveau"),
      followup,
      ongoing: all.filter((p) => (p.status === "contacte" || p.status === "interesse") && !followup.includes(p)),
      all,
    };
  }, [all, progress]);

  const today = new Date().toDateString();
  const sentToday = all.filter((p) => p.last_channel !== "appel" && p.last_contacted_at && new Date(p.last_contacted_at).toDateString() === today).length;
  const stats = {
    contacted: all.filter((p) => p.contact_count > 0).length,
    clicked: all.filter((p) => progress.get(p.code)?.clicked).length,
    registered: all.filter((p) => progress.get(p.code)?.registered).length,
    completed: all.filter((p) => progress.get(p.code)?.completed).length,
  };

  return (
    <section className="screen prospection">
      <header className="screen-head">
        <h1>Prospection</h1>
        <p className="lead">
          Aujourd'hui : <strong className={sentToday >= DAILY_LIMIT ? "accent" : undefined}>{sentToday} / {DAILY_LIMIT}</strong> messages
        </p>
      </header>

      <SendingAdvice sentToday={sentToday} />

      <div className="stat-grid prospect-stats">
        <Stat value={stats.contacted} label="Contactés" />
        <Stat value={stats.clicked} label="Ont cliqué" />
        <Stat value={stats.registered} label="Inscrits" />
        <Stat value={stats.completed} label="Allés au bout" />
      </div>

      <AddProspect onAdded={(p) => (setProspects((list) => [p, ...(list ?? [])]), setFilter("todo"))} />

      <div className="tabs-inline" role="tablist">
        {([["todo", "À contacter"], ["followup", "À relancer"], ["ongoing", "En cours"], ["all", "Tous"]] as const).map(([f, label]) => (
          <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
            {label} <span className="count">{groups[f].length}</span>
          </button>
        ))}
      </div>

      {error && <p className="error">{error}</p>}
      {!prospects && !error && <p className="muted">Chargement…</p>}
      {prospects && groups[filter].length === 0 && (
        <p className="muted empty">
          {filter === "todo" ? "Personne à contacter. Ajoutez des artisans trouvés sur Google Maps ou Leboncoin."
            : filter === "followup" ? `Personne à relancer. Une relance est proposée ${FOLLOW_UP_AFTER_DAYS} jours après le premier message, si l'artisan ne s'est pas inscrit.`
            : "Aucun artisan ici pour l'instant."}
        </p>
      )}
      <ul className="list">
        {groups[filter].map((p) => (
          <ProspectRow key={p.id} p={p} progress={progress.get(p.code)} templates={templates} onChange={replace}
            onRemove={() => setProspects((list) => list?.filter((x) => x.id !== p.id) ?? null)} />
        ))}
      </ul>

      <button className="btn-ghost" onClick={() => setShowTemplates((v) => !v)}>{showTemplates ? "Fermer les messages" : "Modifier les messages"}</button>
      {showTemplates && <TemplateEditor templates={templates} onSave={(t) => (setTemplates(t), saveTemplates(t), setShowTemplates(false))} />}
    </section>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return <div className="stat"><span className="big-number">{value}</span><span className="muted small">{label}</span></div>;
}

/** Bonnes pratiques d'envoi : en semaine de 9 h à 19 h, pas plus de 50 messages par jour. */
function SendingAdvice({ sentToday }: { sentToday: number }) {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  if (sentToday >= DAILY_LIMIT) return <p className="important small">Objectif du jour atteint. Au-delà de {DAILY_LIMIT} messages par jour, vous risquez d'être signalé comme spam : reprenez demain.</p>;
  if (day === 0 || day === 6) return <p className="important small">C'est le week-end : envoyez plutôt en semaine, entre 9 h et 19 h. Les artisans répondent mieux et vous évitez les signalements.</p>;
  if (hour < 9 || hour >= 19) return <p className="important small">Il est {hour} h : envoyez plutôt entre 9 h et 19 h.</p>;
  return null;
}

function AddProspect({ onAdded }: { onAdded: (p: Prospect) => void }) {
  const empty = { business_name: "", first_name: "", phone: "" };
  const [f, setF] = useState(empty);
  // Métier, ville et source restent d'un artisan à l'autre : on saisit souvent une même recherche à la suite.
  const [trade, setTrade] = useState("");
  const [city, setCity] = useState("");
  const [source, setSource] = useState<ProspectSource>("google_maps");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const phone = toE164(f.phone);
    if (f.business_name.trim().length < 1) return setError("Indiquez le nom de l'entreprise.");
    if (!phone) return setError("Numéro invalide (ex. : 06 12 34 56 78).");
    setBusy(true);
    setError(null);
    try {
      const p = await prospectApi.add({
        business_name: f.business_name.trim().slice(0, 100), first_name: f.first_name.trim().slice(0, 50) || null,
        trade: trade || null, city: city.trim().slice(0, 60) || null, phone, source,
      });
      onAdded(p);
      setF(empty);
      first.current?.focus();
    } catch (err) {
      setError((err as { code?: string }).code === "23505" ? "Ce numéro est déjà dans votre liste." : "Ajout impossible. Vérifiez votre connexion.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return <button className="btn-primary" onClick={() => setOpen(true)}>Ajouter un artisan</button>;
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="panel stack" onSubmit={submit}>
      <div className="chips">
        {SOURCES.map((s) => (
          <label key={s.value} className={`chip${source === s.value ? " selected" : ""}`}>
            <input type="radio" name="source" checked={source === s.value} onChange={() => setSource(s.value)} />
            {s.label}
          </label>
        ))}
      </div>
      <label className="field">
        <span className="label">Entreprise</span>
        <input ref={first} type="text" autoFocus required value={f.business_name} onChange={set("business_name")} placeholder="Ex. : Durand Plomberie" />
      </label>
      <label className="field">
        <span className="label">Téléphone</span>
        <input type="tel" inputMode="tel" required value={f.phone} onChange={set("phone")} placeholder="06 12 34 56 78" />
      </label>
      <div className="field-row half">
        <label className="field">
          <span className="label">Prénom <span className="muted">(si connu)</span></span>
          <input type="text" value={f.first_name} onChange={set("first_name")} />
        </label>
        <label className="field">
          <span className="label">Ville</span>
          <input type="text" value={city} onChange={(e) => setCity(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span className="label">Métier</span>
        <select value={trade} onChange={(e) => setTrade(e.target.value)}>
          <option value="">Non précisé</option>
          {TRADES.map((t) => <option key={t}>{t}</option>)}
        </select>
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions-2">
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Fermer</button>
        <button className="btn-primary" disabled={busy}>{busy ? "Ajout…" : "Ajouter"}</button>
      </div>
    </form>
  );
}

function ProspectRow({ p, progress, templates, onChange, onRemove }: {
  p: Prospect; progress: Progress | undefined; templates: Templates; onChange: (p: Prospect) => void; onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const followUp = p.contact_count >= 1;
  const message = buildMessage(followUp ? templates.followUp : templates.first, p);
  const mobile = isMobile(p.phone);
  const blocked = p.status === "stop" || p.status === "pas_interesse";

  // Le lien ouvre l'appli (Messages, WhatsApp, Téléphone) ; on note le contact au même moment.
  const contacted = (channel: Channel) => {
    prospectApi.markContacted(p, channel).then(onChange, () => setError("Contact non enregistré. Vérifiez votre connexion."));
  };
  const status = (s: ProspectStatus) => {
    prospectApi.setStatus(p, s).then(onChange, () => setError("Statut non enregistré."));
  };
  async function remove() {
    if (!confirm(`Supprimer ${p.business_name} de la liste ?`)) return;
    try {
      await prospectApi.remove(p);
      onRemove();
    } catch {
      setError("Suppression impossible.");
    }
  }

  return (
    <li className="row prospect">
      <div className="row-top">
        <span className="row-title">{p.business_name}</span>
        <span className="row-time">{p.last_contacted_at ? relativeTime(p.last_contacted_at) : "Jamais contacté"}</span>
      </div>
      <div className="row-meta">
        <span className={`badge${p.status === "interesse" ? " badge-to_handle" : ""}`}>{STATUS_LABEL[p.status]}</span>
        {p.contact_count >= 2 && <span className="badge">Relancé</span>}
        {progress?.completed ? <span className="badge badge-best">Allé au bout</span>
          : progress?.registered ? <span className="badge badge-best">{progress.test_done ? "Essai fait" : "Inscrit"}</span>
          : progress?.clicked ? <span className="badge">A cliqué</span> : null}
        <span className="muted">{[p.first_name, p.trade, p.city].filter(Boolean).join(" · ")}</span>
      </div>
      <span className="muted small">{formatPhone(p.phone)}</span>

      {!blocked && (
        <>
          {expanded && <p className="message-preview small">{message}</p>}
          <div className="prospect-actions">
            {mobile ? (
              <>
                <a className="btn-primary" href={smsHref(p.phone, message)} onClick={() => contacted("sms")}>{followUp ? "Relancer par SMS" : "SMS"}</a>
                <a className="btn-secondary" href={whatsappHref(p.phone, message)} target="_blank" rel="noreferrer" onClick={() => contacted("whatsapp")}>WhatsApp</a>
              </>
            ) : (
              <p className="muted small">Numéro fixe : pas de SMS possible, appelez.</p>
            )}
            <a className="btn-secondary" href={`tel:${p.phone}`} onClick={() => contacted("appel")}>Appeler</a>
          </div>
        </>
      )}

      <div className="prospect-more">
        {!blocked && <button className="btn-ghost small" onClick={() => setExpanded((v) => !v)}>{expanded ? "Masquer le message" : "Voir le message"}</button>}
        {p.status !== "interesse" && !blocked && <button className="btn-ghost small" onClick={() => status("interesse")}>Intéressé</button>}
        {!blocked && <button className="btn-ghost small" onClick={() => status("pas_interesse")}>Pas intéressé</button>}
        {p.status !== "stop" && <button className="btn-ghost small" onClick={() => status("stop")}>A répondu STOP</button>}
        {blocked && <button className="btn-ghost small" onClick={() => status(p.contact_count > 0 ? "contacte" : "nouveau")}>Annuler</button>}
        <button className="btn-ghost small" onClick={remove}>Supprimer</button>
      </div>
      {error && <p className="error small">{error}</p>}
    </li>
  );
}

function TemplateEditor({ templates, onSave }: { templates: Templates; onSave: (t: Templates) => void }) {
  const [t, setT] = useState(templates);
  return (
    <div className="panel stack">
      <p className="small muted">
        Remplacés automatiquement : {"{bonjour}"} (« Bonjour Marc » ou « Bonjour »), {"{entreprise}"}, {"{source}"}, {"{ville}"}, {"{metier}"}, {"{lien}"}.
        Gardez toujours {"{lien}"} (suivi) et la mention STOP (obligatoire).
      </p>
      <label className="field">
        <span className="label">Premier message</span>
        <textarea value={t.first} onChange={(e) => setT({ ...t, first: e.target.value })} rows={6} />
      </label>
      <label className="field">
        <span className="label">Relance (3 jours après)</span>
        <textarea value={t.followUp} onChange={(e) => setT({ ...t, followUp: e.target.value })} rows={5} />
      </label>
      {(!t.first.includes("{lien}") || !t.followUp.includes("{lien}")) && <p className="error small">Il manque {"{lien}"} dans un message : vous ne pourrez pas suivre qui clique.</p>}
      {(!/STOP/.test(t.first) || !/STOP/.test(t.followUp)) && <p className="error small">Il manque la mention STOP dans un message : elle est obligatoire.</p>}
      <div className="actions-2">
        <button className="btn-secondary" onClick={() => setT(DEFAULT_TEMPLATES)}>Messages d'origine</button>
        <button className="btn-primary" onClick={() => onSave(t)}>Enregistrer</button>
      </div>
    </div>
  );
}
