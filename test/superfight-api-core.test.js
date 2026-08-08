import test from "node:test";
import assert from "node:assert/strict";

import { HttpError } from "../src/server/http.js";
import { confirmationState } from "../src/superfight/contracts.js";
import {
  belt,
  email,
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
  assert.equal(optionalText("   ", "Gym", 160), null);
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
