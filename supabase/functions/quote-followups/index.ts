// Relances de devis. Appelée toutes les 15 minutes par pg_cron (voir migration 20261002000000_quotes.sql),
// authentifiée par un secret partagé (en-tête x-cron-secret) stocké dans Vault et dans les secrets des fonctions.
import { runFollowups } from "../_shared/followups.ts";
import { requireEnv, serviceClient, supabaseFollowupStore, supabaseStore } from "../_shared/store.ts";
import { twilioSender } from "../_shared/twilio.ts";

const cronSecret = requireEnv("CRON_SECRET");
const client = serviceClient();
const deps = {
  store: supabaseStore(client),
  followups: supabaseFollowupStore(client),
  sendSms: twilioSender(requireEnv("TWILIO_ACCOUNT_SID"), requireEnv("TWILIO_AUTH_TOKEN"), Deno.env.get("SMS_SENDER_ID")),
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (req.headers.get("x-cron-secret") !== cronSecret) return new Response("Forbidden", { status: 403 });

  try {
    const report = await runFollowups(deps);
    if (report.sent || report.stopped || report.failed) console.log("quote-followups", report);
    return Response.json(report);
  } catch (err) {
    console.error("quote-followups", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
});
