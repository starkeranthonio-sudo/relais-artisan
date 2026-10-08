import { assertEquals } from "jsr:@std/assert@1";
import { clientSmsBody, handleIncomingCall } from "../_shared/missed-call.ts";
import { twilioSender } from "../_shared/twilio.ts";
import type { Artisan, Store } from "../_shared/types.ts";

/** Remplace fetch le temps d'un test et renvoie le champ From envoyé à Twilio. */
async function fromSentToTwilio(send: () => Promise<unknown>): Promise<string> {
  const original = globalThis.fetch;
  let from = "";
  globalThis.fetch = (_url, init) => {
    from = new URLSearchParams(String(init?.body)).get("From") ?? "";
    return Promise.resolve(new Response(JSON.stringify({ sid: "SM1" }), { status: 201 }));
  };
  try {
    await send();
  } finally {
    globalThis.fetch = original;
  }
  return from;
}

Deno.test("expéditeur : nom de l'artisan en mode alphanumérique, sinon le nom par défaut, sinon le numéro relais", async () => {
  const alpha = twilioSender("AC1", "tok", "RelaisArt");
  const relayOnly = twilioSender("AC1", "tok", undefined);
  assertEquals(await fromSentToTwilio(() => alpha("+18654892655", "+33611223344", "x", "Starker")), "Starker");
  assertEquals(await fromSentToTwilio(() => alpha("+18654892655", "+33600000001", "x")), "RelaisArt", "SMS à l'artisan : nom par défaut");
  assertEquals(await fromSentToTwilio(() => alpha("+18654892655", "+33611223344", "x", "Plomb & Fils")), "RelaisArt", "nom invalide refusé");
  assertEquals(await fromSentToTwilio(() => alpha("+18654892655", "+33611223344", "x", "DouzeCaracts")), "RelaisArt", "plus de 11 caractères refusé");
  assertEquals(await fromSentToTwilio(() => alpha("+18654892655", "+33611223344", "x", "12345")), "RelaisArt", "chiffres seuls refusés");
  assertEquals(await fromSentToTwilio(() => relayOnly("+33939000001", "+33611223344", "x", "Starker")), "+33939000001", "avec un vrai numéro relais, le client peut répondre");
});

Deno.test("le SMS au client après un appel manqué part au nom de l'artisan", async () => {
  const artisan: Artisan = { id: "a1", business_name: "starker", owner_phone: "+33759981184", relay_number: "+18654892655", sms_sender: "Starker" };
  const senders: (string | undefined)[] = [];
  const store = {
    findArtisanByRelay: () => Promise.resolve(artisan),
    claimCall: () => Promise.resolve(true),
    setCallOutcome: () => Promise.resolve(),
    findOpenLead: () => Promise.resolve(null),
    createLead: () => Promise.resolve({ id: "l1", artisan_id: "a1", client_phone: "+33611223344", public_token: "t", call_count: 1, sms_sent_at: null }),
    markSmsSent: () => Promise.resolve(),
    insertMessage: () => Promise.resolve(),
  } as unknown as Store;
  const res = await handleIncomingCall({ CallSid: "CA1", From: "+33611223344", To: artisan.relay_number }, {
    store,
    sendSms: (_f, _t, _b, senderName) => (senders.push(senderName), Promise.resolve({ sid: "SM" })),
    appUrl: "https://relais-artisan.pages.dev",
  });
  await res.afterResponse!();
  assertEquals(senders, ["Starker"]);
});

Deno.test("SMS personnalisé : {nom} et {lien} remplacés ; texte par défaut si pas de {lien} ou trop long", () => {
  const link = "https://relais-artisan.pages.dev/d/Ab3dEf7hJk";
  assertEquals(
    clientSmsBody("Starker", link, "Bonjour, ici {nom}. Je suis sur un chantier, dites-moi tout ici : {lien}"),
    `Bonjour, ici Starker. Je suis sur un chantier, dites-moi tout ici : ${link}`,
  );
  const fallback = clientSmsBody("Starker", link);
  assertEquals(clientSmsBody("Starker", link, "Je vous rappelle très vite !"), fallback, "sans {lien}");
  assertEquals(clientSmsBody("Starker", link, "x".repeat(140) + " {lien}"), fallback, "trop long pour 1 SMS");
  assertEquals(clientSmsBody("Starker", link, null), fallback);
});
