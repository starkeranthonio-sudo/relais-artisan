import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  checkSiret, complete, getState, personalLinkSms, type ProgramDeps, type ProgramStore, register, sendProof, skipSiret, type Tester, testDrive,
} from "../_shared/tester-program.ts";
import type { TesterDeps } from "../_shared/testers.ts";
import { isGsm7, toGsm7 } from "../_shared/twilio.ts";

function setup() {
  const testers: Tester[] = [];
  const referredBy = new Map<string, string | null>();
  const funnel: { tester: string; step: string; session: string | null }[] = [];
  const sent: { to: string; body: string }[] = [];
  const proofs: string[] = [];
  let n = 0;

  const store: ProgramStore = {
    findByPhone: (p) => Promise.resolve(testers.find((t) => t.artisan.owner_phone === p) ?? null),
    findByToken: (tok) => Promise.resolve(testers.find((t) => t.token === tok) ?? null),
    findIdByReferralCode: (c) => Promise.resolve(testers.find((t) => t.referral_code === c)?.id ?? null),
    createTester: (nt) => {
      n++;
      const t: Tester = {
        id: `t${n}`, token: nt.token, referral_code: `code${n}`, first_name: nt.firstName, last_name: nt.lastName,
        siret_status: "none", completed_at: null,
        artisan: { id: `a${n}`, business_name: nt.businessName, owner_phone: nt.phone, relay_number: null, siret: null, test_drives_used: 0, siret_company_name: null },
      };
      testers.push(t);
      referredBy.set(t.id, nt.referredBy);
      return Promise.resolve(t);
    },
    setSiretStatus: (id, status) => ((testers.find((t) => t.id === id)!.siret_status = status), Promise.resolve()),
    markCompleted: (id, at) => ((testers.find((t) => t.id === id)!.completed_at = at.toISOString()), Promise.resolve()),
    referralCounts: (id) => {
      const kids = testers.filter((t) => referredBy.get(t.id) === id);
      return Promise.resolve({ registered: kids.length, verified: kids.filter((k) => k.siret_status === "verified").length });
    },
    uploadProof: (path) => (proofs.push(path), Promise.resolve()),
    logFunnel: (tester, step, session) => (funnel.push({ tester, step, session }), Promise.resolve()),
  };
  const testerDeps: TesterDeps = {
    store: {
      claimTestDrive: (id) => {
        const t = testers.find((x) => x.artisan.id === id)!;
        if (t.artisan.test_drives_used >= 3) return Promise.resolve(false);
        t.artisan.test_drives_used++;
        return Promise.resolve(true);
      },
      releaseTestDrive: () => Promise.resolve(),
      createTestLead: () => Promise.resolve("lead"),
      logClientSms: () => Promise.resolve(),
      saveSiret: () => Promise.resolve(true),
    },
    sendSms: (_f, to, body) => (sent.push({ to, body }), Promise.resolve({ sid: "SM" })),
    appUrl: "https://relaisarti.fr",
    lookupSiret: (s) => Promise.resolve(s === "92759307900050" ? { siret: s, companyName: "AZUR PLOMBERIE", section: "F", active: true } : null),
  };
  let tok = 0;
  const deps: ProgramDeps = {
    store, testerDeps,
    sendSms: (_f, to, body) => (sent.push({ to, body }), Promise.resolve({ sid: "SM" })),
    appUrl: "https://relaisarti.fr",
    newToken: () => `tok${++tok}`,
  };
  return { deps, testers, funnel, sent, proofs, referredBy };
}

const INFO = { businessName: "Dupont Plomberie", firstName: "Jean", lastName: "Dupont", phone: "06 12 34 56 78", trade: "Plombier", postalCode: "78140", sessionId: "session-123" };

Deno.test("inscription : testeur créé, lien personnel envoyé par SMS, étape enregistrée", async () => {
  const { deps, sent, funnel, testers } = setup();
  const r = await register(INFO, deps);
  assert(r.ok && "token" in r.value);
  assertEquals(testers[0].artisan.owner_phone, "+33612345678");
  assertEquals(sent[0].to, "+33612345678");
  assertStringIncludes(sent[0].body, "https://relaisarti.fr/testeurs/moi/tok1");
  assertEquals(funnel[0], { tester: "t1", step: "info_submitted", session: "session-123" });
});

