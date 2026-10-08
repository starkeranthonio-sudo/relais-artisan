import { randomToken } from "./missed-call.ts";
import { toE164 } from "./phone.ts";
import type { SendSms } from "./twilio.ts";

/**
 * Transmission d'une demande à un confrère (moteur de partage).
 * Le confrère reçoit un SMS ; s'il n'est pas inscrit, il doit créer son compte pour voir le client.
 * Les coordonnées du client ne sont visibles qu'après acceptation, et le client est prévenu.
 */

export const TRANSFER_TTL_DAYS = 7;

export interface TransferArtisan {
  id: string;
  business_name: string;
  owner_phone: string;
  relay_number: string | null;
  sms_sender?: string;
  referred_by: string | null;
  created_at: string;
}

export interface TransferLead {
  id: string;
  artisan_id: string;
  client_phone: string;
  work_type: string | null;
  address: string | null;
  urgency: "urgent" | "week" | "flexible" | null;
  ai_summary: string | null;
  status: string;
  has_quote: boolean;
}

export interface Transfer {
  id: string;
  token: string;
  status: "pending" | "accepted" | "declined" | "expired";
  note: string | null;
  created_at: string;
  expires_at: string;
  to_artisan_id: string | null;
  from: TransferArtisan;
  lead: TransferLead;
}

export interface TransferStore {
  getLead(leadId: string): Promise<TransferLead | null>;
  findArtisanByPhone(phone: string): Promise<TransferArtisan | null>;
  hasPendingTransfer(leadId: string): Promise<boolean>;
  createTransfer(t: { leadId: string; fromArtisanId: string; toPhone: string; token: string; note: string | null; inviteeWasMember: boolean; expiresAt: Date }): Promise<void>;
  getTransfer(token: string): Promise<Transfer | null>;
  /** Passe la transmission à « acceptée » et confie la demande au confrère, de façon atomique. false si déjà traitée. */
  accept(transferId: string, toArtisanId: string, at: Date): Promise<boolean>;
  decline(transferId: string, toArtisanId: string, at: Date): Promise<boolean>;
  setReferrer(artisanId: string, referrerId: string): Promise<void>;
}

export interface TransferDeps {
  store: TransferStore;
  sendSms: SendSms;
  appUrl: string;
  now?: () => Date;
  newToken?: () => string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string) => ({ ok: false as const, status, error });

