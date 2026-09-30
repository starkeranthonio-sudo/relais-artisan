import { formatFrench } from "./phone.ts";
import type { SendSms } from "./twilio.ts";
import type { Store } from "./types.ts";

const STOP_WORDS = new Set(["STOP", "ARRET", "ARRÊT", "STOP SMS", "DESABONNER", "DÉSABONNER", "UNSUBSCRIBE"]);

export function isStopRequest(body: string): boolean {
  return STOP_WORDS.has(body.trim().toUpperCase());
}

export interface SmsDeps {
  store: Store;
  sendSms: SendSms;
  now?: () => Date;
}

/**
 * Le client répond au SMS sur le numéro relais : on l'enregistre (ce qui stoppera les relances de devis à l'étape 3)
 * et on transfère le message sur le portable de l'artisan. Renvoie le travail à faire après la réponse à Twilio.
 */
export async function handleIncomingSms(
  params: Record<string, string>,
  deps: SmsDeps,
): Promise<(() => Promise<void>) | undefined> {
  const { store } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const from = params.From ?? "";
  const body = (params.Body ?? "").trim();

  const artisan = await store.findArtisanByRelay(params.To);
  if (!artisan) return undefined;
  // L'artisan qui écrit à son propre numéro relais : ignoré en V1 (évite une boucle de transfert).
  if (from === artisan.owner_phone) return undefined;

  const lead = await store.findLatestLead(artisan.id, from);
  const optedOut = isStopRequest(body);

  await store.insertMessage({ artisanId: artisan.id, leadId: lead?.id ?? null, direction: "inbound_client", body, twilioSid: params.MessageSid });
  if (lead) await store.markReplied(lead.id, now, optedOut);

  const forward = optedOut
    ? `${formatFrench(from)} a répondu STOP : il ne recevra plus de SMS automatiques.`
    : `SMS de ${formatFrench(from)} : ${body}`;

  return async () => {
    try {
      const { sid } = await deps.sendSms(artisan.relay_number, artisan.owner_phone, forward);
      await store.insertMessage({ artisanId: artisan.id, leadId: lead?.id ?? null, direction: "outbound_artisan", body: forward, twilioSid: sid });
    } catch (err) {
      console.error("Échec transfert SMS à l'artisan", { from, err: String(err) });
    }
  };
}
