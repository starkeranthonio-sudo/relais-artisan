import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { formatFrench } from "./phone.ts";
import type { DueQuote, FollowupStore } from "./followups.ts";
import type { FormLead, FormStore } from "./request-form.ts";
import type { MonthlyStore } from "./monthly.ts";
import { classifyPendingQuotes, parisDate, type RecapArtisan, type RecapStore } from "./recap.ts";
import type { Transfer, TransferArtisan, TransferLead, TransferStore } from "./transfers.ts";
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
        await client.from("artisans").select("id, business_name, owner_phone, relay_number, sms_sender")
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

/** Implémentation Supabase du FormStore (page de demande). */
export function supabaseFormStore(client: SupabaseClient): FormStore {
  return {
    async findLeadByToken(token) {
      const row = check(
        await client.from("leads")
          .select("id, client_phone, form_submitted_at, artisan:artisans(id, business_name, owner_phone, relay_number, sms_sender)")
          .eq("public_token", token).maybeSingle(),
      ) as (Omit<FormLead, "artisan"> & { artisan: Artisan | null }) | null;
      return row?.artisan ? { ...row, artisan: row.artisan } : null;
    },

    async uploadPhoto(path, photo) {
      const { error } = await client.storage.from("lead-photos")
        .upload(path, photo.bytes, { contentType: photo.mediaType, upsert: true });
      if (error) throw new Error(error.message);
    },

    async saveSubmission(leadId, s, at) {
      const rows = check(
        await client.from("leads").update({
          client_name: s.clientName || null,
          work_type: s.workType,
          description: s.description,
          address: s.address,
          urgency: s.urgency,
          photo_paths: s.photoPaths,
          form_submitted_at: at.toISOString(),
          status: "form_submitted",
        }).eq("id", leadId).is("form_submitted_at", null).select("id"),
      );
      return (rows?.length ?? 0) > 0;
    },

    async saveAiSummary(leadId, summary) {
      check(await client.from("leads").update({ ai_summary: summary }).eq("id", leadId));
    },
  };
}

/** Implémentation Supabase du FollowupStore (relances de devis). */
export function supabaseFollowupStore(client: SupabaseClient): FollowupStore {
  return {
    async dueQuotes(now, limit) {
      return check(
        await client.from("quotes")
          .select(
            "id, sent_at, followups_sent, " +
              "artisan:artisans(id, business_name, owner_phone, relay_number, sms_sender), " +
              "lead:leads(id, client_phone, replied_at, opted_out)",
          )
          .eq("status", "pending").lte("next_followup_at", now.toISOString())
          .order("next_followup_at").limit(limit),
      ) as unknown as DueQuote[];
    },

    async claimFollowup(quoteId, followupsSent, nextFollowupAt, stopReason) {
      const rows = check(
        await client.from("quotes").update({
          followups_sent: followupsSent + 1,
          next_followup_at: nextFollowupAt?.toISOString() ?? null,
          stop_reason: stopReason,
        }).eq("id", quoteId).eq("followups_sent", followupsSent).eq("status", "pending").select("id"),
      );
      return (rows?.length ?? 0) > 0;
    },

    async releaseFollowup(quoteId, followupsSent, retryAt) {
      check(
        await client.from("quotes")
          .update({ followups_sent: followupsSent, next_followup_at: retryAt.toISOString(), stop_reason: null })
          .eq("id", quoteId).eq("followups_sent", followupsSent + 1),
      );
    },

    async stop(quoteId, reason) {
      check(await client.from("quotes").update({ next_followup_at: null, stop_reason: reason }).eq("id", quoteId));
    },
  };
}

const TRANSFER_ARTISAN = "id, business_name, owner_phone, relay_number, sms_sender, referred_by, created_at";

