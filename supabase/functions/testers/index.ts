// Parcours « Testeurs fondateurs » RelaisArti (public, sans compte ; le testeur est identifié par son jeton secret).
//   GET  ?t=<jeton>                                   → état du testeur (étapes, parrainages)
//   POST { action: "register", ...infos, ref, sessionId }
//   POST { action: "test_drive" | "verify_siret" | "skip_siret" | "complete", t, siret?, sessionId }
//   POST multipart { action: "proof", t, siret, sessionId, file }  → photo d'un devis (vérification manuelle)
import { serviceClient, requireEnv, supabaseProgramStore, supabaseTesterStore } from "../_shared/store.ts";
import { checkSiret, complete, deleteTester, getState, register, sendProof, skipSiret, testDrive } from "../_shared/tester-program.ts";
import { twilioSender } from "../_shared/twilio.ts";

const client = serviceClient();
const sendSms = twilioSender(requireEnv("TWILIO_ACCOUNT_SID"), requireEnv("TWILIO_AUTH_TOKEN"), Deno.env.get("SMS_SENDER_ID"));
const appUrl = requireEnv("PUBLIC_APP_URL");
const deps = {
  store: supabaseProgramStore(client),
  testerDeps: { store: supabaseTesterStore(client), sendSms, appUrl },
  sendSms,
  appUrl,
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
type R = { ok: true; value: unknown } | { ok: false; status: number; error: string; code?: string };
const reply = (r: R) => (r.ok ? json(200, r.value ?? {}) : json(r.status, { error: r.error, code: r.code }));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    if (req.method === "GET") return reply(await getState(new URL(req.url).searchParams.get("t") ?? "", deps));
    if (req.method !== "POST") return json(405, { error: "Méthode non autorisée." });

    if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return json(400, { error: "Ajoutez une photo ou un PDF." });
      return reply(await sendProof(
        String(form.get("t") ?? ""), { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type },
        form.get("siret"), form.get("sessionId"), deps,
      ));
    }

    const b = await req.json().catch(() => ({}));
    const t = String(b.t ?? "");
    switch (b.action) {
      case "register": return reply(await register(b, deps));
      case "test_drive": return reply(await testDrive(t, b.sessionId, deps));
      case "verify_siret": return reply(await checkSiret(t, b.siret, b.sessionId, deps));
      case "skip_siret": return reply(await skipSiret(t, b.sessionId, deps));
      case "complete": return reply(await complete(t, b.sessionId, deps));
      case "delete": return reply(await deleteTester(t, deps));
      default: return json(400, { error: "Action inconnue." });
    }
  } catch (err) {
    console.error("testers", err);
    return json(500, { error: "Une erreur est survenue. Réessayez." });
  }
});
