import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { createHmac } from "node:crypto";
import { clientSmsBody, handleIncomingCall } from "../_shared/missed-call.ts";
import { handleIncomingSms, isStopRequest } from "../_shared/incoming-sms.ts";
import { formatFrench, isHiddenCaller, toE164 } from "../_shared/phone.ts";
import { isValidTwilioSignature } from "../_shared/twilio.ts";
import type { Artisan, CallOutcome, Lead, MessageDirection, Store } from "../_shared/types.ts";

// ---------- Faux Store en mémoire ----------

interface MemLead extends Lead { created_at: Date; replied_at?: Date; opted_out: boolean; status: string }

function memoryStore(artisans: Artisan[]) {
  const calls = new Map<string, { outcome: CallOutcome; leadId?: string }>();
  const leads: MemLead[] = [];
  const messages: { direction: MessageDirection; body: string; leadId: string | null }[] = [];
  let seq = 0;
  const store: Store = {
    findArtisanByRelay: (n) => Promise.resolve(artisans.find((a) => a.relay_number === n) ?? null),
    claimCall: ({ callSid, outcome }) => {
      if (calls.has(callSid)) return Promise.resolve(false);
      calls.set(callSid, { outcome });
      return Promise.resolve(true);
    },
    setCallOutcome: (sid, outcome, leadId) => {
      calls.set(sid, { outcome, leadId });
      return Promise.resolve();
    },
    findOpenLead: (aid, phone, since) =>
      Promise.resolve(
        leads.filter((l) => l.artisan_id === aid && l.client_phone === phone && l.status !== "closed" && l.created_at >= since).at(-1) ?? null,
      ),
    findLatestLead: (aid, phone) => Promise.resolve(leads.filter((l) => l.artisan_id === aid && l.client_phone === phone).at(-1) ?? null),
    createLead: ({ artisanId, clientPhone, publicToken }) => {
      const lead: MemLead = {
        id: `lead-${++seq}`, artisan_id: artisanId, client_phone: clientPhone, public_token: publicToken,
        call_count: 1, sms_sent_at: null, created_at: clock.now, opted_out: false, status: "new",
      };
      leads.push(lead);
      return Promise.resolve(lead);
    },
    recordRepeatCall: (id, count) => {
      leads.find((l) => l.id === id)!.call_count = count;
      return Promise.resolve();
    },
    markSmsSent: (id, at) => {
      leads.find((l) => l.id === id)!.sms_sent_at = at.toISOString();
      return Promise.resolve();
    },
    markReplied: (id, at, optedOut) => {
      const l = leads.find((l) => l.id === id)!;
      l.replied_at = at;
      if (optedOut) l.opted_out = true;
      return Promise.resolve();
    },
    insertMessage: ({ direction, body, leadId }) => {
      messages.push({ direction, body, leadId });
      return Promise.resolve();
    },
  };
  return { store, calls, leads, messages };
}

const clock = { now: new Date("2026-10-01T09:00:00Z") };
const HOUR = 60 * 60 * 1000;

const DUPONT: Artisan = { id: "a1", business_name: "Dupont Plomberie", owner_phone: "+33600000001", relay_number: "+33939000001" };
const CLIENT = "+33611223344";

function setup() {
  clock.now = new Date("2026-10-01T09:00:00Z");
  const mem = memoryStore([DUPONT]);
  const sent: { from: string; to: string; body: string }[] = [];
  const deps = {
    store: mem.store,
    sendSms: (from: string, to: string, body: string) => {
      sent.push({ from, to, body });
      return Promise.resolve({ sid: `SM${sent.length}` });
    },
    appUrl: "https://relais-artisan.fr/",
    now: () => clock.now,
    newToken: () => "tok123",
  };
  return { ...mem, sent, deps };
}

const call = (sid: string, from = CLIENT, to = DUPONT.relay_number) => ({ CallSid: sid, From: from, To: to });

// ---------- Appel manqué → SMS ----------

Deno.test("appel manqué : message vocal, création de la demande et SMS au client depuis le numéro relais", async () => {
  const { deps, sent, leads, calls, messages } = setup();
  const res = await handleIncomingCall(call("CA1"), deps);

  assertStringIncludes(res.speech, "Dupont Plomberie");
  assertStringIncludes(res.speech, "SMS");
  assertEquals(sent.length, 0, "le SMS part après la réponse à Twilio, pas avant");

  await res.afterResponse!();
  assertEquals(sent, [{
    from: DUPONT.relay_number,
    to: CLIENT,
    body: clientSmsBody("Dupont Plomberie", "https://relais-artisan.fr/d/tok123"),
  }]);
  assertEquals(leads.length, 1);
  assert(leads[0].sms_sent_at);
  assertEquals(calls.get("CA1")?.outcome, "sms_sent");
  assertEquals(messages.map((m) => m.direction), ["outbound_client"]);
});

Deno.test("webhook renvoyé par Twilio (même CallSid) : pas de second SMS", async () => {
  const { deps, sent } = setup();
  await (await handleIncomingCall(call("CA1"), deps)).afterResponse!();
  const retry = await handleIncomingCall(call("CA1"), deps);
  assertEquals(retry.afterResponse, undefined);
  assertEquals(sent.length, 1);
});

Deno.test("le client rappelle 2 h plus tard : même demande, pas de nouveau SMS", async () => {
  const { deps, sent, leads, calls } = setup();
  await (await handleIncomingCall(call("CA1"), deps)).afterResponse!();
  clock.now = new Date(clock.now.getTime() + 2 * HOUR);
  const res = await handleIncomingCall(call("CA2"), deps);

  assertEquals(res.afterResponse, undefined);
  assertEquals(sent.length, 1);
  assertEquals(leads.length, 1);
  assertEquals(leads[0].call_count, 2);
  assertEquals(calls.get("CA2")?.outcome, "sms_skipped_recent");
});

