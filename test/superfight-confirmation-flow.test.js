import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("fighter confirmation is read-only and renders terminal response states", async () => {
  const [page, script, api, adminMatchesApi] = await Promise.all([
    readFile(new URL("../confirm.html", import.meta.url), "utf8"),
    readFile(new URL("../confirm.js", import.meta.url), "utf8"),
    readFile(new URL("../api/superfight-confirm.js", import.meta.url), "utf8"),
    readFile(new URL("../api/superfight-admin-matches.js", import.meta.url), "utf8"),
  ]);

  assert.match(page, /rwi-logo\.svg/);
  assert.doesNotMatch(script, /confirmation-gym|Save academy|Update only your gym|updateGym/);
  assert.doesNotMatch(script, /element\("input"/);
  assert.match(script, /title: "Match Confirmed"/);
  assert.match(script, /officially set for Roll With It 3/);
  assert.match(script, /title: "Matchup Declined"/);
  assert.match(script, /if \(response !== "awaiting"\) return/);
  assert.match(script, /request\("POST", \{ response \}\)/);
  for (const label of [
    "Date & time",
    "Venue",
    "Fighter",
    "Opponent",
    "Your belt",
    "Opponent belt",
    "Bout type",
    "Agreed match weight",
    "Your gym",
    "Opponent gym",
  ]) {
    assert.match(script, new RegExp(`fieldRow\\(\\"${label.replace("&", "&")}\\"`));
  }

  assert.match(api, /allowMethods\(request, response, \["GET", "POST"\]\)/);
  assert.doesNotMatch(api, /optionalText|updatesGym|confirmation gym update/);
  assert.match(api, /details\.confirmation\.response !== "awaiting"/);
  assert.match(api, /should_update_gym: false/);
  assert.match(api, /submit_superfight_confirmation/);
  assert.match(adminMatchesApi, /from\("superfight_match_confirmations"\)[\s\S]*?select\("match_id, competitor_id, token, response, responded_at"\)/);
});