Deno.test("inscription : validations, et numéro déjà inscrit → lien renvoyé par SMS sans être affiché", async () => {
  const { deps, sent } = setup();
  for (const bad of [{ businessName: "" }, { firstName: "" }, { phone: "01 39 00 00 00" }, { postalCode: "781" }]) {
    assertEquals((await register({ ...INFO, ...bad }, deps)).ok, false, JSON.stringify(bad));
  }
  await register(INFO, deps);
  const again = await register(INFO, deps);
  assert(again.ok && "existing" in again.value, "aucun jeton renvoyé à l'écran");
  assertEquals(sent.length, 2);
  assertStringIncludes(sent[1].body, "/testeurs/moi/tok1");
});

Deno.test("parrainage : le code du lien rattache le filleul ; seuls les filleuls vérifiés comptent", async () => {
  const { deps, testers, referredBy } = setup();
  await register(INFO, deps);
  await register({ ...INFO, phone: "0611111111", ref: "CODE1" }, deps);
  await register({ ...INFO, phone: "0622222222", ref: "code1" }, deps);
  assertEquals(referredBy.get("t2"), "t1");
  testers[1].siret_status = "verified";
  const s = await getState("tok1", deps);
  assert(s.ok);
  assertEquals(s.value.referrals, { registered: 2, verified: 1 });
});

Deno.test("lien de parrainage seulement avec un SIRET vérifié ou une photo de devis envoyée", async () => {
  const { deps } = setup();
  await register(INFO, deps);
  const before = await getState("tok1", deps);
  assert(before.ok && before.value.referralCode === null);
  assert((await checkSiret("tok1", "927 593 079 00050", "session-123", deps)).ok);
  const after = await getState("tok1", deps);
  assert(after.ok && after.value.referralCode === "code1" && after.value.siretStatus === "verified");
});

Deno.test("SIRET introuvable → code « not_found » ; photo de devis → vérification manuelle et lien de parrainage", async () => {
  const { deps, proofs, funnel } = setup();
  await register(INFO, deps);
  const r = await checkSiret("tok1", "55203253400646", null, deps);
  assert(!r.ok && (r as { code?: string }).code === "not_found");
  assert(!(await sendProof("tok1", { bytes: new Uint8Array(10), type: "image/gif" }, "", null, deps)).ok, "format refusé");
  assert((await sendProof("tok1", { bytes: new Uint8Array(10), type: "image/jpeg" }, "552 032 534 00646", null, deps)).ok);
  assertEquals(proofs.length, 1);
  const s = await getState("tok1", deps);
  assert(s.ok && s.value.siretStatus === "pending_manual" && s.value.referralCode === "code1");
  assert(funnel.some((f) => f.step === "siret_manual"));
});

Deno.test("essai (3 max), SIRET passé, parcours terminé une seule fois ; jeton inconnu refusé", async () => {
  const { deps, funnel } = setup();
  await register(INFO, deps);
  for (let i = 0; i < 3; i++) assert((await testDrive("tok1", null, deps)).ok);
  assert(!(await testDrive("tok1", null, deps)).ok);
  assert((await skipSiret("tok1", null, deps)).ok);
  assert((await complete("tok1", null, deps)).ok);
  assert((await complete("tok1", null, deps)).ok);
  assertEquals(funnel.filter((f) => f.step === "test_sent").length, 3);
  assertEquals(funnel.filter((f) => f.step === "completed").length, 1);
  assertEquals((await getState("inconnu", deps)).ok, false);
});

Deno.test("SMS du lien personnel : 1 SMS GSM-7", () => {
  const body = toGsm7(personalLinkSms("Jean-Baptiste", "https://relais-artisan.pages.dev/testeurs/moi/AbCdEfGhJkMnPqRs"));
  assert(isGsm7(body));
  assert(body.length <= 160, `${body.length} : ${body}`);
});
