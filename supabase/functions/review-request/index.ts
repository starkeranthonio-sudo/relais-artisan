// Demande d'avis Google : POST { leadId } par l'artisan connecté, une fois le chantier terminé.
import { requestReview } from "../_shared/reviews.ts";
import { requireEnv, reviewArtisanFromRequest, serviceClient, supabaseReviewStore } from "../_shared/store.ts";
import { twilioSender } from "../_shared/twilio.ts";

const client = serviceClient();
const deps = {
  store: supabaseReviewStore(client),
  sendSms: twilioSender(requireEnv("TWILIO_ACCOUNT_SID"), requireEnv("TWILIO_AUTH_TOKEN"), Deno.env.get("SMS_SENDER_ID")),
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Méthode non autorisée." });
  try {
    const artisan = await reviewArtisanFromRequest(client, req);
    if (!artisan) return json(401, { error: "Connectez-vous pour continuer." });
    const { leadId } = await req.json().catch(() => ({}));
    const result = await requestReview(artisan, String(leadId ?? ""), deps);
    return result.ok ? json(200, { ok: true }) : json(result.status, { error: result.error });
  } catch (err) {
    console.error("review-request", err);
    return json(500, { error: "Une erreur est survenue. Réessayez." });
  }
});
