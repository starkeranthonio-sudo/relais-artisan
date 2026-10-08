import { supabase } from "../lib/supabase.ts";

const FUNCTION_URL = `${(import.meta.env.VITE_FUNCTIONS_URL as string).replace(/\/$/, "")}/lead-transfer`;

/** Jeton de démonstration : /t/demo fonctionne sans backend. */
export const DEMO_TRANSFER_TOKEN = "demo";

export interface TransferPreview {
  status: "pending" | "accepted" | "declined" | "expired";
  fromName: string;
  workType: string | null;
  city: string;
  urgency: "urgent" | "week" | "flexible" | null;
  summary: string | null;
  note: string | null;
  leadId: string | null;
  isSender: boolean;
}

export class TransferError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function headers(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  return {
    apikey: key,
    "Content-Type": "application/json",
    ...(data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}),
  };
}

async function parse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new TransferError(body.error ?? "Une erreur est survenue.", res.status);
  return body as T;
}

export async function callTransferFunction<T>(body: Record<string, unknown>): Promise<T> {
  return parse<T>(await fetch(FUNCTION_URL, { method: "POST", headers: await headers(), body: JSON.stringify(body) }));
}

const DEMO_PREVIEW: TransferPreview = {
  status: "pending", fromName: "Dupont Plomberie", workType: "Électricité", city: "Vélizy-Villacoublay", urgency: "urgent",
  summary: "Plus de courant dans la cuisine, le disjoncteur saute dès qu'on allume le four.",
  note: "Cliente sympa, je ne fais pas l'électricité. Elle attend un appel aujourd'hui.", leadId: null, isSender: false,
};

export async function fetchTransferPreview(token: string): Promise<TransferPreview> {
  if (token === DEMO_TRANSFER_TOKEN) return DEMO_PREVIEW;
  return parse<TransferPreview>(await fetch(`${FUNCTION_URL}?t=${encodeURIComponent(token)}`, { headers: await headers() }));
}

export async function respondToTransfer(token: string, action: "accept" | "decline"): Promise<{ leadId?: string }> {
  if (token === DEMO_TRANSFER_TOKEN) return {};
  return callTransferFunction<{ leadId?: string }>({ action, token });
}
