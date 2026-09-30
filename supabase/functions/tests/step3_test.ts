import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { type DueQuote, followupBody, type FollowupDeps, type FollowupStore, inSendingWindow, runFollowups, type StopReason } from "../_shared/followups.ts";
import { isGsm7 } from "../_shared/twilio.ts";
import type { Store } from "../_shared/types.ts";

const DUPONT = { id: "a1", business_name: "Dupont Plomberie", owner_phone: "+33600000001", relay_number: "+33939000001" };
const SENT_AT = "2026-10-05T08:00:00Z"; // lundi 5 octobre, 10 h à Paris
const DAY = 24 * 60 * 60 * 1000;
const at = (iso: string) => new Date(iso);

interface MemQuote {
  id: string;
  sent_at: string;
  followups_sent: number;
  next_followup_at: Date | null;
  stop_reason: StopReason | null;
  status: "pending" | "won" | "lost";
  lead: DueQuote["lead"];
}

function setup(over: Partial<MemQuote["lead"]> = {}) {
  const quote: MemQuote = {
    id: "q1",
    sent_at: SENT_AT,
    followups_sent: 0,
    next_followup_at: new Date(at(SENT_AT).getTime() + 3 * DAY),
    stop_reason: null,
    status: "pending",
    lead: { id: "lead-1", client_phone: "+33611223344", replied_at: null, opted_out: false, ...over },
  };
  const sent: { from: string; to: string; body: string }[] = [];
  let claimRace = false;

  const followups: FollowupStore = {
    dueQuotes: (now) =>
      Promise.resolve(
        quote.status === "pending" && quote.next_followup_at && quote.next_followup_at <= now
          ? [{ id: quote.id, sent_at: quote.sent_at, followups_sent: quote.followups_sent, artisan: DUPONT, lead: quote.lead }]
          : [],
      ),
    claimFollowup: (_id, n, nextAt, reason) => {
      if (claimRace || quote.followups_sent !== n) return Promise.resolve(false);
      quote.followups_sent = n + 1;
      quote.next_followup_at = nextAt;
      quote.stop_reason = reason;
      return Promise.resolve(true);
    },
    releaseFollowup: (_id, n, retryAt) => {
      quote.followups_sent = n;
      quote.next_followup_at = retryAt;
      quote.stop_reason = null;
      return Promise.resolve();
    },
    stop: (_id, reason) => {
      quote.next_followup_at = null;
      quote.stop_reason = reason;
      return Promise.resolve();
    },
  };
  const store = { insertMessage: () => Promise.resolve() } as unknown as Store;
  const deps = (now: string): FollowupDeps => ({
    store,
    followups,
    sendSms: (from, to, body) => (sent.push({ from, to, body }), Promise.resolve({ sid: "SM" })),
    now: () => at(now),
  });
  return { quote, sent, deps, race: () => (claimRace = true) };
}

Deno.test("J+3, J+7, J+14 : trois relances puis arrêt", async () => {
  const { quote, sent, deps } = setup();

  assertEquals((await runFollowups(deps("2026-10-07T08:00:00Z"))).sent, 0, "rien avant J+3");

  await runFollowups(deps("2026-10-08T08:00:00Z")); // jeudi, J+3
  assertEquals(sent.length, 1);
  assertEquals(sent[0].from, DUPONT.relay_number);
  assertEquals(sent[0].to, "+33611223344");
  assertStringIncludes(sent[0].body, "avez-vous pu consulter notre devis du 05/10");
  assertEquals(quote.next_followup_at, at("2026-10-12T08:00:00Z"), "prochaine relance à J+7");

  await runFollowups(deps("2026-10-12T08:15:00Z")); // lundi, J+7
  assertStringIncludes(sent[1].body, "On planifie les travaux");
  assertEquals(quote.next_followup_at, at("2026-10-19T08:00:00Z"), "prochaine relance à J+14");

  await runFollowups(deps("2026-10-19T08:15:00Z")); // lundi, J+14
  assertStringIncludes(sent[2].body, "dernier message");
  assertEquals(quote.followups_sent, 3);
  assertEquals(quote.next_followup_at, null);
  assertEquals(quote.stop_reason, "completed");

  await runFollowups(deps("2026-11-01T09:00:00Z"));
  assertEquals(sent.length, 3, "jamais de 4e relance");
});

