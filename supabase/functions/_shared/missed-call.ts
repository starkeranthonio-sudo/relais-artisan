import { isHiddenCaller } from "./phone.ts";
import { type SendSms, toGsm7 } from "./twilio.ts";
import type { Store } from "./types.ts";

/** Une demande reste « ouverte » 7 jours : un client qui rappelle pendant ce délai ne crée pas de nouvelle demande. */
const LEAD_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** On n'envoie pas plus d'un SMS par client toutes les 24 h, même s'il rappelle plusieurs fois. */
const SMS_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface Deps {
  store: Store;
  sendSms: SendSms;
  appUrl: string; // ex. https://relais-artisan.fr — le lien du SMS pointe vers {appUrl}/d/{token}
  now?: () => Date;
  newToken?: () => string;
}

export interface CallResult {
  /** Phrase lue au client avant de raccrocher. */
  speech: string;
  /** Travail à faire après avoir répondu à Twilio (envoi du SMS), pour ne pas faire attendre l'appelant. */
  afterResponse?: () => Promise<void>;
}

export const DEFAULT_CLIENT_SMS = "{nom} : désolé d'avoir manqué votre appel. Décrivez votre besoin ici, je vous rappelle vite : {lien}";

/**
 * SMS envoyé au client après un appel manqué. L'artisan peut écrire le sien ({nom}, {lien}) ;
 * on revient au texte par défaut si le sien n'a pas de {lien} ou dépasse 1 SMS (160 caractères après conversion GSM-7).
 */
export function clientSmsBody(businessName: string, link: string, template?: string | null): string {
  const render = (t: string) => t.replaceAll("{nom}", businessName).replaceAll("{lien}", link).trim();
  if (template && template.includes("{lien}")) {
    const custom = render(template);
    if (toGsm7(custom).length <= 160) return custom;
  }
  return render(DEFAULT_CLIENT_SMS);
}

/**
 * Cœur de l'étape 1. Tout appel qui arrive sur un numéro relais est un appel que l'artisan n'a pas pris
 * (renvoi **61*). On annonce au client qu'il va recevoir un SMS, on raccroche, puis on envoie le SMS.
 */
export async function handleIncomingCall(params: Record<string, string>, deps: Deps): Promise<CallResult> {
  const { store } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const callSid = params.CallSid;
  const to = params.To;
  const from = params.From ?? "";

  const artisan = await store.findArtisanByRelay(to);
  if (!artisan) {
    await store.claimCall({ callSid, artisanId: null, from, to, outcome: "unknown_relay" });
    return { speech: "Bonjour. Ce numéro n'est pas attribué. Au revoir." };
  }

  const greeting = `Bonjour, vous êtes bien chez ${artisan.business_name}.`;

  if (isHiddenCaller(from)) {
    await store.claimCall({ callSid, artisanId: artisan.id, from, to, outcome: "caller_hidden" });
    return {
      speech: `${greeting} Nous ne pouvons pas répondre pour le moment, et votre numéro est masqué. ` +
        `Merci de rappeler en affichant votre numéro pour que nous puissions vous recontacter.`,
    };
  }

  const standardSpeech = `${greeting} Nous ne pouvons pas vous répondre pour le moment. ` +
    `Vous allez recevoir un SMS pour nous décrire votre besoin. À très vite.`;

  if (!(await store.claimCall({ callSid, artisanId: artisan.id, from, to, outcome: "pending" }))) {
    return { speech: standardSpeech }; // webhook déjà traité : on ne renvoie pas un second SMS
  }

  let lead = await store.findOpenLead(artisan.id, from, new Date(now.getTime() - LEAD_WINDOW_MS));
  if (lead) {
    await store.recordRepeatCall(lead.id, lead.call_count + 1, now);
    if (lead.sms_sent_at && now.getTime() - new Date(lead.sms_sent_at).getTime() < SMS_COOLDOWN_MS) {
      await store.setCallOutcome(callSid, "sms_skipped_recent", lead.id);
      return {
        speech: `${greeting} Nous ne pouvons pas vous répondre pour le moment. ` +
          `Nous avons bien noté votre appel et vous avons envoyé un SMS pour décrire votre besoin. À très vite.`,
      };
    }
  } else {
    lead = await store.createLead({
      artisanId: artisan.id,
      clientPhone: from,
      publicToken: (deps.newToken ?? randomToken)(),
    });
  }

  const leadId = lead.id;
  const body = clientSmsBody(artisan.business_name, `${deps.appUrl.replace(/\/$/, "")}/d/${lead.public_token}`, artisan.client_sms_template);

  return {
    speech: standardSpeech,
    afterResponse: async () => {
      try {
        const { sid } = await deps.sendSms(artisan.relay_number, from, body, artisan.sms_sender);
        await store.markSmsSent(leadId, now);
        await store.insertMessage({ artisanId: artisan.id, leadId, direction: "outbound_client", body, twilioSid: sid });
        await store.setCallOutcome(callSid, "sms_sent", leadId);
      } catch (err) {
        console.error("Échec envoi SMS client", { callSid, err: String(err) });
        await store.setCallOutcome(callSid, "sms_failed", leadId);
      }
    },
  };
}

const TOKEN_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans caractères ambigus (0/O, 1/l/I)

export function randomToken(length = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => TOKEN_ALPHABET[b % TOKEN_ALPHABET.length]).join("");
}
