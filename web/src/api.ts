const FUNCTIONS_URL = (import.meta.env.VITE_FUNCTIONS_URL as string | undefined)?.replace(/\/$/, "");

/** Jeton de démonstration : la page fonctionne sans backend (démo, développement). */
export const DEMO_TOKEN = "demo";

export type Urgency = "urgent" | "week" | "flexible";

export interface FormInfo {
  businessName: string;
  submitted: boolean;
  workTypes: string[];
}

export interface Submission {
  name: string;
  workType: string;
  description: string;
  address: string;
  urgency: Urgency;
  photos: Blob[];
}

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const DEMO_INFO: FormInfo = {
  businessName: "Dupont Plomberie",
  submitted: false,
  workTypes: [
    "Plomberie / fuite", "Chauffage / chaudière", "Électricité", "Serrurerie", "Toiture / couverture",
    "Menuiserie", "Peinture / plâtrerie", "Maçonnerie", "Carrelage / sol", "Climatisation", "Autre",
  ],
};

async function parse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? "Une erreur est survenue. Merci de réessayer.", res.status);
  return body as T;
}

export async function fetchFormInfo(token: string): Promise<FormInfo> {
  if (token === DEMO_TOKEN) return DEMO_INFO;
  const res = await fetch(`${FUNCTIONS_URL}/request-form?t=${encodeURIComponent(token)}`);
  return parse<FormInfo>(res);
}

export async function submitRequest(token: string, s: Submission): Promise<void> {
  if (token === DEMO_TOKEN) {
    await new Promise((r) => setTimeout(r, 800));
    return;
  }
  const form = new FormData();
  form.set("t", token);
  form.set("name", s.name);
  form.set("work_type", s.workType);
  form.set("description", s.description);
  form.set("address", s.address);
  form.set("urgency", s.urgency);
  s.photos.forEach((p, i) => form.append("photos", p, `photo-${i + 1}.jpg`));
  await parse(await fetch(`${FUNCTIONS_URL}/request-form`, { method: "POST", body: form }));
}
