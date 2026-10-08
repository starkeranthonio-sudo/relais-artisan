// Bilan du mois par SMS (le 1er à 9 h). Appelée par pg_cron (migration 20261008500000_monthly_report.sql),
// authentifiée par le secret partagé x-cron-secret.
import { runMonthly } from "../_shared/monthly.ts";
import { requireEnv, serviceClient, supabaseMonthlyStore } from "../_shared/store.ts";
import { twilioSender } from "../_shared/twilio.ts";

const cronSecret = requireEnv("CRON_SECRET");
const deps = {
  store: supabaseMonthlyStore(serviceClient()),
  sendSms: twilioSender(requireEnv("TWILIO_ACCOUNT_SID"), requireEnv("TWILIO_AUTH_TOKEN"), Deno.env.get("SMS_SENDER_ID")),
  appUrl: requireEnv("PUBLIC_APP_URL"),
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (req.headers.get("x-cron-secret") !== cronSecret) return new Response("Forbidden", { status: 403 });
  try {
    const report = await runMonthly(deps);
    if (report.sent || report.skippedEmpty) console.log("monthly-report", report);
    return Response.json(report);
  } catch (err) {
    console.error("monthly-report", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
});