/** Implémentation Supabase du TransferStore (transmission entre artisans). */
export function supabaseTransferStore(client: SupabaseClient): TransferStore {
  const toLead = (row: Record<string, unknown> & { quotes?: unknown }): TransferLead => {
    const { quotes, ...rest } = row;
    const q = Array.isArray(quotes) ? quotes[0] : quotes;
    return { ...(rest as unknown as TransferLead), has_quote: !!q };
  };
  const LEAD = "id, artisan_id, client_phone, work_type, address, urgency, ai_summary, status, quotes(id)";

  return {
    async getLead(leadId) {
      const row = check(await client.from("leads").select(LEAD).eq("id", leadId).maybeSingle());
      return row ? toLead(row as unknown as Record<string, unknown>) : null;
    },

    async findArtisanByPhone(phone) {
      return check(
        await client.from("artisans").select(TRANSFER_ARTISAN).eq("owner_phone", phone).not("user_id", "is", null)
          .order("created_at").limit(1).maybeSingle(),
      ) as TransferArtisan | null;
    },

    async hasPendingTransfer(leadId) {
      const { count, error } = await client.from("lead_transfers").select("id", { count: "exact", head: true })
        .eq("lead_id", leadId).eq("status", "pending").gt("expires_at", new Date().toISOString());
      if (error) throw new Error(error.message);
      return (count ?? 0) > 0;
    },

    async createTransfer(t) {
      // Une transmission expirée encore « pending » bloquerait l'index unique : on la clôt d'abord.
      check(await client.from("lead_transfers").update({ status: "expired" })
        .eq("lead_id", t.leadId).eq("status", "pending").lte("expires_at", new Date().toISOString()));
      check(await client.from("lead_transfers").insert({
        lead_id: t.leadId, from_artisan_id: t.fromArtisanId, to_phone: t.toPhone, token: t.token,
        note: t.note, invitee_was_member: t.inviteeWasMember, expires_at: t.expiresAt.toISOString(),
      }));
    },

    async getTransfer(token) {
      const row = check(
        await client.from("lead_transfers")
          .select(`id, token, status, note, created_at, expires_at, to_artisan_id, from:artisans!lead_transfers_from_artisan_id_fkey(${TRANSFER_ARTISAN}), lead:leads(${LEAD})`)
          .eq("token", token).maybeSingle(),
      ) as unknown as (Omit<Transfer, "lead"> & { lead: Record<string, unknown> }) | null;
      return row ? { ...row, lead: toLead(row.lead) } : null;
    },

    async accept(transferId, toArtisanId, at) {
      const rows = check(
        await client.from("lead_transfers").update({ status: "accepted", to_artisan_id: toArtisanId, decided_at: at.toISOString() })
          .eq("id", transferId).eq("status", "pending").select("lead_id"),
      );
      if (!rows?.length) return false;
      check(await client.from("leads").update({ artisan_id: toArtisanId, status: "form_submitted" }).eq("id", rows[0].lead_id));
      return true;
    },

    async decline(transferId, toArtisanId, at) {
      const rows = check(
        await client.from("lead_transfers").update({ status: "declined", to_artisan_id: toArtisanId, decided_at: at.toISOString() })
          .eq("id", transferId).eq("status", "pending").select("id"),
      );
      return (rows?.length ?? 0) > 0;
    },

    async setReferrer(artisanId, referrerId) {
      check(await client.from("artisans").update({ referred_by: referrerId }).eq("id", artisanId).is("referred_by", null));
    },
  };
}

