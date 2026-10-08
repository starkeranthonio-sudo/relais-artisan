import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { clampSummary, fallbackSummary, type Photo, SUMMARY_MAX_CHARS } from "../_shared/ai-summary.ts";
import { type FormDeps, type FormLead, type FormStore, getRequestForm, type RawSubmission, submitRequestForm } from "../_shared/request-form.ts";
import { isGsm7 } from "../_shared/twilio.ts";
import type { Store } from "../_shared/types.ts";

const DUPONT = { id: "a1", business_name: "Dupont Plomberie", owner_phone: "+33600000001", relay_number: "+33939000001" };
const JPEG: Photo = { mediaType: "image/jpeg", bytes: new Uint8Array([0xff, 0xd8, 0xff]) };

function setup() {
  const lead: FormLead & { submission?: unknown; ai_summary?: string } = {
    id: "lead-1", artisan: { ...DUPONT, user_id: "user-1" }, client_phone: "+33611223344", form_submitted_at: null,
  };
  const uploads: string[] = [];
  const sent: { from: string; to: string; body: string }[] = [];
  const logged: string[] = [];
  const summarizeCalls: { photos: number }[] = [];

  const formStore: FormStore = {
    findLeadByToken: (t) => Promise.resolve(t === "tok123" ? lead : null),
    uploadPhoto: (path) => {
      uploads.push(path);
      return Promise.resolve();
    },
    saveSubmission: (_id, s, at) => {
      if (lead.form_submitted_at) return Promise.resolve(false);
      lead.form_submitted_at = at.toISOString();
      lead.submission = s;
      return Promise.resolve(true);
    },
    saveAiSummary: (_id, summary) => {
      lead.ai_summary = summary;
      return Promise.resolve();
    },
  };
  const store = { insertMessage: ({ direction }: { direction: string }) => (logged.push(direction), Promise.resolve()) } as unknown as Store;

  const deps: FormDeps = {
    store,
    formStore,
    sendSms: (from, to, body) => (sent.push({ from, to, body }), Promise.resolve({ sid: "SM1" })),
    summarize: (_d, photos) => (summarizeCalls.push({ photos: photos.length }), Promise.resolve("Fuite sous évier cuisine, joint siphon à changer.")),
    appUrl: "https://relais-artisan.fr",
    now: () => new Date("2026-10-01T09:00:00Z"),
  };
  return { lead, uploads, sent, logged, summarizeCalls, deps };
}

const valid = (over: Partial<RawSubmission> = {}): RawSubmission => ({
  token: "tok123",
  clientName: "Marie",
  workType: "Plomberie / fuite",
  description: "Ça fuit sous l'évier de la cuisine depuis ce matin.",
  address: "12 rue des Lilas, Vélizy",
  urgency: "urgent",
  photos: [JPEG, JPEG],
  ...over,
});

Deno.test("GET : nom de l'artisan, sans aucun numéro de téléphone", async () => {
  const { deps } = setup();
  const res = await getRequestForm("tok123", deps.formStore);
  assertEquals(res.status, 200);
  assertEquals(res.body.businessName, "Dupont Plomberie");
  assertEquals(res.body.submitted, false);
  assert(!JSON.stringify(res.body).includes("+33"));
});

Deno.test("GET : jeton inconnu → 404", async () => {
  const { deps } = setup();
  assertEquals((await getRequestForm("nope", deps.formStore)).status, 404);
});

