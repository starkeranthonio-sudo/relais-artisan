// Page de demande du client (lien envoyé par SMS) : API publique, protégée par le jeton unique de la demande.
//   GET  /functions/v1/request-form?t=<token>  → nom de l'artisan, demande déjà envoyée ou non
//   POST /functions/v1/request-form            → multipart : t, name, work_type, description, address, urgency, photos[]
import Anthropic from "npm:@anthropic-ai/sdk";
import { claudeSummarizer, type Photo } from "../_shared/ai-summary.ts";
import { getRequestForm, type FormResult, submitRequestForm } from "../_shared/request-form.ts";
import { requireEnv, serviceClient, supabaseFormStore, supabaseStore } from "../_shared/store.ts";
import { twilioSender } from "../_shared/twilio.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const client = serviceClient();
const deps = {
  store: supabaseStore(client),
  formStore: supabaseFormStore(client),
  sendSms: twilioSender(requireEnv("TWILIO_ACCOUNT_SID"), requireEnv("TWILIO_AUTH_TOKEN"), Deno.env.get("SMS_SENDER_ID")),
  // Sans clé Anthropic, l'artisan reçoit le résumé de secours (type de travaux + début du message).
  summarize: Deno.env.get("ANTHROPIC_API_KEY")
    ? claudeSummarizer(new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") }))
    : () => Promise.reject(new Error("ANTHROPIC_API_KEY non configurée")),
  appUrl: requireEnv("PUBLIC_APP_URL"),
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
};

function json({ status, body }: FormResult): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    if (req.method === "GET") {
      const token = new URL(req.url).searchParams.get("t") ?? "";
      return json(await getRequestForm(token, deps.formStore));
    }

    if (req.method === "POST") {
      const form = await req.formData();
      const text = (key: string) => {
        const v = form.get(key);
        return typeof v === "string" ? v : "";
      };
      const photos: Photo[] = [];
      for (const entry of form.getAll("photos")) {
        if (entry instanceof File && entry.size > 0) {
          photos.push({ mediaType: entry.type as Photo["mediaType"], bytes: new Uint8Array(await entry.arrayBuffer()) });
        }
      }
      const result = await submitRequestForm({
        token: text("t"),
        clientName: text("name"),
        workType: text("work_type"),
        description: text("description"),
        address: text("address"),
        urgency: text("urgency"),
        photos,
      }, deps);
      if (result.afterResponse) EdgeRuntime.waitUntil(result.afterResponse());
      return json(result);
    }

    return json({ status: 405, body: { error: "Méthode non autorisée." } });
  } catch (err) {
    console.error("request-form", err);
    return json({ status: 500, body: { error: "Une erreur est survenue. Merci de réessayer." } });
  }
});