Deno.test("le client a répondu après l'envoi du devis : relances stoppées, aucun SMS", async () => {
  const { quote, sent, deps } = setup({ replied_at: "2026-10-06T12:00:00Z" });
  const report = await runFollowups(deps("2026-10-08T08:00:00Z"));
  assertEquals(report, { sent: 0, stopped: 1, waiting: 0, failed: 0 });
  assertEquals(sent.length, 0);
  assertEquals(quote.stop_reason, "client_replied");
  assertEquals(quote.next_followup_at, null);
});

Deno.test("une réponse antérieure au devis n'empêche pas la relance", async () => {
  const { sent, deps } = setup({ replied_at: "2026-10-01T12:00:00Z" });
  await runFollowups(deps("2026-10-08T08:00:00Z"));
  assertEquals(sent.length, 1);
});

Deno.test("client désinscrit (STOP) : relances stoppées", async () => {
  const { quote, sent, deps } = setup({ opted_out: true });
  await runFollowups(deps("2026-10-08T08:00:00Z"));
  assertEquals(sent.length, 0);
  assertEquals(quote.stop_reason, "opted_out");
});

Deno.test("hors plage horaire (dimanche, soir, tôt le matin) : la relance attend", async () => {
  for (const now of ["2026-10-11T10:00:00Z" /* dimanche */, "2026-10-08T18:30:00Z" /* 20 h 30 */, "2026-10-09T05:00:00Z" /* vendredi 7 h */]) {
    const { quote, sent, deps } = setup();
    const report = await runFollowups(deps(now));
    assertEquals(report.waiting, 1, now);
    assertEquals(sent.length, 0);
    assertEquals(quote.followups_sent, 0, "toujours due au prochain passage");
  }
});

Deno.test("deux passages simultanés : une seule relance envoyée", async () => {
  const { sent, deps, race } = setup();
  race();
  await runFollowups(deps("2026-10-08T08:00:00Z"));
  assertEquals(sent.length, 0);
});

Deno.test("échec Twilio : réservation annulée, nouvel essai 1 h plus tard", async () => {
  const { quote, deps } = setup();
  const d = deps("2026-10-08T08:00:00Z");
  d.sendSms = () => Promise.reject(new Error("Twilio down"));
  const report = await runFollowups(d);
  assertEquals(report.failed, 1);
  assertEquals(quote.followups_sent, 0);
  assertEquals(quote.next_followup_at, at("2026-10-08T09:00:00Z"));
});

Deno.test("les 3 SMS de relance tiennent en un SMS et contiennent STOP", () => {
  for (const n of [1, 2, 3] as const) {
    const body = followupBody(n, "Dupont Plomberie", SENT_AT);
    assert(body.length <= 160, `relance ${n} : ${body.length} caractères`);
    assertStringIncludes(body, "STOP");
    assert(isGsm7(body), `relance ${n} : caractère hors GSM-7`);
  }
});

Deno.test("plage d'envoi : lundi-samedi 9 h – 19 h, heure de Paris (heure d'été et d'hiver)", () => {
  assert(inSendingWindow(at("2026-10-08T07:00:00Z"))); // 9 h (UTC+2)
  assert(!inSendingWindow(at("2026-10-08T06:59:00Z"))); // 8 h 59
  assert(!inSendingWindow(at("2026-10-08T17:00:00Z"))); // 19 h
  assert(inSendingWindow(at("2026-12-10T08:00:00Z"))); // 9 h (UTC+1)
  assert(!inSendingWindow(at("2026-12-10T07:30:00Z"))); // 8 h 30 en hiver
  assert(inSendingWindow(at("2026-10-10T10:00:00Z"))); // samedi
});