Deno.test("POST : demande enregistrée, photos stockées, résumé IA puis SMS à l'artisan", async () => {
  const { deps, lead, uploads, sent, logged, summarizeCalls } = setup();
  const res = await submitRequestForm(valid(), deps);
  assertEquals(res.status, 200);
  assertEquals(uploads, ["lead-1/1.jpeg", "lead-1/2.jpeg"]);
  assert(lead.form_submitted_at);
  assertEquals(sent.length, 0, "le SMS part après la réponse au client");

  await res.afterResponse!();
  assertEquals(summarizeCalls, [{ photos: 2 }]);
  assertEquals(lead.ai_summary, "Fuite sous évier cuisine, joint siphon à changer.");
  assertEquals(sent.length, 1);
  assertEquals(sent[0].from, DUPONT.relay_number);
  assertEquals(sent[0].to, DUPONT.owner_phone);
  assertEquals(
    sent[0].body,
    "Nouvelle demande - Marie 06 11 22 33 44\n" +
      "URGENT (aujourd'hui) - 12 rue des Lilas, Vélizy\n" +
      "Fuite sous évier cuisine, joint siphon à changer.\n" +
      "2 photos : https://relais-artisan.fr/app/l/tok123",
  );
  assertEquals(logged, ["outbound_artisan"]);
  assert(isGsm7(sent[0].body.replace("Ça", "Ca")), "gabarit du SMS artisan en GSM-7");
});

Deno.test("POST : si l'IA échoue, l'artisan reçoit quand même la demande (résumé de secours)", async () => {
  const { deps, sent } = setup();
  deps.summarize = () => Promise.reject(new Error("API indisponible"));
  await (await submitRequestForm(valid(), deps)).afterResponse!();
  assertStringIncludes(sent[0].body, "Plomberie / fuite : Ça fuit sous l'évier");
});

Deno.test("POST : double envoi → 409, un seul SMS", async () => {
  const { deps, sent } = setup();
  await (await submitRequestForm(valid(), deps)).afterResponse!();
  const again = await submitRequestForm(valid(), deps);
  assertEquals(again.status, 409);
  assertEquals(again.afterResponse, undefined);
  assertEquals(sent.length, 1);
});

Deno.test("POST : validation des champs et des photos", async () => {
  const { deps, uploads } = setup();
  const cases: [Partial<RawSubmission>, string][] = [
    [{ description: "abc" }, "Décrivez"],
    [{ address: "" }, "adresse"],
    [{ urgency: "demain" }, "urgence"],
    [{ workType: " " }, "type de travaux"],
    [{ photos: [JPEG, JPEG, JPEG, JPEG] }, "3 photos"],
    [{ photos: [{ mediaType: "image/gif" as Photo["mediaType"], bytes: new Uint8Array(1) }] }, "Format"],
    [{ photos: [{ mediaType: "image/jpeg", bytes: new Uint8Array(6 * 1024 * 1024) }] }, "lourde"],
  ];
  for (const [over, expected] of cases) {
    const res = await submitRequestForm(valid(over), deps);
    assertEquals(res.status, 400, JSON.stringify(over).slice(0, 60));
    assertStringIncludes(String(res.body.error), expected);
  }
  assertEquals(uploads.length, 0);
});

Deno.test("POST : jeton inconnu → 404", async () => {
  const { deps } = setup();
  assertEquals((await submitRequestForm(valid({ token: "nope" }), deps)).status, 404);
});

Deno.test("résumé : une ligne, tronqué à la longueur max", () => {
  assertEquals(clampSummary("  Fuite\n sous   évier "), "Fuite sous évier");
  const long = clampSummary("x".repeat(500));
  assertEquals(long.length, SUMMARY_MAX_CHARS);
  assert(long.endsWith("…"));
  assert(fallbackSummary({ workType: "Électricité", description: "y".repeat(400), urgency: "week", photoCount: 0 }).length <= SUMMARY_MAX_CHARS);
});

Deno.test("testeur (sans compte) : le SMS « Nouvelle demande » ouvre l'aperçu /essai, et l'aperçu est renvoyé", async () => {
  const { deps, lead, sent } = setup();
  lead.artisan = { ...DUPONT, user_id: null };
  await (await submitRequestForm(valid(), deps)).afterResponse!();
  assertStringIncludes(sent[0].body, "https://relais-artisan.fr/essai/tok123");
  Object.assign(lead, { work_type: "Plomberie / fuite", urgency: "urgent", address: "12 rue des Lilas", description: "Fuite", ai_summary: "Fuite évier" });
  const res = await getRequestForm("tok123", deps.formStore);
  assertEquals((res.body.preview as { summary: string }).summary, "Fuite évier");
});
