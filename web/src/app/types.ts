export type LeadStatus = "new" | "form_submitted" | "contacted" | "closed";
export type Urgency = "urgent" | "week" | "flexible";
export type QuoteStatus = "pending" | "won" | "lost";
export type StopReason = "client_replied" | "opted_out" | "completed" | "closed";

export interface Profile {
  id: string;
  business_name: string;
  owner_phone: string;
  relay_number: string | null;
  referral_code: string;
  sms_sender: string;
  daily_recap: boolean;
  client_sms_template: string | null;
  google_review_url: string | null;
  trade: string | null;
  postal_code: string | null;
  siret: string | null;
  siret_company_name: string | null;
  siret_verified_at: string | null;
  test_drives_used: number;
}

export interface OutgoingTransfer {
  status: "pending" | "accepted" | "declined" | "expired";
  to_phone: string;
  created_at: string;
  expires_at: string;
}

export interface Referrals {
  names: string[];
  /** Parrainages comptés pour les paliers (SIRET du confrère vérifié). */
  verified: number;
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
  review_requested_at: string | null;
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

export type EventName =
  | "app_open" | "lead_view" | "lead_call" | "lead_sms" | "quote_declared" | "quote_won" | "quote_lost"
  | "transfer_sent" | "referral_share" | "stats_view" | "sms_template_saved" | "review_requested" | "test_drive" | "siret_verified";

export interface ArtisanApi {
  readonly demo: boolean;
  getProfile(): Promise<Profile | null>;
  updateProfile(patch: Partial<Pick<Profile, "business_name" | "owner_phone" | "sms_sender" | "daily_recap" | "client_sms_template" | "google_review_url">>): Promise<void>;
  listLeads(): Promise<Lead[]>;
  getLead(id: string): Promise<Lead | null>;
  photoUrls(paths: string[]): Promise<string[]>;
  setLeadStatus(id: string, status: LeadStatus): Promise<void>;
  createQuote(leadId: string, amountCents: number | null, sentAt: Date): Promise<void>;
  listQuotes(): Promise<QuoteWithLead[]>;
  setQuoteStatus(id: string, status: "won" | "lost", amountCents?: number | null): Promise<void>;
  monthStats(monthStart: Date): Promise<MonthStats>;
  /** Transmet la demande à un confrère (inscrit ou non) : il reçoit un SMS d'invitation. */
  transferLead(leadId: string, phone: string, note: string): Promise<{ inviteeWasMember: boolean }>;
  /** Dernière transmission envoyée pour cette demande, s'il y en a une. */
  outgoingTransfer(leadId: string): Promise<OutgoingTransfer | null>;
  referrals(): Promise<Referrals>;
  /** Envoie au client la demande d'avis Google (chantier terminé). */
  requestReview(leadId: string): Promise<void>;
  /** Essai : simule un appel manqué sur le portable de l'artisan. */
  testDrive(): Promise<void>;
  /** Vérifie le SIRET dans la base Sirene ; renvoie le nom officiel de l'entreprise. */
  verifySiret(siret: string): Promise<{ companyName: string }>;
  /** Montant gagné par mois (« AAAA-MM » → centimes), pour comparer les mois entre eux. */
  wonByMonth(): Promise<Record<string, number>>;
  /** Identifiant d'une demande à partir du jeton court du lien SMS (/app/l/<jeton>). */
  leadIdByToken(token: string): Promise<string | null>;
  /** Mesure d'usage (Habit Testing). Ne bloque jamais l'interface et n'échoue jamais. */
  track(name: EventName, props?: Record<string, unknown>): void;
  signOut(): Promise<void>;
}
