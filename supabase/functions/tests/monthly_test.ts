import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { isMonthlyTime, type MonthFigures, monthlyBody, previousMonth, runMonthly } from "../_shared/monthly.ts";
import { isGsm7, toGsm7 } from "../_shared/twilio.ts";

const LINK = "https://relais-artisan.pages.dev/app/b/2026-09";
const OCT1_9H = new Date("2026-10-01T07:05:00Z"); // 1er octobre, 9 h 05 à Paris (UTC+2)

Deno.test("mois écoulé : bornes à minuit heure de Paris (été / hiver) et changement d'année", () => {
  const sep = previousMonth(OCT1_9H);
  assertEquals(sep.key, "2026-09");
  assertEquals(sep.label, "Septembre");
  assertEquals(sep.from.toISOString(), "2026-08-31T22:00:00.000Z"); // 1er sept. 0 h Paris (UTC+2)
  assertEquals(sep.to.toISOString(), "2026-09-30T22:00:00.000Z");
  const dec = previousMonth(new Date("2027-01-01T08:30:00Z"));
  assertEquals(dec.key, "2026-12");
  assertEquals(dec.from.toISOString(), "2026-11-30T23:00:00.000Z"); // hiver (UTC+1)
  assertEquals(dec.to.toISOString(), "2026-12-31T23:00:00.000Z");
});

Deno.test("horaire : le 1er du mois entre 9 h et 10 h à Paris seulement", () => {
  assert(isMonthlyTime(OCT1_9H));
  assert(!isMonthlyTime(new Date("2026-10-01T06:59:00Z"))); // 8 h 59
  assert(!isMonthlyTime(new Date("2026-10-02T07:05:00Z"))); // le 2
  assert(isMonthlyTime(new Date("2026-12-01T08:10:00Z"))); // 9 h 10 en hiver
});

const F = (p: Partial<MonthFigures>): MonthFigures => ({ wonCents: 0, wonCount: 0, missedCalls: 0, requests: 0, ...p });

Deno.test("texte : chiffres du mois, meilleur mois seulement si vrai, relance à classer si rien de gagné", () => {
  const best = monthlyBody("Septembre", F({ wonCents: 527000, wonCount: 3, missedCalls: 14, requests: 9 }), 300000, LINK)!;
  assertStringIncludes(best, "Septembre : 5 270 € signés (3 chantiers), 14 appels récupérés, 9 demandes.");
  assertStringIncludes(best, "Votre meilleur mois !");

  assert(!monthlyBody("Septembre", F({ wonCents: 100000, wonCount: 1 }), 300000, LINK)!.includes("meilleur"));
  assert(!monthlyBody("Septembre", F({ wonCents: 100000, wonCount: 1 }), 0, LINK)!.includes("meilleur"), "pas de « meilleur » le 1er mois");

  const noWin = monthlyBody("Septembre", F({ missedCalls: 4, requests: 2 }), 0, LINK)!;
  assertStringIncludes(noWin, "Pensez à classer vos devis.");
  assertEquals(monthlyBody("Septembre", F({}), 0, LINK), null);
});

Deno.test("texte : 1 seul SMS (GSM-7, 160 caractères) même avec de gros chiffres", () => {
  const body = toGsm7(monthlyBody("Septembre", F({ wonCents: 12345600, wonCount: 12, missedCalls: 148, requests: 97 }), 100, LINK)!);
  assert(isGsm7(body), body);
  assert(body.length <= 160, `${body.length} : ${body}`);
});

Deno.test("envoi : une seule fois par mois, rien si mois vide, rien hors du 1er à 9 h", async () => {
  const claimed = new Set<string>();
  const sent: string[] = [];
  let figures = F({ wonCents: 50000, wonCount: 1, missedCalls: 3 });
  const deps = {
    store: {
      candidates: () => Promise.resolve([{ id: "a1", owner_phone: "+33759981184", relay_number: "+18654892655" }]),
      figures: () => Promise.resolve(figures),
      bestPreviousWonCents: () => Promise.resolve(0),
      claim: (id: string, m: string) => Promise.resolve(!claimed.has(id + m) && !!claimed.add(id + m)),
    },
    sendSms: (_f: string, _t: string, body: string) => (sent.push(body), Promise.resolve({ sid: "SM" })),
    appUrl: "https://relais-artisan.pages.dev",
    now: () => OCT1_9H,
  };
  assertEquals(await runMonthly(deps), { sent: 1, skippedEmpty: 0 });
  assertEquals(await runMonthly(deps), { sent: 0, skippedEmpty: 0 });
  assertStringIncludes(sent[0], "/app/b/2026-09");

  figures = F({});
  claimed.clear();
  assertEquals(await runMonthly(deps), { sent: 0, skippedEmpty: 1 });
  deps.now = () => new Date("2026-10-15T07:05:00Z");
  figures = F({ wonCount: 1, wonCents: 100 });
  assertEquals((await runMonthly(deps)).sent, 0);
});
