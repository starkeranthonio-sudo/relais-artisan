import { fallbackSummary, type Photo, type RequestDetails, type Summarize, URGENCY_LABELS, type Urgency } from "./ai-summary.ts";
import { formatFrench } from "./phone.ts";
import type { SendSms } from "./twilio.ts";
import type { Artisan, Store } from "./types.ts";

export const MAX_PHOTOS = 3;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export const WORK_TYPES = [
  "Plomberie / fuite",
  "Chauffage / chaudière",
  "Électricité",
  "Serrurerie",
  "Toiture / couverture",
  "Menuiserie",
  "Peinture / plâtrerie",
  "Maçonnerie",
  "Carrelage / sol",
  "Climatisation",
  "Autre",
];

export interface FormLead {
  id: string;
  artisan: Artisan;
  client_phone: string;
  form_submitted_at: string | null;
}

export interface FormSubmission {
  clientName: string;
  workType: string;
  description: string;
  address: string;
  urgency: Urgency;
  photoPaths: string[];
}

/** Accès base de données propre à la page de demande (implémenté dans store.ts). */
export interface FormStore {
  findLeadByToken(token: string): Promise<FormLead | null>;
  uploadPhoto(path: string, photo: Photo): Promise<void>;
  /** Enregistre la demande. Renvoie false si elle avait déjà été envoyée (double clic, deux onglets…). */
  saveSubmission(leadId: string, submission: FormSubmission, at: Date): Promise<boolean>;
  saveAiSummary(leadId: string, summary: string): Promise<void>;
}

export interface FormDeps {
  store: Store;
  formStore: FormStore;
  sendSms: SendSms;
  summarize: Summarize;
  appUrl: string;
  now?: () => Date;
}

export interface FormResult {
  status: number;
  body: Record<string, unknown>;
  afterResponse?: () => Promise<void>;
}

/** GET : infos affichées en haut de la page (jamais le numéro du client ni de l'artisan). */
export async function getRequestForm(token: string, formStore: FormStore): Promise<FormResult> {
  const lead = await formStore.findLeadByToken(token);
  if (!lead) return { status: 404, body: { error: "Lien invalide ou expiré." } };
  return {
    status: 200,
    body: { businessName: lead.artisan.business_name, submitted: lead.form_submitted_at !== null, workTypes: WORK_TYPES },
  };
}

export interface RawSubmission {
  token: string;
  clientName: string;
  workType: string;
  description: string;
  address: string;
  urgency: string;
  photos: Photo[];
}

export function validate(raw: RawSubmission): string | null {
  if (!raw.workType.trim()) return "Choisissez le type de travaux.";
  if (raw.description.trim().length < 5) return "Décrivez votre besoin en quelques mots.";
  if (raw.description.length > 2000) return "Description trop longue (2000 caractères maximum).";
  if (raw.address.trim().length < 3) return "Indiquez l'adresse ou la ville de l'intervention.";
  if (!(raw.urgency in URGENCY_LABELS)) return "Indiquez l'urgence.";
  if (raw.photos.length > MAX_PHOTOS) return `${MAX_PHOTOS} photos maximum.`;
  for (const p of raw.photos) {
    if (!PHOTO_TYPES.has(p.mediaType)) return "Format de photo non accepté (JPEG, PNG ou WebP).";
    if (p.bytes.length > MAX_PHOTO_BYTES) return "Photo trop lourde (5 Mo maximum).";
  }
  return null;
}

/** Le client envoie sa demande : on l'enregistre, puis (après la réponse) résumé IA + SMS à l'artisan. */
export async function submitRequestForm(raw: RawSubmission, deps: FormDeps): Promise<FormResult> {
  const error = validate(raw);
  if (error) return { status: 400, body: { error } };

  const lead = await deps.formStore.findLeadByToken(raw.token);
  if (!lead) return { status: 404, body: { error: "Lien invalide ou expiré." } };
  if (lead.form_submitted_at) return { status: 409, body: { error: "Votre demande a déjà été envoyée." } };

  const photoPaths: string[] = [];
  for (const [i, photo] of raw.photos.entries()) {
    const path = `${lead.id}/${i + 1}.${photo.mediaType.split("/")[1]}`;
    await deps.formStore.uploadPhoto(path, photo);
    photoPaths.push(path);
  }

  const submission: FormSubmission = {
    clientName: raw.clientName.trim().slice(0, 100),
    workType: raw.workType.trim().slice(0, 100),
    description: raw.description.trim(),
    address: raw.address.trim().slice(0, 300),
    urgency: raw.urgency as Urgency,
    photoPaths,
  };
  const now = (deps.now ?? (() => new Date()))();
  if (!(await deps.formStore.saveSubmission(lead.id, submission, now))) {
    return { status: 409, body: { error: "Votre demande a déjà été envoyée." } };
  }

  return {
    status: 200,
    body: { ok: true, businessName: lead.artisan.business_name },
    afterResponse: () => notifyArtisan(lead, raw.token, submission, raw.photos, deps),
  };
}

async function notifyArtisan(lead: FormLead, token: string, s: FormSubmission, photos: Photo[], deps: FormDeps): Promise<void> {
  const details: RequestDetails = { workType: s.workType, description: s.description, urgency: s.urgency, photoCount: photos.length };
  let summary: string;
  try {
    summary = await deps.summarize(details, photos);
  } catch (err) {
    console.error("Résumé IA indisponible, résumé de secours utilisé", { leadId: lead.id, err: String(err) });
    summary = fallbackSummary(details);
  }
  await deps.formStore.saveAiSummary(lead.id, summary);

  // Lien court /app/l/<jeton> : moins de caractères dans le SMS, et l'ouverture est comptée « depuis un SMS ».
  const body = artisanSmsBody(lead, s, summary, `${deps.appUrl.replace(/\/$/, "")}/app/l/${token}`);
  try {
    const { sid } = await deps.sendSms(lead.artisan.relay_number, lead.artisan.owner_phone, body);
    await deps.store.insertMessage({ artisanId: lead.artisan.id, leadId: lead.id, direction: "outbound_artisan", body, twilioSid: sid });
  } catch (err) {
    console.error("Échec SMS artisan (nouvelle demande)", { leadId: lead.id, err: String(err) });
  }
}

export function artisanSmsBody(lead: FormLead, s: FormSubmission, summary: string, link: string): string {
  const who = [s.clientName, formatFrench(lead.client_phone)].filter(Boolean).join(" ");
  const photos = s.photoPaths.length ? `${s.photoPaths.length} photo${s.photoPaths.length > 1 ? "s" : ""} : ` : "Détails : ";
  return [
    `Nouvelle demande - ${who}`,
    `${URGENCY_LABELS[s.urgency]} - ${s.address}`,
    summary,
    photos + link,
  ].join("\n");
}