Deno.test("le client rappelle 2 jours plus tard : même demande, nouveau SMS", async () => {
  const { deps, sent, leads } = setup();
  await (await handleIncomingCall(call("CA1"), deps)).afterResponse!();
  clock.now = new Date(clock.now.getTime() + 48 * HOUR);
  await (await handleIncomingCall(call("CA2"), deps)).afterResponse!();
  assertEquals(sent.length, 2);
  assertEquals(leads.length, 1);
});

Deno.test("numéro masqué : message vocal spécifique, aucun SMS", async () => {
  const { deps, sent, calls, leads } = setup();
  const res = await handleIncomingCall(call("CA1", "+266696687"), deps);
  assertStringIncludes(res.speech, "masqué");
  assertEquals(res.afterResponse, undefined);
  assertEquals(sent.length, 0);
  assertEquals(leads.length, 0);
  assertEquals(calls.get("CA1")?.outcome, "caller_hidden");
});

Deno.test("numéro relais inconnu : aucun SMS", async () => {
  const { deps, sent, calls } = setup();
  const res = await handleIncomingCall(call("CA1", CLIENT, "+33939999999"), deps);
  assertEquals(res.afterResponse, undefined);
  assertEquals(sent.length, 0);
  assertEquals(calls.get("CA1")?.outcome, "unknown_relay");
});

Deno.test("échec Twilio à l'envoi : appel marqué sms_failed, pas d'exception", async () => {
  const { deps, calls } = setup();
  deps.sendSms = () => Promise.reject(new Error("Twilio down"));
  await (await handleIncomingCall(call("CA1"), deps)).afterResponse!();
  assertEquals(calls.get("CA1")?.outcome, "sms_failed");
});

Deno.test("le SMS client tient en 1 seul SMS (160 caractères) pour un nom d'entreprise courant", () => {
  const body = clientSmsBody("Dupont Plomberie", "https://relais-artisan.fr/d/Ab3dEf7hJk");
  assert(body.length <= 160, `${body.length} caractères`);
  // Pas de caractère hors alphabet GSM-7 (sinon le SMS passe en UCS-2 : 70 caractères max).
  assert(!/[çâêîôûœ]/.test(body));
});

// ---------- Réponse SMS du client ----------

Deno.test("réponse du client : enregistrée et transférée à l'artisan", async () => {
  const { deps, sent, leads, messages } = setup();
  await (await handleIncomingCall(call("CA1"), deps)).afterResponse!();
  const after = await handleIncomingSms({ From: CLIENT, To: DUPONT.relay_number, Body: "Fuite sous l'évier", MessageSid: "SMx" }, deps);
  await after!();

  assert(leads[0].replied_at);
  assertEquals(sent.at(-1), { from: DUPONT.relay_number, to: DUPONT.owner_phone, body: "SMS de 06 11 22 33 44 : Fuite sous l'évier" });
  assertEquals(messages.map((m) => m.direction), ["outbound_client", "inbound_client", "outbound_artisan"]);
});

Deno.test("réponse STOP : le client est désinscrit et l'artisan prévenu", async () => {
  const { deps, sent, leads } = setup();
  await (await handleIncomingCall(call("CA1"), deps)).afterResponse!();
  await (await handleIncomingSms({ From: CLIENT, To: DUPONT.relay_number, Body: " stop " }, deps))!();
  assert(leads[0].opted_out);
  assertStringIncludes(sent.at(-1)!.body, "STOP");
});

Deno.test("SMS de l'artisan vers son propre relais : ignoré (pas de boucle)", async () => {
  const { deps, sent } = setup();
  const after = await handleIncomingSms({ From: DUPONT.owner_phone, To: DUPONT.relay_number, Body: "test" }, deps);
  assertEquals(after, undefined);
  assertEquals(sent.length, 0);
});

// ---------- Utilitaires ----------

Deno.test("signature Twilio : identique à une implémentation HMAC-SHA1 de référence", async () => {
  const token = "test-auth-token";
  const url = "https://abc.supabase.co/functions/v1/twilio-voice";
  const params = { To: "+33939000001", From: CLIENT, CallSid: "CA1", AccountSid: "AC1" };
  const payload = url + Object.keys(params).sort().map((k) => k + params[k as keyof typeof params]).join("");
  const expected = createHmac("sha1", token).update(payload).digest("base64");

  assert(await isValidTwilioSignature(token, expected, url, params));
  assert(!(await isValidTwilioSignature(token, expected, url, { ...params, From: "+33600000000" })));
  assert(!(await isValidTwilioSignature("autre-token", expected, url, params)));
  assert(!(await isValidTwilioSignature(token, null, url, params)));
});

Deno.test("numéros : normalisation, affichage, appelants masqués", () => {
  assertEquals(toE164("06 12 34 56 78"), "+33612345678");
  assertEquals(toE164("0033612345678"), "+33612345678");
  assertEquals(toE164("+33 6 12 34 56 78"), "+33612345678");
  assertEquals(formatFrench("+33612345678"), "06 12 34 56 78");
  assertEquals(formatFrench("+14155550100"), "+14155550100");
  assert(isHiddenCaller("Anonymous"));
  assert(isHiddenCaller(""));
  assert(!isHiddenCaller(CLIENT));
  assert(isStopRequest("Arrêt"));
  assert(!isStopRequest("stop la fuite svp"));
});
