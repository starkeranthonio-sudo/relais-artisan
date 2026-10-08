// Transmission d'une demande à un confrère.
//   GET  ?t=<token>                         → aperçu public (sans coordonnées du client)
//   POST { action: "create", leadId, phone, note? }  → artisan connecté : transmet sa demande
//   POST { action: "accept" | "decline", token }      → artisan connecté : prend ou refuse le client
import { requireEnv, artisanFromRequest, serviceClient, supabaseTransferStore } from "../_shared/store.ts";
import { acceptTransfer, createTransfer, declineTransfer, previewTransfer, type Result } from "../_shared/transfers.ts";
import { twilioSender } from "../_shared/twilio.ts";

const client = serviceClient();
const deps = {
  store: supabaseTransferStore(client),
  sendSms: twilioSender(requireEnv("TWILIO_ACCOUNT_SID"), requireEnv("TWILIO_AUTH_TOKEN"), Deno.env.get("SMS_SENDER_ID")),
  appUrl: requireEnv("PUBLIC_APP_URL"),
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
};

function json(result: Result<unknown>): Response {
  const [status, body] = result.ok ? [200, result.value ?? {}] : [result.status, { error: result.error }];
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const unauthorized = { ok: false as const, status: 401, error: "Connectez-vous pour continuer." };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const viewer = await artisanFromRequest(client, req);

    if (req.method === "GET") {
      return json(await previewTransfer(new URL(req.url).searchParams.get("t") ?? "", viewer, deps));
    }
    if (req.method !== "POST") return json({ ok: false, status: 405, error: "Méthode non autorisée." });

    const body = await req.json().catch(() => ({}));
    if (!viewer) return json(unauthorized);
    switch (body.action) {
      case "create":
        return json(await createTransfer({ from: viewer, leadId: String(body.leadId ?? ""), phone: String(body.phone ?? ""), note: body.note }, deps));
      case "accept":
        return json(await acceptTransfer(String(body.token ?? ""), viewer, deps));
      case "decline":
        return json(await declineTransfer(String(body.token ?? ""), viewer, deps));
      default:
        return json({ ok: false, status: 400, error: "Action inconnue." });
    }
  } catch (err) {
    console.error("lead-transfer", err);
    return json({ ok: false, status: 500, error: "Une erreur est survenue. Réessayez." });
  }
});
