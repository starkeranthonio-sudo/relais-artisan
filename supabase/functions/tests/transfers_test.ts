import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { isGsm7, toGsm7 } from "../_shared/twilio.ts";
import {
  acceptTransfer, cityOf, createTransfer, declineTransfer, invitationSms, previewTransfer,
  type Transfer, type TransferArtisan, type TransferDeps, type TransferLead, type TransferStore,
} from "../_shared/transfers.ts";

const NOW = new Date("2026-10-08T09:00:00Z");
const A: TransferArtisan = { id: "A", business_name: "Dupont Plomberie", owner_phone: "+33600000001", relay_number: "+33939000001", referred_by: null, created_at: "2026-01-01T00:00:00Z" };
const B: TransferArtisan = { id: "B", business_name: "Martin Elec", owner_phone: "+33600000002", relay_number: null, referred_by: null, created_at: "2026-10-08T09:30:00Z" };
const OLD_MEMBER: TransferArtisan = { ...B, id: "C", business_name: "Elec Ancien", owner_phone: "+33600000003", created_at: "2026-03-01T00:00:00Z" };

function setup() {
  const lead: TransferLead = {
    id: "L1", artisan_id: "A", client_phone: "+33611223344", work_type: "Électricité",
    address: "12 Rue de la Forêt 78140 Vélizy-Villacoublay", urgency: "urgent",
    ai_summary: "Plus de courant dans la cuisine, disjoncteur qui saute.", status: "form_submitted", has_quote: false,
  };
  const transfers: (Transfer & { invitee_was_member: boolean })[] = [];
  const referrals: Record<string, string> = {};
  const sent: { from: string; to: string; body: string }[] = [];
  const members = [A, OLD_MEMBER];

  const store: TransferStore = {
    getLead: (id) => Promise.resolve(id === lead.id ? lead : null),
    findArtisanByPhone: (p) => Promise.resolve(members.find((m) => m.owner_phone === p) ?? null),
    hasPendingTransfer: (id) => Promise.resolve(transfers.some((t) => t.lead.id === id && t.status === "pending")),
    createTransfer: (t) => {
      transfers.push({
        id: `T${transfers.length + 1}`, token: t.token, status: "pending", note: t.note, created_at: NOW.toISOString(),
        expires_at: t.expiresAt.toISOString(), to_artisan_id: null, from: A, lead, invitee_was_member: t.inviteeWasMember,
      });
      return Promise.resolve();
    },
    getTransfer: (token) => Promise.resolve(transfers.find((t) => t.token === token) ?? null),
    accept: (id, to) => {
      const t = transfers.find((x) => x.id === id)!;
      if (t.status !== "pending") return Promise.resolve(false);
      t.status = "accepted";
      t.to_artisan_id = to;
      lead.artisan_id = to;
      return Promise.resolve(true);
    },
    decline: (id, to) => {
      const t = transfers.find((x) => x.id === id)!;
      if (t.status !== "pending") return Promise.resolve(false);
      t.status = "declined";
      t.to_artisan_id = to;
      return Promise.resolve(true);
    },
    setReferrer: (id, ref) => ((referrals[id] = ref), Promise.resolve()),
  };
  let n = 0;
  const deps: TransferDeps = {
    store,
    sendSms: (from, to, body) => (sent.push({ from, to, body }), Promise.resolve({ sid: "SM" })),
    appUrl: "https://relais-artisan.fr",
    now: () => NOW,
    newToken: () => `tok${++n}`,
  };
  return { lead, transfers, referrals, sent, deps };
}

Deno.test("confrère non inscrit : invitation à créer son compte, sans l'adresse ni le client", async () => {
  const { deps, sent, transfers } = setup();
  const res = await createTransfer({ from: A, leadId: "L1", phone: "06 00 00 00 02", note: "Bon client" }, deps);
  assert(res.ok);
  assertEquals(res.value.inviteeWasMember, false);
  assertEquals(transfers[0].invitee_was_member, false);
  assertEquals(sent.length, 1);
  assertEquals(sent[0].to, "+33600000002");
  assertEquals(sent[0].from, A.relay_number);
  assertStringIncludes(sent[0].body, "Compte gratuit pour le contacter");
  assertStringIncludes(sent[0].body, "Électricité - Vélizy-Villacoublay");
  assertStringIncludes(sent[0].body, "https://relais-artisan.fr/t/tok1");
  assert(!sent[0].body.includes("Rue de la Forêt") && !sent[0].body.includes("11 22 33"), "pas d'adresse ni de numéro client");
});

Deno.test("confrère déjà inscrit : SMS « Voir la demande »", async () => {
  const { deps, sent } = setup();
  const res = await createTransfer({ from: A, leadId: "L1", phone: "0600000003" }, deps);
  assert(res.ok && res.value.inviteeWasMember);
  assertStringIncludes(sent[0].body, "Voir la demande");
});

