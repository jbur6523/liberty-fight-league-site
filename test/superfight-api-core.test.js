import test from "node:test";
import assert from "node:assert/strict";

import { HttpError } from "../src/server/http.js";
import { confirmationState } from "../src/superfight/contracts.js";
import {
  belt,
  boutType,
  competitorAge,
  email,
  genderDivision,
  grapplingPreference,
  optionalText,
  positiveWeight,
  uuid,
} from "../src/superfight/validation.js";

const fighterAId = "00000000-0000-4000-8000-000000000001";
const fighterBId = "00000000-0000-4000-8000-000000000002";

test("confirmation summaries support every promoter-facing state", () => {
  assert.deepEqual(confirmationState([], fighterAId, fighterBId), {
    fighterA: "awaiting",
    fighterB: "awaiting",
    summary: "awaiting_confirmation",
  });

  assert.equal(
    confirmationState([{ competitor_id: fighterAId, response: "accepted" }], fighterAId, fighterBId).summary,
    "fighter_a_accepted",
  );
  assert.equal(
    confirmationState([{ competitor_id: fighterBId, response: "accepted" }], fighterAId, fighterBId).summary,
    "fighter_b_accepted",
  );
  assert.equal(
    confirmationState([
      { competitor_id: fighterAId, response: "accepted" },
      { competitor_id: fighterBId, response: "accepted" },
    ], fighterAId, fighterBId).summary,
    "both_accepted",
  );
  assert.equal(
    confirmationState([{ competitor_id: fighterAId, response: "declined" }], fighterAId, fighterBId).summary,
    "declined",
  );
});

test("quick-add validation allows intentionally incomplete secondary fields", () => {
  assert.equal(belt(null, { optional: true }), null);
  assert.equal(email("", { optional: true }), null);
  assert.equal(positiveWeight(undefined, { optional: true }), null);
  assert.equal(competitorAge("", { optional: true }), null);
  assert.equal(genderDivision(null, { optional: true }), null);
  assert.equal(grapplingPreference("", { optional: true }), null);
  assert.equal(optionalText("   ", "Gym", 160), null);
});

test("competitor profile and bout values are structured and validated", () => {
  assert.equal(competitorAge("27"), 27);
  assert.equal(genderDivision("MENS"), "mens");
  assert.equal(grapplingPreference("no_gi"), "no_gi");
  assert.equal(grapplingPreference("both"), "both");
  assert.equal(boutType("gi"), "gi");
  assert.throws(() => competitorAge("27.5"), /valid age/);
  assert.throws(() => genderDivision("open"), /valid gender/);
  assert.throws(() => grapplingPreference("either"), /valid gi \/ no-gi preference/i);
  assert.throws(() => boutType("both"), /valid bout type/);
});

test("public validation accepts secure UUID tokens and rejects guessable identifiers", () => {
  assert.equal(uuid(fighterAId, "Status link"), fighterAId);
  assert.throws(
    () => uuid("smith", "Status link"),
    (error) => error instanceof HttpError && error.code === "invalid_identifier",
  );
});

test("belt and weight validation reject unsupported business values", () => {
  assert.throws(() => belt("white"), /valid belt/);
  assert.throws(() => positiveWeight(-1), /valid competition weight/);
});
