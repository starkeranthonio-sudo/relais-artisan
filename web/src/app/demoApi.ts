import type { ArtisanApi, Lead, LeadStatus, OutgoingTransfer, Profile, Quote, QuoteWithLead } from "./types.ts";

/**
 * Données fictives pour montrer l'espace artisan sans compte (démonstration commerciale, développement).
 * Les modifications restent en mémoire le temps de la visite.
 */
const H = 3600_000;
const D = 24 * H;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();

const profile: Profile = {
  id: "demo", business_name: "Dupont Plomberie", owner_phone: "+33612345678", relay_number: "+33939012345", referral_code: "demo123", sms_sender: "DupontPlomb", daily_recap: true, client_sms_template: null,
  google_review_url: "https://g.page/r/demo/review", trade: "Plombier", postal_code: "78140",
  siret: null, siret_company_name: null, siret_verified_at: null, test_drives_used: 1,
};
const transfers = new Map<string, OutgoingTransfer>();

function lead(p: Partial<Lead> & Pick<Lead, "id" | "client_phone">): Lead {
  return {
    client_name: null, work_type: null, description: null, address: null, urgency: null, photo_paths: [],
    ai_summary: null, status: "new", call_count: 1, created_at: ago(H), last_call_at: ago(H),
    form_submitted_at: null, replied_at: null, opted_out: false, review_requested_at: null, quote: null, ...p,
  };
}

function quote(p: Partial<Quote> & Pick<Quote, "id" | "lead_id">): Quote {
  return {
    amount_cents: null, status: "pending", sent_at: ago(D), followups_sent: 0, next_followup_at: inMs(2 * D),
    stop_reason: null, decided_at: null, ...p,
  };
}

const leads: Lead[] = [
  lead({
    id: "l1", client_phone: "+33611223344", client_name: "Marie", work_type: "Plomberie / fuite", urgency: "urgent",
    address: "12 Rue de la Forêt 78140 Vélizy-Villacoublay", status: "form_submitted",
    description: "Ça fuit sous l'évier de la cuisine depuis ce matin, l'eau coule en continu quand on ouvre le robinet.",
    ai_summary: "Fuite continue sous évier cuisine, probablement siphon ou raccord. Intervention rapide.",
    created_at: ago(25 * 60_000), last_call_at: ago(25 * 60_000), form_submitted_at: ago(18 * 60_000),
  }),
  lead({ id: "l2", client_phone: "+33698765432", created_at: ago(2 * H), last_call_at: ago(2 * H), call_count: 2 }),
  lead({
    id: "l3", client_phone: "+33677889900", client_name: "M. Leroy", work_type: "Chauffage / chaudière", urgency: "week",
    address: "4 Avenue de l'Europe 78140 Vélizy-Villacoublay", status: "contacted",
    description: "La chaudière se met en sécurité plusieurs fois par jour, code F28 affiché.",
    ai_summary: "Chaudière en sécurité répétée, code F28 (défaut d'allumage). Prévoir diagnostic gaz/électrodes.",
    created_at: ago(D + 3 * H), last_call_at: ago(D + 3 * H), form_submitted_at: ago(D + 2 * H),
  }),
  lead({
    id: "l4", client_phone: "+33655443322", client_name: "Sophie", work_type: "Plomberie / fuite", urgency: "flexible",
    address: "27 Rue Marcel Sembat 92190 Meudon", status: "contacted",
    description: "Je voudrais remplacer ma baignoire par une douche à l'italienne.",
    ai_summary: "Projet : remplacement baignoire par douche à l'italienne. Devis à prévoir, pas urgent.",
    created_at: ago(6 * D), last_call_at: ago(6 * D), form_submitted_at: ago(6 * D - H),
  }),
  lead({
    id: "l5", client_phone: "+33644332211", client_name: "Karim", work_type: "Plomberie / fuite", urgency: "week",
    address: "8 Place de l'Hôtel de Ville 78140 Vélizy-Villacoublay", status: "closed",
    description: "Chauffe-eau qui ne chauffe plus.", ai_summary: "Chauffe-eau électrique 200 L sans eau chaude. Résistance ou thermostat.",
    created_at: ago(12 * D), last_call_at: ago(12 * D), form_submitted_at: ago(12 * D - H),
  }),
  lead({
    id: "l6", client_phone: "+33633221100", client_name: "Julie", work_type: "Plomberie / fuite", urgency: "flexible",
    address: "3 Rue du Général Exelmans 78140 Vélizy-Villacoublay", status: "closed",
    description: "Robinet de salle de bain qui goutte.", ai_summary: "Robinet salle de bain qui goutte : cartouche ou joint à changer.",
    created_at: ago(15 * D), last_call_at: ago(15 * D), form_submitted_at: ago(15 * D - H),
  }),
];

