import { assertEquals } from "jsr:@std/assert@1";
import { interestOf } from "../_shared/survey.ts";

Deno.test("niveau d'intérêt : chaud / tiède / froid", () => {
  const base = { missed_calls: "3-5", after_miss: "call_back_evening", quotes_per_month: "6-15", follow_up: "sometimes" };
  assertEquals(interestOf({ ...base, would_pay: "yes_launch" }), "chaud");
  assertEquals(interestOf({ ...base, missed_calls: "1-2", follow_up: "never", would_pay: "yes_if_job" }), "chaud", "le problème = devis jamais relancés");
  assertEquals(interestOf({ ...base, would_pay: "maybe" }), "tiede");
  assertEquals(interestOf({ ...base, missed_calls: "1-2", after_miss: "call_back_hour", follow_up: "always", would_pay: "yes_launch" }), "tiede", "prêt à payer mais sans le problème");
  assertEquals(interestOf({ ...base, would_pay: "no_price" }), "froid");
  assertEquals(interestOf({ ...base, would_pay: "no_need" }), "froid");
  assertEquals(interestOf({ ...base, missed_calls: "0", follow_up: "always", would_pay: "yes_launch" }), "froid", "aucun appel manqué et relance toujours");
});
