// Webhook Twilio « A message comes in » du numéro relais.
// Configuration Twilio : Messaging → A message comes in → Webhook (HTTP POST) → https://<projet>.supabase.co/functions/v1/twilio-sms
import { handleIncomingSms } from "../_shared/incoming-sms.ts";
import { requireEnv, serviceClient, supabaseStore } from "../_shared/store.ts";
import { emptyTwiml, isValidTwilioSignature, publicFunctionUrl, readTwilioParams, twilioSender } from "../_shared/twilio.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const authToken = requireEnv("TWILIO_AUTH_TOKEN");
const store = supabaseStore(serviceClient());
const sendSms = twilioSender(requireEnv("TWILIO_ACCOUNT_SID"), authToken, Deno.env.get("SMS_SENDER_ID"));

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const params = await readTwilioParams(req);
  const url = publicFunctionUrl(req, "twilio-sms", requireEnv("SUPABASE_URL"));
  if (!(await isValidTwilioSignature(authToken, req.headers.get("X-Twilio-Signature"), url, params))) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const afterResponse = await handleIncomingSms(params, { store, sendSms });
    if (afterResponse) EdgeRuntime.waitUntil(afterResponse());
  } catch (err) {
    console.error("twilio-sms", err);
  }
  return emptyTwiml();
});
