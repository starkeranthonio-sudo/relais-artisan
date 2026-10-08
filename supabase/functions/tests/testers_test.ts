import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { isValidSiretFormat, MAX_TEST_DRIVES, type SiretLookup, startTestDrive, type TesterArtisan, type TesterDeps, verifySiret } from "../_shared/testers.ts";

const TESTER: TesterArtisan = {
  id: "a1", business_name: "Starker", owner_phone: "+33759981184", relay_number: null, sms_sender: "Starker",
  client_sms_template: "Ici {nom}, dites-moi tout : {lien}", siret: null,
};

function setup() {
  let used = 0;
  const leads: { artisanId: string; clientPhone: string; token: string }[] = [];
  const sent: { to: string; body: string; sender?: string }[] = [];
  const sirets = new Map<string, string>([["92759307900050", "autre-compte"]]);
  const deps: TesterDeps = {
    store: {
      claimTestDrive: () => Promise.resolve(used < MAX_TEST_DRIVES ? (used++, true) : false),
      releaseTestDrive: () => ((used--), Promise.resolve()),
      createTestLead: (artisanId, clientPhone, token) => (leads.push({ artisanId, clientPhone, token }), Promise.resolve(`lead-${leads.length}`)),
      logClientSms: () => Promise.resolve(),
      saveSiret: (id, siret) => {
        if (sirets.has(siret) && sirets.get(siret) !== id) return Promise.resolve(false);
        sirets.set(siret, id);
        return Promise.resolve(true);
      },
    },
    sendSms: (_from, to, body, sender) => (sent.push({ to, body, sender }), Promise.resolve({ sid: "SM" })),
    appUrl: "https://relais-artisan.pages.dev",
    newToken: () => "tok123",
    lookupSiret: (siret) => Promise.resolve(LOOKUPS[siret] ?? null),
  };
  return { deps, sent, leads, used: () => used };
}

// SIRET au format valide (clé de Luhn correcte) pour les cas de test.
const LOOKUPS: Record<string, SiretLookup> = {
  "92759307900050": { siret: "92759307900050", companyName: "AZUR PLOMBERIE", section: "F", active: true },
  "73282932000074": { siret: "73282932000074", companyName: "BOULANGERIE TEST", section: "C", active: true },
  "40483304800022": { siret: "40483304800022", companyName: "PLOMBERIE FERMEE", section: "F", active: false },
};

Deno.test("essai : l'artisan reçoit le SMS client, à son nom, avec son message et un vrai lien de demande", async () => {
  const { deps, sent, leads } = setup();
  assert((await startTestDrive(TESTER, deps)).ok);
  assertEquals(leads, [{ artisanId: "a1", clientPhone: "+33759981184", token: "tok123" }]);
  assertEquals(sent[0].to, "+33759981184");
  assertEquals(sent[0].sender, "Starker");
  assertEquals(sent[0].body, "Ici Starker, dites-moi tout : https://relais-artisan.pages.dev/d/tok123");
});

Deno.test("essai : 3 au maximum ; un échec d'envoi ne consomme pas d'essai", async () => {
  const { deps, used } = setup();
  for (let i = 0; i < MAX_TEST_DRIVES; i++) assert((await startTestDrive(TESTER, deps)).ok);
  const fourth = await startTestDrive(TESTER, deps);
  assert(!fourth.ok && fourth.status === 429);

  const s2 = setup();
  s2.deps.sendSms = () => Promise.reject(new Error("down"));
  const failed = await startTestDrive(TESTER, s2.deps);
  assert(!failed.ok && failed.status === 502);
  assertEquals(s2.used(), 0);
  assertEquals(used(), MAX_TEST_DRIVES);
});

Deno.test("SIRET : format et clé de Luhn", () => {
  assert(isValidSiretFormat("92759307900050"));
  assert(!isValidSiretFormat("92759307900051"), "clé fausse");
  assert(!isValidSiretFormat("9275930790005"), "13 chiffres");
  assert(!isValidSiretFormat("ABCDEFGHIJKLMN"));
});

Deno.test("SIRET : entreprise du bâtiment active → vérifié ; refus sinon", async () => {
  const { deps } = setup();
  const other = { ...TESTER, id: "a2" };
  const ok = await verifySiret(other, "927 593 079 00050", deps);
  assert(!ok.ok && ok.status === 409, "déjà rattaché à un autre compte");

  const fresh = setup();
  fresh.deps.store.saveSiret = () => Promise.resolve(true);
  const verified = await verifySiret(TESTER, "92759307900050", fresh.deps);
  assert(verified.ok);
  assertEquals(verified.value.companyName, "AZUR PLOMBERIE");

  const notBuilding = await verifySiret(TESTER, "73282932000074", deps);
  assert(!notBuilding.ok);
  assertStringIncludes(notBuilding.error, "bâtiment");
  const closed = await verifySiret(TESTER, "40483304800022", deps);
  assert(!closed.ok);
  assertStringIncludes(closed.error, "fermé");
  const unknown = await verifySiret(TESTER, "55203253400646", deps);
  assert(!unknown.ok && unknown.status === 404);
  assertStringIncludes(unknown.error, "vérification manuelle");
  const bad = await verifySiret(TESTER, "12345678901234", deps);
  assert(!bad.ok && bad.status === 400);
});

Deno.test("SIRET : base Sirene indisponible → message clair, rien n'est enregistré", async () => {
  const { deps } = setup();
  deps.lookupSiret = () => Promise.reject(new Error("timeout"));
  const r = await verifySiret(TESTER, "92759307900050", deps);
  assert(!r.ok && r.status === 503);
});
