import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { HttpError } from "../src/server/http.js";
import {
  formatPreferencesConflict,
  resolveMatchWeight,
} from "../src/superfight/match-agreement.js";

const featherId = "00000000-0000-4000-8000-000000000154";
const lightId = "00000000-0000-4000-8000-000000000168";

test("shared weight preferences retain contracted-class selection", () => {
  assert.deepEqual(resolveMatchWeight({
    sharedWeightOptionIds: [lightId],
    weightOptionId: lightId,
    agreedWeightLbs: "",
  }), { weightOptionId: lightId, matchWeightLbs: null });

  assert.throws(
    () => resolveMatchWeight({
      sharedWeightOptionIds: [lightId],
      weightOptionId: featherId,
      agreedWeightLbs: "",
    }),
    (error) => error instanceof HttpError && error.code === "match_conflict",
  );
});

test("nonoverlapping weight preferences accept a manual agreed weight", () => {
  assert.deepEqual(resolveMatchWeight({
    sharedWeightOptionIds: [],
    weightOptionId: "",
    agreedWeightLbs: "160",
  }), { weightOptionId: null, matchWeightLbs: 160 });

  assert.throws(
    () => resolveMatchWeight({
      sharedWeightOptionIds: [],
      weightOptionId: featherId,
      agreedWeightLbs: "160",
    }),
    /agreed match weight/i,
  );
});

test("only Gi versus No-Gi is an explicit format conflict", () => {
  assert.equal(formatPreferencesConflict("gi", "no_gi"), true);
  assert.equal(formatPreferencesConflict("no_gi", "gi"), true);
  assert.equal(formatPreferencesConflict("gi", "both"), false);
  assert.equal(formatPreferencesConflict("both", "no_gi"), false);
  assert.equal(formatPreferencesConflict("gi", "gi"), false);
});

test("admin UI exposes informational overrides without changing suggestion scoring", async () => {
  const [html, script, api, migration, domain, statusScript, confirmScript] = await Promise.all([
    readFile(new URL("../admin-superfights.html", import.meta.url), "utf8"),
    readFile(new URL("../admin-superfights.js", import.meta.url), "utf8"),
    readFile(new URL("../api/superfight-admin-matches.js", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260809060000_promoter_match_overrides.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/superfight/domain.js", import.meta.url), "utf8"),
    readFile(new URL("../status.js", import.meta.url), "utf8"),
    readFile(new URL("../confirm.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /Agreed Match Weight \(lbs\)/);
  assert.match(html, /id="match-format-confirmed" type="checkbox"/);
  assert.match(script, /application weight preferences do not overlap/);
  assert.match(script, /selected different format preferences/);
  assert.match(script, /weightReady && boutTypeReady && formatConfirmed/);
  assert.match(api, /body\.formatOverrideConfirmed !== true/);
  assert.match(api, /match_weight_lbs: matchWeightLbs/);
  assert.doesNotMatch(migration, /fighter_[ab]_record\.grappling_preference/);
  assert.doesNotMatch(migration, /superfight_competitor_weight_preferences/);
  assert.match(migration, /new\.weight_option_id is not null[\s\S]*?new\.match_weight_lbs := weight_option_record\.value_lbs/);
  assert.match(migration, /new\.match_weight_lbs is null or new\.match_weight_lbs <= 0/);
  assert.match(domain, /if \(!preferencesCompatible\(leftPreference, rightPreference\)\) {[\s\S]*?POSITIVE_INFINITY/);
  assert.match(domain, /sharedWeightOptionIds\(left, right\)\.length === 0\) return Number\.POSITIVE_INFINITY/);
  assert.match(statusScript, /Agreed match weight/);
  assert.match(confirmScript, /Agreed match weight/);
});
