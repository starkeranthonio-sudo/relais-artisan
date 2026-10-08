import { supabase } from "../lib/supabase.ts";
import { callTransferFunction } from "./transferApi.ts";
import type { ArtisanApi, Lead, MonthStats, OutgoingTransfer, Quote, QuoteWithLead } from "./types.ts";

// Identifiant de la fiche artisan, chargé une fois pour la mesure d'usage.
let artisanIdPromise: Promise<string | null> | null = null;
function currentArtisanId(): Promise<string | null> {
  artisanIdPromise ??= Promise.resolve(supabase.from("artisans").select("id").maybeSingle())
    .then(({ data }) => (data?.id as string | undefined) ?? null, () => null);
  return artisanIdPromise;
}
supabase.auth.onAuthStateChange(() => {
  artisanIdPromise = null;
});

const LEAD_COLUMNS =
  "id, client_phone, client_name, work_type, description, address, urgency, photo_paths, ai_summary, status, " +
  "call_count, created_at, last_call_at, form_submitted_at, replied_at, opted_out, quote:quotes(*)";

function ok<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

/** PostgREST renvoie la relation 1-1 soit en objet, soit en tableau selon la détection : on normalise. */
function normalizeLead(row: Record<string, unknown>): Lead {
  const q = row.quote as Quote | Quote[] | null;
  return { ...(row as unknown as Lead), quote: Array.isArray(q) ? (q[0] ?? null) : q };
}

function monthRange(monthStart: Date): [string, string] {
  const end = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
  return [monthStart.toISOString(), end.toISOString()];
}

export const supabaseApi: ArtisanApi = {
  demo: false,

  async getProfile() {
    return ok(await supabase.from("artisans").select("id, business_name, owner_phone, relay_number, referral_code, sms_sender").maybeSingle());
  },

  async updateProfile(patch) {
    const profile = await this.getProfile();
    if (!profile) throw new Error("Profil introuvable");
    ok(await supabase.from("artisans").update(patch).eq("id", profile.id));
  },

  async listLeads() {
    const rows = ok(await supabase.from("leads").select(LEAD_COLUMNS).order("last_call_at", { ascending: false }).limit(200));
    return (rows as unknown as Record<string, unknown>[]).map(normalizeLead);
  },

  async getLead(id) {
    const row = ok(await supabase.from("leads").select(LEAD_COLUMNS).eq("id", id).maybeSingle());
    return row ? normalizeLead(row as unknown as Record<string, unknown>) : null;
  },

  async photoUrls(paths) {
    if (!paths.length) return [];
    const signed = ok(await supabase.storage.from("lead-photos").createSignedUrls(paths, 3600));
    return (signed ?? []).map((s) => s.signedUrl ?? "").filter(Boolean);
  },

  async setLeadStatus(id, status) {
    ok(await supabase.from("leads").update({ status }).eq("id", id));
  },

  async createQuote(leadId, amountCents, sentAt) {
    ok(await supabase.from("quotes").insert({ lead_id: leadId, amount_cents: amountCents, sent_at: sentAt.toISOString() }));
  },

  async listQuotes() {
    return ok(
      await supabase.from("quotes")
        .select("*, lead:leads(id, client_name, client_phone, work_type, address)")
        .order("sent_at", { ascending: false }).limit(300),
    ) as unknown as QuoteWithLead[];
  },

  async setQuoteStatus(id, status, amountCents) {
    const patch: Record<string, unknown> = { status };
    if (amountCents !== undefined) patch.amount_cents = amountCents;
    ok(await supabase.from("quotes").update(patch).eq("id", id));
  },

  async monthStats(monthStart) {
    const [from, to] = monthRange(monthStart);
    const count = async (q: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
      const { count: n, error } = await q;
      if (error) throw new Error(error.message);
      return n ?? 0;
    };
    const head = { count: "exact" as const, head: true };
    const [missedCalls, clientsTexted, requests, quotesSent, decided] = await Promise.all([
      count(supabase.from("calls").select("id", head).gte("created_at", from).lt("created_at", to).neq("outcome", "unknown_relay")),
      count(supabase.from("leads").select("id", head).gte("sms_sent_at", from).lt("sms_sent_at", to)),
      count(supabase.from("leads").select("id", head).gte("form_submitted_at", from).lt("form_submitted_at", to)),
      count(supabase.from("quotes").select("id", head).gte("sent_at", from).lt("sent_at", to)),
      supabase.from("quotes").select("status, amount_cents").gte("decided_at", from).lt("decided_at", to).then(ok),
    ]);
    const won = (decided ?? []).filter((q) => q.status === "won");
    return {
      missedCalls,
      clientsTexted,
      requests,
      quotesSent,
      quotesWon: won.length,
      quotesLost: (decided ?? []).filter((q) => q.status === "lost").length,
      wonAmountCents: won.reduce((sum, q) => sum + (q.amount_cents ?? 0), 0),
    } satisfies MonthStats;
  },

  async transferLead(leadId, phone, note) {
    return callTransferFunction<{ inviteeWasMember: boolean }>({ action: "create", leadId, phone, note });
  },

  async outgoingTransfer(leadId) {
    return ok(
      await supabase.from("lead_transfers").select("status, to_phone, created_at, expires_at")
        .eq("lead_id", leadId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ) as OutgoingTransfer | null;
  },

  async referrals() {
    const rows = ok(await supabase.from("my_referrals").select("business_name").order("created_at"));
    return { names: (rows ?? []).map((r) => r.business_name as string) };
  },

  async leadIdByToken(token) {
    const row = ok(await supabase.from("leads").select("id").eq("public_token", token).maybeSingle());
    return (row?.id as string | undefined) ?? null;
  },

  track(name, props = {}) {
    void currentArtisanId().then((artisanId) => {
      if (!artisanId) return;
      return supabase.from("events").insert({ artisan_id: artisanId, name, props }).then(({ error }) => {
        if (error) console.warn("Mesure non enregistrée", name, error.message);
      });
    });
  },

  async signOut() {
    await supabase.auth.signOut();
  },
};
