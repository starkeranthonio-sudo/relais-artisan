// SMS récapitulatif de 18 h. Appelée toutes les 15 minutes en fin de journée par pg_cron
// (voir migration 20261008400000_daily_recap.sql), authentifiée par le secret partagé x-cron-secret.
import { runRecap } from "../_shared/recap.ts";
import { requireEnv, serviceClient, supabaseRecapStore } from "../_shared/store.ts";
import { twilioSender } from "../_shared/twilio.ts";

const cronSecret = requireEnv("CRON_SECRET");
const deps = {
  store: supabaseRecapStore(serviceClient()),
  sendSms: twilioSender(requireEnv("TWILIO_ACCOUNT_SID"), requireEnv("TWILIO_AUTH_TOKEN"), Deno.env.get("SMS_SENDER_ID")),
  appUrl: requireEnv("PUBLIC_APP_URL"),
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (req.headers.get("x-cron-secret") !== cronSecret) return new Response("Forbidden", { status: 403 });
  try {
    const report = await runRecap(deps);
    if (report.sent || report.skippedEmpty) console.log("daily-recap", report);
    return Response.json(report);
  } catch (err) {
    console.error("daily-recap", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
});
