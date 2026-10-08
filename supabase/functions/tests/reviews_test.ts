import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { type ReviewArtisan, type ReviewDeps, type ReviewLead, requestReview, reviewSms } from "../_shared/reviews.ts";
import { isGsm7, toGsm7 } from "../_shared/twilio.ts";

const URL_AVIS = "https://g.page/r/CQx1AbCdEfGhIjKl/review";
const ARTISAN: ReviewArtisan = { id: "a1", business_name: "Starker", relay_number: "+18654892655", sms_sender: "Starker", google_review_url: URL_AVIS };

function setup(over: Partial<ReviewLead> = {}) {
  const lead: ReviewLead = {
    id: "l1", artisan_id: "a1", client_phone: "+33611223344", client_name: "Marie Dupont",
    opted_out: false, review_requested_at: null, quote_status: "won", ...over,
  };
  const sent: { to: string; body: string; sender?: string }[] = [];
  const deps: ReviewDeps = {
    store: {
      getLead: (id) => Promise.resolve(id === lead.id ? lead : null),
      markRequested: (_id, at) => {
        if (lead.review_requested_at) return Promise.resolve(false);
        lead.review_requested_at = at.toISOString();
        return Promise.resolve(true);
      },
      unmarkRequested: () => ((lead.review_requested_at = null), Promise.resolve()),
    },
    sendSms: (_from, to, body, sender) => (sent.push({ to, body, sender }), Promise.resolve({ sid: "SM" })),
    now: () => new Date("2026-10-09T10:00:00Z"),
  };
  return { lead, sent, deps };
}

Deno.test("chantier gagné : SMS au client, au nom de l'artisan, avec le lien d'avis ; une seule fois", async () => {
  const { sent, deps } = setup();
  assertEquals(await requestReview(ARTISAN, "l1", deps), { ok: true });
  assertEquals(sent.length, 1);
  assertEquals(sent[0].to, "+33611223344");
  assertEquals(sent[0].sender, "Starker");
  assertStringIncludes(sent[0].body, "Bonjour Marie, Starker vous remercie");
  assertStringIncludes(sent[0].body, URL_AVIS);
  const again = await requestReview(ARTISAN, "l1", deps);
  assert(!again.ok && again.status === 409);
  assertEquals(sent.length, 1);
});

Deno.test("refus : pas de lien Google, devis pas gagné, client désinscrit, demande d'un autre artisan", async () => {
  assertEquals((await requestReview({ ...ARTISAN, google_review_url: null }, "l1", setup().deps)).ok, false);
  assertEquals((await requestReview(ARTISAN, "l1", setup({ quote_status: "pending" }).deps)).ok, false);
  assertEquals((await requestReview(ARTISAN, "l1", setup({ quote_status: null }).deps)).ok, false);
  assertEquals((await requestReview(ARTISAN, "l1", setup({ opted_out: true }).deps)).ok, false);
  assertEquals((await requestReview(ARTISAN, "l1", setup({ artisan_id: "autre" }).deps)).ok, false);
});

Deno.test("échec Twilio : la demande n'est pas marquée, on peut réessayer", async () => {
  const { lead, deps } = setup();
  deps.sendSms = () => Promise.reject(new Error("down"));
  const res = await requestReview(ARTISAN, "l1", deps);
  assert(!res.ok && res.status === 502);
  assertEquals(lead.review_requested_at, null);
});

Deno.test("texte : 1 SMS (GSM-7), version courte si nom ou lien longs", () => {
  for (const [name, client, url] of [
    ["Starker", "Marie", URL_AVIS],
    ["ElectriciteMartinEtFils", "Jean-Baptiste", "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4"],
  ]) {
    const body = toGsm7(reviewSms(name, client, url));
    assert(isGsm7(body));
    assert(body.length <= 160, `${body.length} : ${body}`);
  }
});
