export interface Artisan {
  id: string;
  business_name: string;
  owner_phone: string;
  relay_number: string;
  sms_sender?: string;
  client_sms_template?: string | null;
}

export interface Lead {
  id: string;
  artisan_id: string;
  client_phone: string;
  public_token: string;
  call_count: number;
  sms_sent_at: string | null;
}

export type CallOutcome = "pending" | "sms_sent" | "sms_skipped_recent" | "caller_hidden" | "unknown_relay" | "sms_failed";
export type MessageDirection = "outbound_client" | "inbound_client" | "outbound_artisan";

/** Accès base de données utilisé par la logique métier (implémenté avec Supabase dans store.ts, simulé dans les tests). */
export interface Store {
  findArtisanByRelay(relayNumber: string): Promise<Artisan | null>;
  /** Enregistre l'appel. Renvoie false si ce CallSid a déjà été traité (Twilio a renvoyé le webhook). */
  claimCall(call: { callSid: string; artisanId: string | null; from: string; to: string; outcome: CallOutcome }): Promise<boolean>;
  setCallOutcome(callSid: string, outcome: CallOutcome, leadId?: string): Promise<void>;
  findOpenLead(artisanId: string, clientPhone: string, since: Date): Promise<Lead | null>;
  findLatestLead(artisanId: string, clientPhone: string): Promise<Lead | null>;
  createLead(lead: { artisanId: string; clientPhone: string; publicToken: string }): Promise<Lead>;
  recordRepeatCall(leadId: string, callCount: number, at: Date): Promise<void>;
  markSmsSent(leadId: string, at: Date): Promise<void>;
  markReplied(leadId: string, at: Date, optedOut: boolean): Promise<void>;
  insertMessage(msg: { artisanId: string; leadId: string | null; direction: MessageDirection; body: string; twilioSid?: string }): Promise<void>;
}