/** Implémentation Supabase du RecapStore (SMS de 18 h). */
export function supabaseRecapStore(client: SupabaseClient): RecapStore {
  return {
    async candidates(today) {
      return check(
        await client.from("artisans").select("id, owner_phone, relay_number")
          .eq("daily_recap", true).not("user_id", "is", null).not("relay_number", "is", null)
          .or(`last_recap_on.is.null,last_recap_on.lt.${today}`),
      ) as RecapArtisan[];
    },

    async content(artisanId, now) {
      // Clients ayant rempli leur demande, pas encore rappelés ni classés, sans devis.
      const leads = check(
        await client.from("leads").select("client_name, client_phone, quotes(id)")
          .eq("artisan_id", artisanId).eq("status", "form_submitted")
          .order("form_submitted_at", { ascending: false }).limit(50),
      ) as { client_name: string | null; client_phone: string; quotes: unknown }[];
      const toCall = leads
        .filter((l) => !(Array.isArray(l.quotes) ? l.quotes.length : l.quotes))
        .map((l) => l.client_name?.trim() || formatFrench(l.client_phone));

      const quotes = check(
        await client.from("quotes").select("sent_at, stop_reason, lead:leads(replied_at)").eq("artisan_id", artisanId).eq("status", "pending"),
      ) as unknown as { sent_at: string; stop_reason: string | null; lead: { replied_at: string | null } | null }[];
      return {
        toCall,
        ...classifyPendingQuotes(quotes.map((q) => ({ sent_at: q.sent_at, stop_reason: q.stop_reason, replied_at: q.lead?.replied_at ?? null })), now),
      };
    },

    async claim(artisanId, today) {
      const rows = check(
        await client.from("artisans").update({ last_recap_on: today })
          .eq("id", artisanId).or(`last_recap_on.is.null,last_recap_on.lt.${today}`).select("id"),
      );
      return (rows?.length ?? 0) > 0;
    },
  };
}

/** Implémentation Supabase du MonthlyStore (bilan du 1er du mois). */
export function supabaseMonthlyStore(client: SupabaseClient): MonthlyStore {
  const count = async (q: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
    const { count: n, error } = await q;
    if (error) throw new Error(error.message);
    return n ?? 0;
  };
  const head = { count: "exact" as const, head: true };

  return {
    async candidates(month) {
      return check(
        await client.from("artisans").select("id, owner_phone, relay_number")
          .eq("daily_recap", true).not("user_id", "is", null).not("relay_number", "is", null)
          .or(`last_monthly_report.is.null,last_monthly_report.lt.${month}`),
      ) as RecapArtisan[];
    },

    async figures(artisanId, from, to) {
      const [f, t] = [from.toISOString(), to.toISOString()];
      const [missedCalls, requests, won] = await Promise.all([
        count(client.from("calls").select("id", head).eq("artisan_id", artisanId).neq("outcome", "unknown_relay").gte("created_at", f).lt("created_at", t)),
        count(client.from("leads").select("id", head).eq("artisan_id", artisanId).gte("form_submitted_at", f).lt("form_submitted_at", t)),
        client.from("quotes").select("amount_cents").eq("artisan_id", artisanId).eq("status", "won").gte("decided_at", f).lt("decided_at", t).then(check),
      ]);
      const rows = (won ?? []) as { amount_cents: number | null }[];
      return { missedCalls, requests, wonCount: rows.length, wonCents: rows.reduce((s, q) => s + (q.amount_cents ?? 0), 0) };
    },

    async bestPreviousWonCents(artisanId, before) {
      const rows = check(
        await client.from("quotes").select("amount_cents, decided_at").eq("artisan_id", artisanId).eq("status", "won")
          .lt("decided_at", before.toISOString()).gte("decided_at", new Date(before.getTime() - 730 * 86_400_000).toISOString()),
      ) as { amount_cents: number | null; decided_at: string }[];
      const byMonth = new Map<string, number>();
      for (const q of rows) {
        const key = parisDate(new Date(q.decided_at)).slice(0, 7);
        byMonth.set(key, (byMonth.get(key) ?? 0) + (q.amount_cents ?? 0));
      }
      return Math.max(0, ...byMonth.values());
    },

    async claim(artisanId, month) {
      const rows = check(
        await client.from("artisans").update({ last_monthly_report: month })
          .eq("id", artisanId).or(`last_monthly_report.is.null,last_monthly_report.lt.${month}`).select("id"),
      );
      return (rows?.length ?? 0) > 0;
    },
  };
}

/** Artisan connecté, à partir de l'en-tête Authorization (jeton Supabase Auth). null si absent ou invalide. */
export async function artisanFromRequest(client: SupabaseClient, req: Request): Promise<TransferArtisan | null> {
  const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data, error } = await client.auth.getUser(jwt);
  if (error || !data.user) return null;
  return check(
    await client.from("artisans").select(TRANSFER_ARTISAN).eq("user_id", data.user.id).maybeSingle(),
  ) as TransferArtisan | null;
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
