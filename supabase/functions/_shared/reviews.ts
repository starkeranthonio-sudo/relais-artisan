import { type SendSms, toGsm7 } from "./twilio.ts";

/**
 * Demande d'avis Google, déclenchée par l'artisan quand le chantier est terminé (pas au moment du devis signé :
 * un avis demandé avant la fin des travaux risque d'être mauvais). Une seule demande par client.
 * Conforme aux règles Google : on demande à tous les clients, sans contrepartie ni tri préalable.
 */

export interface ReviewArtisan {
  id: string;
  business_name: string;
  relay_number: string | null;
  sms_sender?: string;
  google_review_url: string | null;
}

export interface ReviewLead {
  id: string;
  artisan_id: string;
  client_phone: string;
  client_name: string | null;
  opted_out: boolean;
  review_requested_at: string | null;
  quote_status: "pending" | "won" | "lost" | null;
}

export interface ReviewStore {
  getLead(leadId: string): Promise<ReviewLead | null>;
  /** Marque la demande d'avis comme envoyée, de façon atomique. false si déjà envoyée. */
  markRequested(leadId: string, at: Date): Promise<boolean>;
  /** Annule le marquage si l'envoi du SMS échoue. */
  unmarkRequested(leadId: string): Promise<void>;
}

export interface ReviewDeps {
  store: ReviewStore;
  sendSms: SendSms;
  now?: () => Date;
}

export type ReviewResult = { ok: true } | { ok: false; status: number; error: string };

export function reviewSms(businessName: string, clientName: string | null, url: string): string {
  const hello = clientName?.trim() ? `Bonjour ${clientName.trim().split(/\s+/)[0]}, ` : "Bonjour, ";
  const full = `${hello}${businessName} vous remercie pour votre confiance. Votre avis nous aide beaucoup : ${url}`;
  if (toGsm7(full).length <= 160) return full;
  return `${businessName} vous remercie ! Votre avis nous aide beaucoup : ${url}`;
}

export async function requestReview(artisan: ReviewArtisan, leadId: string, deps: ReviewDeps): Promise<ReviewResult> {
  if (!artisan.google_review_url) {
    return { ok: false, status: 400, error: "Ajoutez d'abord votre lien d'avis Google dans les Réglages." };
  }
  const lead = await deps.store.getLead(leadId);
  if (!lead || lead.artisan_id !== artisan.id) return { ok: false, status: 404, error: "Demande introuvable." };
  if (lead.quote_status !== "won") return { ok: false, status: 409, error: "Disponible une fois le devis gagné." };
  if (lead.opted_out) return { ok: false, status: 409, error: "Ce client a demandé à ne plus recevoir de SMS." };
  if (lead.review_requested_at) return { ok: false, status: 409, error: "Avis déjà demandé à ce client." };

  const now = (deps.now ?? (() => new Date()))();
  if (!(await deps.store.markRequested(lead.id, now))) return { ok: false, status: 409, error: "Avis déjà demandé à ce client." };
  try {
    await deps.sendSms(
      artisan.relay_number ?? "",
      lead.client_phone,
      reviewSms(artisan.business_name, lead.client_name, artisan.google_review_url),
      artisan.sms_sender,
    );
  } catch (err) {
    console.error("Échec SMS demande d'avis", { leadId, err: String(err) });
    await deps.store.unmarkRequested(lead.id);
    return { ok: false, status: 502, error: "Envoi du SMS impossible. Réessayez dans un instant." };
  }
  return { ok: true };
}