leads[2].quote = quote({ id: "q1", lead_id: "l3", amount_cents: 38000, sent_at: ago(D), followups_sent: 0, next_followup_at: inMs(2 * D) });
leads[3].quote = quote({ id: "q2", lead_id: "l4", amount_cents: 640000, sent_at: ago(5 * D), followups_sent: 1, next_followup_at: inMs(2 * D) });
leads[4].quote = quote({
  id: "q3", lead_id: "l5", amount_cents: 115000, status: "won", sent_at: ago(11 * D), followups_sent: 2,
  next_followup_at: null, stop_reason: "client_replied", decided_at: ago(3 * D),
});
leads[5].quote = quote({
  id: "q4", lead_id: "l6", amount_cents: 18000, status: "lost", sent_at: ago(14 * D), followups_sent: 3,
  next_followup_at: null, stop_reason: "closed", decided_at: ago(D),
});

const find = (id: string) => leads.find((l) => l.id === id) ?? null;

export const demoApi: ArtisanApi = {
  demo: true,
  getProfile: async () => profile,
  updateProfile: async (patch) => void Object.assign(profile, patch),
  listLeads: async () => [...leads],
  getLead: async (id) => find(id),
  photoUrls: async () => [],
  setLeadStatus: async (id, status: LeadStatus) => void (find(id)!.status = status),
  createQuote: async (leadId, amountCents, sentAt) => {
    const l = find(leadId)!;
    l.quote = quote({
      id: `q-${leadId}`, lead_id: leadId, amount_cents: amountCents, sent_at: sentAt.toISOString(),
      next_followup_at: new Date(sentAt.getTime() + 3 * D).toISOString(),
    });
  },
  listQuotes: async () =>
    leads.filter((l) => l.quote).map((l) => ({
      ...l.quote!,
      lead: { id: l.id, client_name: l.client_name, client_phone: l.client_phone, work_type: l.work_type, address: l.address },
    }) satisfies QuoteWithLead),
  setQuoteStatus: async (id, status, amountCents) => {
    const q = leads.find((l) => l.quote?.id === id)!.quote!;
    Object.assign(q, { status, next_followup_at: null, stop_reason: q.stop_reason ?? "closed", decided_at: new Date().toISOString() });
    if (amountCents !== undefined) q.amount_cents = amountCents;
  },
  monthStats: async (monthStart) => {
    const inMonth = (iso: string | null) => {
      if (!iso) return false;
      const d = new Date(iso);
      return d.getFullYear() === monthStart.getFullYear() && d.getMonth() === monthStart.getMonth();
    };
    const quotes = leads.map((l) => l.quote).filter((q): q is Quote => !!q);
    const won = quotes.filter((q) => q.status === "won" && inMonth(q.decided_at));
    return {
      missedCalls: leads.filter((l) => inMonth(l.created_at)).reduce((n, l) => n + l.call_count, 0) + 9,
      clientsTexted: leads.filter((l) => inMonth(l.created_at)).length + 7,
      requests: leads.filter((l) => inMonth(l.form_submitted_at)).length + 5,
      quotesSent: quotes.filter((q) => inMonth(q.sent_at)).length + 3,
      quotesWon: won.length + 2,
      quotesLost: quotes.filter((q) => q.status === "lost" && inMonth(q.decided_at)).length,
      wonAmountCents: won.reduce((s, q) => s + (q.amount_cents ?? 0), 0) + 412000,
    };
  },
  transferLead: async (leadId, phone) => {
    transfers.set(leadId, {
      status: "pending", to_phone: phone, created_at: new Date().toISOString(), expires_at: inMs(7 * D),
    });
    return { inviteeWasMember: false };
  },
  outgoingTransfer: async (leadId) => transfers.get(leadId) ?? null,
  referrals: async () => ({ names: ["Martin Électricité", "Leroy Chauffage"], verified: 2 }),
  testDrive: async () => {
    profile.test_drives_used += 1;
  },
  verifySiret: async (siret) => {
    if (siret.replace(/\s/g, "") !== "92759307900050") throw new Error("En démonstration, essayez le SIRET 927 593 079 00050.");
    Object.assign(profile, { siret: "92759307900050", siret_company_name: "AZUR PLOMBERIE", siret_verified_at: new Date().toISOString() });
    return { companyName: "AZUR PLOMBERIE" };
  },
  leadIdByToken: async () => "l1",
  requestReview: async (leadId) => {
    find(leadId)!.review_requested_at = new Date().toISOString();
  },
  wonByMonth: async () => {
    const key = (offset: number) => {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    };
    return { [key(0)]: 527000, [key(1)]: 318000, [key(2)]: 405000 };
  },
  track: () => {},
  signOut: async () => {},
};
