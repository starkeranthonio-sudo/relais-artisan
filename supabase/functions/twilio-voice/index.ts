// Webhook Twilio « A call comes in » du numéro relais.
// Configuration Twilio : Voice → A call comes in → Webhook (HTTP POST) → https://<projet>.supabase.co/functions/v1/twilio-voice
import { handleIncomingCall } from "../_shared/missed-call.ts";
import { requireEnv, serviceClient, supabaseStore } from "../_shared/store.ts";
import { isValidTwilioSignature, publicFunctionUrl, readTwilioParams, sayAndHangup, twilioSender } from "../_shared/twilio.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const accountSid = requireEnv("TWILIO_ACCOUNT_SID");
const authToken = requireEnv("TWILIO_AUTH_TOKEN");
const appUrl = requireEnv("PUBLIC_APP_URL");
const store = supabaseStore(serviceClient());
const sendSms = twilioSender(accountSid, authToken, Deno.env.get("SMS_SENDER_ID"));

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const params = await readTwilioParams(req);
  const url = publicFunctionUrl(req, "twilio-voice", requireEnv("SUPABASE_URL"));
  if (!(await isValidTwilioSignature(authToken, req.headers.get("X-Twilio-Signature"), url, params))) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const result = await handleIncomingCall(params, { store, sendSms, appUrl });
    if (result.afterResponse) EdgeRuntime.waitUntil(result.afterResponse());
    return sayAndHangup(result.speech);
  } catch (err) {
    console.error("twilio-voice", err);
    // Même en cas de panne, le client entend un message plutôt qu'une erreur Twilio.
    return sayAndHangup("Bonjour, nous ne pouvons pas vous répondre pour le moment. Merci de rappeler plus tard.");
  }
});
