import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { isRecapTime, parisDate, recapBody, type RecapContent, type RecapDeps, runRecap } from "../_shared/recap.ts";
import { isGsm7, toGsm7 } from "../_shared/twilio.ts";

const LINK = "https://relais-artisan.pages.dev/app/r";
const EMPTY: RecapContent = { toCall: [], repliedQuotes: 0, quotesToClose: 0 };
const WED_18H = new Date("2026-10-07T16:10:00Z"); // mercredi 18 h 10 à Paris (UTC+2)

Deno.test("texte : clients à rappeler avec 2 noms, réponses et devis à classer", () => {
  const body = recapBody({ toCall: ["Marie", "M. Leroy", "Karim"], repliedQuotes: 1, quotesToClose: 2 }, LINK)!;
  assertStringIncludes(body, "3 clients à rappeler (Marie, M. Leroy…)");
  assertStringIncludes(body, "1 réponse à vos devis");
  assertStringIncludes(body, "2 devis à classer");
  assert(body.endsWith(LINK));
});

Deno.test("texte : rien à faire → pas de SMS", () => {
  assertEquals(recapBody(EMPTY, LINK), null);
});

Deno.test("texte : toujours 1 seul SMS (160 caractères GSM-7), même avec des noms longs", () => {
  const cases: RecapContent[] = [
    { toCall: ["Marie"], repliedQuotes: 0, quotesToClose: 0 },
    { toCall: ["Marie-Christine Dupont-Leroy", "Jean-Baptiste Martin-Durand", "X"], repliedQuotes: 3, quotesToClose: 4 },
    { toCall: [], repliedQuotes: 2, quotesToClose: 1 },
    { toCall: ["06 11 22 33 44", "06 55 66 77 88"], repliedQuotes: 1, quotesToClose: 1 },
  ];
  for (const c of cases) {
    const body = toGsm7(recapBody(c, LINK)!);
    assert(body.length <= 160, `${body.length} caractères : ${body}`);
    assert(isGsm7(body));
  }
});

Deno.test("horaire : lundi-samedi de 18 h à 19 h heure de Paris (été et hiver), jamais le dimanche", () => {
  assert(isRecapTime(WED_18H));
  assert(!isRecapTime(new Date("2026-10-07T15:59:00Z"))); // 17 h 59
  assert(!isRecapTime(new Date("2026-10-07T17:00:00Z"))); // 19 h
  assert(isRecapTime(new Date("2026-12-09T17:30:00Z"))); // 18 h 30 en hiver (UTC+1)
  assert(!isRecapTime(new Date("2026-10-11T16:10:00Z"))); // dimanche
  assertEquals(parisDate(new Date("2026-10-07T22:30:00Z")), "2026-10-08"); // 0 h 30 à Paris = lendemain
});

function setup(content: RecapContent) {
  const claimed = new Set<string>();
  const sent: { from: string; to: string; body: string }[] = [];
  const deps: RecapDeps = {
    store: {
      candidates: () => Promise.resolve([{ id: "a1", owner_phone: "+33759981184", relay_number: "+18654892655" }]),
      content: () => Promise.resolve(content),
      claim: (id, today) => {
        const key = `${id}:${today}`;
        if (claimed.has(key)) return Promise.resolve(false);
        claimed.add(key);
        return Promise.resolve(true);
      },
    },
    sendSms: (from, to, body) => (sent.push({ from, to, body }), Promise.resolve({ sid: "SM" })),
    appUrl: "https://relais-artisan.pages.dev",
    now: () => WED_18H,
  };
  return { deps, sent };
}

Deno.test("envoi : un seul récap par jour même si le planificateur passe plusieurs fois", async () => {
  const { deps, sent } = setup({ toCall: ["Marie"], repliedQuotes: 0, quotesToClose: 0 });
  assertEquals(await runRecap(deps), { sent: 1, skippedEmpty: 0 });
  assertEquals(await runRecap(deps), { sent: 0, skippedEmpty: 0 });
  assertEquals(sent.length, 1);
  assertEquals(sent[0].to, "+33759981184");
  assertEquals(sent[0].from, "+18654892655");
});

Deno.test("envoi : hors de 18 h rien ne part ; journée vide → pas de SMS", async () => {
  const early = setup({ toCall: ["Marie"], repliedQuotes: 0, quotesToClose: 0 });
  early.deps.now = () => new Date("2026-10-07T14:00:00Z");
  assertEquals((await runRecap(early.deps)).sent, 0);

  const empty = setup(EMPTY);
  assertEquals(await runRecap(empty.deps), { sent: 0, skippedEmpty: 1 });
  assertEquals(empty.sent.length, 0);
});

Deno.test("envoi : vide à 18 h 00, puis une demande arrive → le passage de 18 h 30 envoie le récap", async () => {
  const content: RecapContent = { toCall: [], repliedQuotes: 0, quotesToClose: 0 };
  const { deps, sent } = setup(content);
  assertEquals((await runRecap(deps)).skippedEmpty, 1);
  content.toCall.push("Marie");
  deps.now = () => new Date("2026-10-07T16:30:00Z");
  assertEquals((await runRecap(deps)).sent, 1);
  assertEquals(sent.length, 1);
});
