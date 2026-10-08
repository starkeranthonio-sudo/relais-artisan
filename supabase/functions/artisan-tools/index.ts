// Outils de l'artisan connecté (programme testeurs fondateurs) :
//   POST { action: "test_drive" }              → simule un appel manqué sur son propre portable
//   POST { action: "verify_siret", siret }     → vérifie le SIRET dans la base Sirene (pour que ses parrainages comptent)
import { requireEnv, serviceClient, supabaseTesterStore, testerFromRequest } from "../_shared/store.ts";
import { startTestDrive, verifySiret } from "../_shared/testers.ts";
import { twilioSender } from "../_shared/twilio.ts";

const client = serviceClient();
const deps = {
  store: supabaseTesterStore(client),
  sendSms: twilioSender(requireEnv("TWILIO_ACCOUNT_SID"), requireEnv("TWILIO_AUTH_TOKEN"), Deno.env.get("SMS_SENDER_ID")),
  appUrl: requireEnv("PUBLIC_APP_URL"),
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
    const artisan = await testerFromRequest(client, req);
    if (!artisan) return json(401, { error: "Connectez-vous pour continuer." });
    const body = await req.json().catch(() => ({}));
    const result = body.action === "test_drive"
      ? await startTestDrive(artisan, deps)
      : body.action === "verify_siret"
      ? await verifySiret(artisan, String(body.siret ?? ""), deps)
      : { ok: false as const, status: 400, error: "Action inconnue." };
    return result.ok ? json(200, result.value ?? {}) : json(result.status, { error: result.error });
  } catch (err) {
    console.error("artisan-tools", err);
    return json(500, { error: "Une erreur est survenue. Réessayez." });
  }
});
