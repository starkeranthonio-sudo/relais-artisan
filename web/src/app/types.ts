export type LeadStatus = "new" | "form_submitted" | "contacted" | "closed";
export type Urgency = "urgent" | "week" | "flexible";
export type QuoteStatus = "pending" | "won" | "lost";
export type StopReason = "client_replied" | "opted_out" | "completed" | "closed";

export interface Profile {
  id: string;
  business_name: string;
  owner_phone: string;
  relay_number: string | null;
}

export interface Quote {
  id: string;
  lead_id: string;
  amount_cents: number | null;
  status: QuoteStatus;
  sent_at: string;
  followups_sent: number;
  next_followup_at: string | null;
  stop_reason: StopReason | null;
  decided_at: string | null;
}

export interface Lead {
  id: string;
  client_phone: string;
  client_name: string | null;
  work_type: string | null;
  description: string | null;
  address: string | null;
  urgency: Urgency | null;
  photo_paths: string[];
  ai_summary: string | null;
  status: LeadStatus;
  call_count: number;
  created_at: string;
  last_call_at: string;
  form_submitted_at: string | null;
  replied_at: string | null;
  opted_out: boolean;
  quote: Quote | null;
}

export interface QuoteWithLead extends Quote {
  lead: Pick<Lead, "id" | "client_name" | "client_phone" | "work_type" | "address">;
}

export interface MonthStats {
  missedCalls: number;      // appels manqués arrivés sur le numéro relais
  clientsTexted: number;    // clients recontactés automatiquement par SMS
  requests: number;         // demandes détaillées reçues (formulaire rempli)
  quotesSent: number;
  quotesWon: number;
  quotesLost: number;
  wonAmountCents: number;
}

export interface ArtisanApi {
  readonly demo: boolean;
  getProfile(): Promise<Profile | null>;
  updateProfile(patch: Pick<Profile, "business_name" | "owner_phone">): Promise<void>;
  listLeads(): Promise<Lead[]>;
  getLead(id: string): Promise<Lead | null>;
  photoUrls(paths: string[]): Promise<string[]>;
  setLeadStatus(id: string, status: LeadStatus): Promise<void>;
  createQuote(leadId: string, amountCents: number | null, sentAt: Date): Promise<void>;
  listQuotes(): Promise<QuoteWithLead[]>;
  setQuoteStatus(id: string, status: "won" | "lost", amountCents?: number | null): Promise<void>;
  monthStats(monthStart: Date): Promise<MonthStats>;
  signOut(): Promise<void>;
}
