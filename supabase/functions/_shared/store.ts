import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Artisan, Lead, Store } from "./types.ts";

const LEAD_COLUMNS = "id, artisan_id, client_phone, public_token, call_count, sms_sent_at";

function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

/** Implémentation Supabase du Store. Utilise la clé service_role : à n'utiliser que côté serveur. */
export function supabaseStore(client: SupabaseClient): Store {
  return {
    async findArtisanByRelay(relayNumber) {
      return check(
        await client.from("artisans").select("id, business_name, owner_phone, relay_number")
          .eq("relay_number", relayNumber).maybeSingle(),
      ) as Artisan | null;
    },

    async claimCall({ callSid, artisanId, from, to, outcome }) {
      const { error } = await client.from("calls").insert({
        call_sid: callSid,
        artisan_id: artisanId,
        from_number: from,
        to_number: to,
        outcome,
      });
      if (error?.code === "23505") return false; // CallSid déjà enregistré
      if (error) throw new Error(error.message);
      return true;
    },

    async setCallOutcome(callSid, outcome, leadId) {
      check(await client.from("calls").update({ outcome, lead_id: leadId ?? null }).eq("call_sid", callSid));
    },

    async findOpenLead(artisanId, clientPhone, since) {
      return check(
        await client.from("leads").select(LEAD_COLUMNS)
          .eq("artisan_id", artisanId).eq("client_phone", clientPhone)
          .neq("status", "closed").gte("created_at", since.toISOString())
          .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ) as Lead | null;
    },

    async findLatestLead(artisanId, clientPhone) {
      return check(
        await client.from("leads").select(LEAD_COLUMNS)
          .eq("artisan_id", artisanId).eq("client_phone", clientPhone)
          .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ) as Lead | null;
    },

    async createLead({ artisanId, clientPhone, publicToken }) {
      return check(
        await client.from("leads")
          .insert({ artisan_id: artisanId, client_phone: clientPhone, public_token: publicToken })
          .select(LEAD_COLUMNS).single(),
      ) as Lead;
    },

    async recordRepeatCall(leadId, callCount, at) {
      check(await client.from("leads").update({ call_count: callCount, last_call_at: at.toISOString() }).eq("id", leadId));
    },

    async markSmsSent(leadId, at) {
      check(await client.from("leads").update({ sms_sent_at: at.toISOString() }).eq("id", leadId));
    },

    async markReplied(leadId, at, optedOut) {
      const patch: Record<string, unknown> = { replied_at: at.toISOString() };
      if (optedOut) patch.opted_out = true;
      check(await client.from("leads").update(patch).eq("id", leadId));
    },

    async insertMessage({ artisanId, leadId, direction, body, twilioSid }) {
      check(await client.from("messages").insert({
        artisan_id: artisanId,
        lead_id: leadId,
        direction,
        body,
        twilio_sid: twilioSid ?? null,
      }));
    },
  };
}

export function serviceClient(): SupabaseClient {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}
