import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  answerQuestion, checkSiret, complete, deleteTester, finishSurvey, getState, personalLinkSms, type ProgramDeps, referralLinkSms, thankYouSms, type ProgramStore, register, sendProof, skipSiret, type Tester, testDrive,
} from "../_shared/tester-program.ts";
import type { TesterDeps } from "../_shared/testers.ts";
import { sponsorSms } from "../_shared/tiers.ts";
import { isGsm7, toGsm7 } from "../_shared/twilio.ts";

function setup() {
  const testers: Tester[] = [];
  const referredBy = new Map<string, string | null>();
  const funnel: { tester: string; step: string; session: string | null }[] = [];
  const sent: { to: string; body: string }[] = [];
  const proofs: string[] = [];
  const completedTests = new Set<string>();
  let n = 0;

  const store: ProgramStore = {
    findByPhone: (p) => Promise.resolve(testers.find((t) => t.artisan.owner_phone === p) ?? null),
    findByToken: (tok) => Promise.resolve(testers.find((t) => t.token === tok) ?? null),
    findById: (id) => Promise.resolve(testers.find((t) => t.id === id) ?? null),
    findIdByReferralCode: (c) => Promise.resolve(testers.find((t) => t.referral_code === c)?.id ?? null),
    createTester: (nt) => {
      n++;
      const t: Tester = {
        id: `t${n}`, token: nt.token, referral_code: `code${n}`, first_name: nt.firstName, last_name: nt.lastName,
        siret_status: "none", completed_at: null, survey: {}, survey_completed_at: null, referred_by: nt.referredBy,
        artisan: { id: `a${n}`, business_name: nt.businessName, owner_phone: nt.phone, relay_number: null, siret: null, test_drives_used: 0, siret_company_name: null },
      };
      testers.push(t);
      referredBy.set(t.id, nt.referredBy);
      return Promise.resolve(t);
    },
    setSiretStatus: (id, status) => ((testers.find((t) => t.id === id)!.siret_status = status), Promise.resolve()),
    markCompleted: (id, at) => ((testers.find((t) => t.id === id)!.completed_at = at.toISOString()), Promise.resolve()),
    hasCompletedTest: (artisanId) => Promise.resolve(completedTests.has(artisanId)),
    referralCounts: (id) => {
      const kids = testers.filter((t) => referredBy.get(t.id) === id);
      return Promise.resolve({ registered: kids.length, counted: kids.filter((k) => k.completed_at !== null && completedTests.has(k.artisan.id)).length });
    },
    uploadProof: (path) => (proofs.push(path), Promise.resolve()),
    logFunnel: (tester, step, session) => (funnel.push({ tester, step, session }), Promise.resolve()),
    saveAnswers: (id, a) => ((testers.find((t) => t.id === id)!.survey = a), Promise.resolve()),
    completeSurvey: (id, interest, at) => {
      const t = testers.find((x) => x.id === id)! as Tester & { interest?: string };
      t.survey_completed_at = at.toISOString();
      t.interest = interest;
      return Promise.resolve();
    },
    deleteTester: (id) => (testers.splice(testers.findIndex((t) => t.id === id), 1), Promise.resolve()),
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
  return { deps, testers, funnel, sent, proofs, referredBy, completedTests };
}

const INFO = { businessName: "Dupont Plomberie", firstName: "Jean", lastName: "Dupont", phone: "06 12 34 56 78", trade: "Plombier", postalCode: "78140", sessionId: "session-123" };

Deno.test("inscription : testeur créé, aucun SMS RelaisArti (le 1er SMS sera l'essai), étape enregistrée", async () => {
  const { deps, sent, funnel, testers } = setup();
  const r = await register(INFO, deps);
  assert(r.ok && "token" in r.value);
  assertEquals(testers[0].artisan.owner_phone, "+33612345678");
  assertEquals(sent.length, 0);
  assertEquals(funnel[0], { tester: "t1", step: "info_submitted", session: "session-123" });
});

Deno.test("fin du parcours : remerciement avec lien de parrainage si SIRET, sans lien sinon ; une seule fois", async () => {
  const withSiret = setup();
  await register(INFO, withSiret.deps);
  await checkSiret("tok1", "92759307900050", null, withSiret.deps);
  await complete("tok1", null, withSiret.deps);
  await complete("tok1", null, withSiret.deps);
  assertEquals(withSiret.sent.length, 1);
  assertStringIncludes(withSiret.sent[0].body, "Merci Jean, vous voilà testeur fondateur");
  assertStringIncludes(withSiret.sent[0].body, "https://relaisarti.fr/testeurs?parrain=code1");

  const without = setup();
  await register(INFO, without.deps);
  await skipSiret("tok1", null, without.deps);
  await complete("tok1", null, without.deps);
  assertEquals(without.sent.length, 1);
  assertStringIncludes(without.sent[0].body, "vous voilà inscrit comme testeur");
  assert(!without.sent[0].body.includes("parrain"), "pas de lien sans SIRET");

  // SIRET ajouté après coup : le lien arrive par SMS.
  await checkSiret("tok1", "92759307900050", null, without.deps);
  assertEquals(without.sent.length, 2);
  assertStringIncludes(without.sent[1].body, "votre SIRET est enregistré");
  assertStringIncludes(without.sent[1].body, "parrain=code1");
});

Deno.test("inscription : validations, et numéro déjà inscrit → lien renvoyé par SMS sans être affiché", async () => {
  const { deps, sent } = setup();
  for (const bad of [{ businessName: "" }, { firstName: "" }, { phone: "01 39 00 00 00" }, { postalCode: "781" }]) {
    assertEquals((await register({ ...INFO, ...bad }, deps)).ok, false, JSON.stringify(bad));
  }
  await register(INFO, deps);
  const again = await register(INFO, deps);
  assert(again.ok && "existing" in again.value, "aucun jeton renvoyé à l'écran");
  assertEquals(sent.length, 1);
  assertStringIncludes(sent[0].body, "/testeurs/moi/tok1");
});

Deno.test("parrainage : le code du lien rattache le filleul ; seuls ceux allés au bout comptent (sans SIRET)", async () => {
  const { deps, referredBy, completedTests } = setup();
  await register(INFO, deps);
  await register({ ...INFO, phone: "0611111111", ref: "CODE1" }, deps);
  await register({ ...INFO, phone: "0622222222", ref: "code1" }, deps);
  assertEquals(referredBy.get("t2"), "t1");
  completedTests.add("a2");
  await skipSiret("tok2", null, deps);
  await complete("tok2", null, deps);
  const s = await getState("tok1", deps);
  assert(s.ok);
  assertEquals(s.value.referrals, { registered: 2, counted: 1 });
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

Deno.test("SMS RelaisArti : chacun tient en 1 SMS GSM-7", () => {
  const ref = "https://relaisarti.pages.dev/testeurs?parrain=abc1234";
  for (const body of [
    personalLinkSms("Jean-Baptiste", "https://relaisarti.pages.dev/testeurs/moi/AbCdEfGhJkMnPqRs"),
    thankYouSms("Jean-Baptiste", ref),
    thankYouSms("Jean-Baptiste", null),
    referralLinkSms("Jean-Baptiste", ref),
  ]) {
    const g = toGsm7(body);
    assert(isGsm7(g));
    assert(g.length <= 160, `${g.length} : ${g}`);
  }
});

Deno.test("suppression des données : le lien ne fonctionne plus ensuite", async () => {
  const { deps, testers } = setup();
  await register(INFO, deps);
  assert((await deleteTester("tok1", deps)).ok);
  assertEquals(testers.length, 0);
  assertEquals((await getState("tok1", deps)).ok, false);
  assertEquals((await deleteTester("tok1", deps)).ok, false);
});

Deno.test("questions : chaque réponse enregistrée et tracée ; réponse hors liste refusée ; fin seulement si tout est répondu", async () => {
  const { deps, funnel, testers } = setup();
  await register(INFO, deps);
  assert(!(await answerQuestion("tok1", "missed_calls", "beaucoup", null, deps)).ok, "valeur hors liste");
  assert(!(await answerQuestion("tok1", "inconnue", "1-2", null, deps)).ok, "question inconnue");
  assert((await answerQuestion("tok1", "missed_calls", "6-10", "s1", deps)).ok);
  assert(!(await finishSurvey("tok1", null, deps)).ok, "pas fini");
  for (const [q, v] of [["after_miss", "forget"], ["quotes_per_month", "6-15"], ["follow_up", "rarely"], ["would_pay", "yes_launch"], ["free_text", "Un appel test gratuit"]]) {
    assert((await answerQuestion("tok1", q, v, "s1", deps)).ok, q);
  }
  const done = await finishSurvey("tok1", null, deps);
  assert(done.ok && done.value.interest === "chaud");
  assertEquals(testers[0].survey.missed_calls, "6-10");
  assertEquals(funnel.filter((f) => f.step === "survey_answer").length, 6);
  assertEquals(funnel.filter((f) => f.step === "survey_completed").length, 1);
  const s = await getState("tok1", deps);
  assert(s.ok && s.value.surveyDone && s.value.answers.would_pay === "yes_launch");
});

Deno.test("état : « essai fait » seulement quand la demande d'essai a été remplie", async () => {
  const { deps, completedTests } = setup();
  await register(INFO, deps);
  await testDrive("tok1", null, deps);
  const before = await getState("tok1", deps);
  assert(before.ok && before.value.testDrivesUsed === 1 && before.value.testCompleted === false);
  completedTests.add("a1");
  const after = await getState("tok1", deps);
  assert(after.ok && after.value.testCompleted === true);
});

Deno.test("SMS au parrain : à chaque filleul allé au bout (essai fait), progression ou palier, toujours avec son lien", async () => {
  const { deps, sent, completedTests } = setup();
  await register({ ...INFO, firstName: "Jean" }, deps); // parrain t1, code1
  const finish = async (n: number, phone: string, name: string, essai = true) => {
    await register({ ...INFO, firstName: name, phone, ref: "code1" }, deps);
    if (essai) completedTests.add(`a${n}`);
    await complete(`tok${n}`, null, deps);
  };
  await finish(2, "0611111111", "Marc");
  const toSponsor = () => sent.filter((m) => m.to === "+33612345678");
  assertStringIncludes(toSponsor()[0].body, "Bravo Jean ! Avec Marc, vous avez 1 confrère : « Membre fondateur » débloqué.");
  assertStringIncludes(toSponsor()[0].body, "https://relaisarti.fr/testeurs?parrain=code1");
  await finish(3, "0622222222", "Paul");
  assertStringIncludes(toSponsor()[1].body, "Paul s'est inscrit grâce à vous, merci ! 2 sur 3 pour « Tarif fondateur »");
  await finish(4, "0633333333", "Luc", false); // essai non fait : pas compté, pas de SMS
  assertEquals(toSponsor().length, 2);
  await complete("tok3", null, deps); // pas de second SMS pour le même filleul
  assertEquals(toSponsor().length, 2);
});

Deno.test("SMS au parrain : 1 SMS GSM-7 dans tous les cas", () => {
  const link = "https://relaisarti.pages.dev/testeurs?parrain=abc1234";
  for (const n of [1, 2, 3, 4, 5, 7, 10]) {
    const g = toGsm7(sponsorSms("Jean-Baptiste", "Marie-Christine", n, link));
    assert(isGsm7(g), g);
    assert(g.length <= 160, `${n} : ${g.length} ${g}`);
  }
});