Deno.test("refus : numéro invalide, son propre numéro, demande d'un autre, demande avec devis, double transmission", async () => {
  const { deps, lead } = setup();
  assertEquals((await createTransfer({ from: A, leadId: "L1", phone: "0139000000" }, deps)) as unknown, { ok: false, status: 400, error: "Numéro de portable invalide (ex. : 06 12 34 56 78)." });
  assertEquals((await createTransfer({ from: A, leadId: "L1", phone: "0600000001" }, deps)).ok, false);
  assertEquals((await createTransfer({ from: B, leadId: "L1", phone: "0600000003" }, deps)).ok, false);
  assert((await createTransfer({ from: A, leadId: "L1", phone: "0600000002" }, deps)).ok);
  const again = await createTransfer({ from: A, leadId: "L1", phone: "0600000003" }, deps);
  assert(!again.ok && again.status === 409);
  lead.has_quote = true;
  const quoted = await createTransfer({ from: A, leadId: "L1", phone: "0600000003" }, deps);
  assert(!quoted.ok && quoted.status === 409);
});

Deno.test("aperçu public : la ville et le résumé, jamais les coordonnées du client", async () => {
  const { deps } = setup();
  await createTransfer({ from: A, leadId: "L1", phone: "0600000002", note: "Bon client" }, deps);
  const p = await previewTransfer("tok1", null, deps);
  assert(p.ok);
  assertEquals(p.value.city, "Vélizy-Villacoublay");
  assertEquals(p.value.fromName, "Dupont Plomberie");
  assertEquals(p.value.note, "Bon client");
  assertEquals(p.value.leadId, null);
  assert(!JSON.stringify(p.value).includes("+336"), "aucun numéro dans l'aperçu");
  assert(!JSON.stringify(p.value).includes("Rue de la Forêt"));
});

Deno.test("acceptation par un nouvel inscrit : demande confiée, parrainage enregistré, A et le client prévenus", async () => {
  const { deps, lead, referrals, sent } = setup();
  await createTransfer({ from: A, leadId: "L1", phone: "0600000002" }, deps);
  const res = await acceptTransfer("tok1", B, deps);
  assert(res.ok);
  assertEquals(res.value.leadId, "L1");
  assertEquals(lead.artisan_id, "B");
  assertEquals(referrals, { B: "A" });
  const toA = sent.find((s) => s.to === A.owner_phone)!;
  const toClient = sent.find((s) => s.to === "+33611223344")!;
  assertStringIncludes(toA.body, "Martin Elec a accepté");
  assertStringIncludes(toClient.body, "vous met en relation avec Martin Elec");
  const p = await previewTransfer("tok1", B, deps);
  assert(p.ok && p.value.leadId === "L1", "le confrère qui a accepté peut ouvrir la fiche");
});

Deno.test("acceptation par un membre déjà inscrit : pas de parrainage", async () => {
  const { deps, referrals } = setup();
  await createTransfer({ from: A, leadId: "L1", phone: "0600000003" }, deps);
  assert((await acceptTransfer("tok1", OLD_MEMBER, deps)).ok);
  assertEquals(referrals, {});
});

Deno.test("un seul confrère peut prendre le client ; l'expéditeur ne peut pas accepter ; expiration", async () => {
  const { deps } = setup();
  await createTransfer({ from: A, leadId: "L1", phone: "0600000002" }, deps);
  assert(!(await acceptTransfer("tok1", A, deps)).ok);
  assert((await acceptTransfer("tok1", B, deps)).ok);
  const late = await acceptTransfer("tok1", OLD_MEMBER, deps);
  assert(!late.ok && late.status === 409);

  const s2 = setup();
  await createTransfer({ from: A, leadId: "L1", phone: "0600000002" }, s2.deps);
  s2.deps.now = () => new Date(NOW.getTime() + 8 * 86_400_000);
  const expired = await acceptTransfer("tok1", B, s2.deps);
  assert(!expired.ok && expired.status === 410);
  const p = await previewTransfer("tok1", null, s2.deps);
  assert(p.ok && p.value.status === "expired");
});

Deno.test("refus du confrère : A est prévenu, la demande reste chez A", async () => {
  const { deps, lead, sent } = setup();
  await createTransfer({ from: A, leadId: "L1", phone: "0600000002" }, deps);
  assert((await declineTransfer("tok1", B, deps)).ok);
  assertEquals(lead.artisan_id, "A");
  assertStringIncludes(sent.at(-1)!.body, "ne peut pas prendre le client");
});

Deno.test("SMS d'invitation : 1 SMS (après conversion GSM-7) pour un cas courant ; ville extraite de l'adresse", () => {
  const lead = { work_type: "Plomberie / fuite", address: "4 Avenue de l'Europe 78140 Vélizy-Villacoublay" } as TransferLead;
  for (const member of [true, false]) {
    const body = toGsm7(invitationSms("Dupont Plomberie", lead, "https://relais-artisan.fr/t/Ab3dEf7hJk", member));
    assert(isGsm7(body));
    assert(body.length <= 160, `${body.length} caractères`);
  }
  assertEquals(cityOf("12 rue des Lilas, Vélizy"), "Vélizy");
  assertEquals(cityOf(null), "");
});