/** "12 Rue de la Forêt 78140 Vélizy-Villacoublay" → "Vélizy-Villacoublay" (jamais l'adresse exacte avant acceptation). */
export function cityOf(address: string | null): string {
  if (!address) return "";
  const m = /\b\d{5}\s+(.+)$/.exec(address.trim());
  if (m) return m[1].trim();
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

function teaser(lead: TransferLead): string {
  return [lead.work_type ?? "Demande", cityOf(lead.address)].filter(Boolean).join(" - ");
}

const linkFor = (appUrl: string, token: string) => `${appUrl.replace(/\/$/, "")}/t/${token}`;

export function invitationSms(fromName: string, lead: TransferLead, link: string, isMember: boolean): string {
  return isMember
    ? `${fromName} vous envoie un client : ${teaser(lead)}. Voir la demande : ${link}`
    : `${fromName} vous envoie un client : ${teaser(lead)}. Compte gratuit pour le contacter : ${link}`;
}

/** L'artisan A transmet sa demande à un confrère (identifié par son portable). */
export async function createTransfer(
  input: { from: TransferArtisan; leadId: string; phone: string; note?: string },
  deps: TransferDeps,
): Promise<Result<{ token: string; inviteeWasMember: boolean }>> {
  const toPhone = toE164(input.phone.trim());
  if (!/^\+33[67]\d{8}$/.test(toPhone)) return fail(400, "Numéro de portable invalide (ex. : 06 12 34 56 78).");
  if (toPhone === input.from.owner_phone) return fail(400, "C'est votre propre numéro.");

  const lead = await deps.store.getLead(input.leadId);
  if (!lead || lead.artisan_id !== input.from.id) return fail(404, "Demande introuvable.");
  if (lead.status === "closed" || lead.has_quote) return fail(409, "Cette demande est déjà traitée ou a un devis.");
  if (await deps.store.hasPendingTransfer(lead.id)) return fail(409, "Cette demande est déjà en cours de transmission.");

  const invitee = await deps.store.findArtisanByPhone(toPhone);
  const now = (deps.now ?? (() => new Date()))();
  const token = (deps.newToken ?? (() => randomToken(10)))();
  const note = input.note?.trim().slice(0, 300) || null;
  await deps.store.createTransfer({
    leadId: lead.id, fromArtisanId: input.from.id, toPhone, token, note,
    inviteeWasMember: invitee !== null,
    expiresAt: new Date(now.getTime() + TRANSFER_TTL_DAYS * 86_400_000),
  });

  try {
    await deps.sendSms(input.from.relay_number ?? "", toPhone, invitationSms(input.from.business_name, lead, linkFor(deps.appUrl, token), invitee !== null), input.from.sms_sender);
  } catch (err) {
    console.error("Échec SMS d'invitation", { leadId: lead.id, err: String(err) });
  }
  return { ok: true, value: { token, inviteeWasMember: invitee !== null } };
}

export interface TransferPreview {
  status: Transfer["status"];
  fromName: string;
  workType: string | null;
  city: string;
  urgency: TransferLead["urgency"];
  summary: string | null;
  note: string | null;
  /** Renseigné seulement pour le confrère qui a accepté : il peut ouvrir la fiche complète. */
  leadId: string | null;
  isSender: boolean;
}

/** Aperçu public (sans coordonnées du client). */
export async function previewTransfer(token: string, viewer: TransferArtisan | null, deps: TransferDeps): Promise<Result<TransferPreview>> {
  const t = await deps.store.getTransfer(token);
  if (!t) return fail(404, "Lien invalide.");
  const now = (deps.now ?? (() => new Date()))();
  const status = t.status === "pending" && new Date(t.expires_at) < now ? "expired" : t.status;
  return {
    ok: true,
    value: {
      status,
      fromName: t.from.business_name,
      workType: t.lead.work_type,
      city: cityOf(t.lead.address),
      urgency: t.lead.urgency,
      summary: t.lead.ai_summary,
      note: t.note,
      leadId: status === "accepted" && viewer && viewer.id === t.to_artisan_id ? t.lead.id : null,
      isSender: viewer?.id === t.from.id,
    },
  };
}

/** Le confrère accepte : la demande lui est confiée, le parrainage est enregistré, A et le client sont prévenus. */
export async function acceptTransfer(token: string, viewer: TransferArtisan, deps: TransferDeps): Promise<Result<{ leadId: string }>> {
  const t = await deps.store.getTransfer(token);
  if (!t) return fail(404, "Lien invalide.");
  if (t.from.id === viewer.id) return fail(400, "Vous ne pouvez pas accepter votre propre transmission.");
  const now = (deps.now ?? (() => new Date()))();
  if (t.status === "accepted" && t.to_artisan_id === viewer.id) return { ok: true, value: { leadId: t.lead.id } };
  if (t.status !== "pending") return fail(409, "Ce client a déjà été pris en charge.");
  if (new Date(t.expires_at) < now) return fail(410, "Cette transmission a expiré.");
  if (!(await deps.store.accept(t.id, viewer.id, now))) return fail(409, "Ce client a déjà été pris en charge.");

  // Parrainage : le confrère s'est inscrit grâce à cette transmission.
  if (!viewer.referred_by && new Date(viewer.created_at) >= new Date(t.created_at)) {
    await deps.store.setReferrer(viewer.id, t.from.id);
  }

  const relay = t.from.relay_number ?? "";
  // L'artisan d'origine est prévenu par « RelaisArti » ; le client, au nom de l'artisan qu'il avait appelé.
  const notifications: [string, string, string | undefined][] = [
    [t.from.owner_phone, `${viewer.business_name} a accepté le client que vous lui avez transmis (${teaser(t.lead)}). Merci !`, undefined],
    [t.lead.client_phone, `${t.from.business_name} ne peut pas intervenir et vous met en relation avec ${viewer.business_name}, qui va vous recontacter rapidement.`, t.from.sms_sender],
  ];
  for (const [to, body, senderName] of notifications) {
    try {
      await deps.sendSms(relay, to, body, senderName);
    } catch (err) {
      console.error("Échec SMS après acceptation", { transferId: t.id, err: String(err) });
    }
  }
  return { ok: true, value: { leadId: t.lead.id } };
}

export async function declineTransfer(token: string, viewer: TransferArtisan, deps: TransferDeps): Promise<Result<null>> {
  const t = await deps.store.getTransfer(token);
  if (!t) return fail(404, "Lien invalide.");
  if (t.status !== "pending") return fail(409, "Cette transmission n'est plus en attente.");
  const now = (deps.now ?? (() => new Date()))();
  if (!(await deps.store.decline(t.id, viewer.id, now))) return fail(409, "Cette transmission n'est plus en attente.");
  try {
    await deps.sendSms(t.from.relay_number ?? "", t.from.owner_phone, `${viewer.business_name} ne peut pas prendre le client transmis (${teaser(t.lead)}). Il reste dans vos demandes.`);
  } catch (err) {
    console.error("Échec SMS refus", { transferId: t.id, err: String(err) });
  }
  return { ok: true, value: null };
}
