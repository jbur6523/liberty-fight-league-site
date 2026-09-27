import test from "node:test";
import assert from "node:assert/strict";
import { FanParlay, impliedProbability, combinedFanOdds, parlayShareText, shareParlay } from "../src/superfight/parlay.js";

const snapshot = () => ({ event: { id: "event", name: "Roll With It 3", votingOpen: true }, matches: ["one", "two", "three"].map(id => ({ id, selectedFighterId: `${id}-a`, totalPicks: 1, fighters: [{ id: `${id}-a`, name: "Jordan L.", fanOdds: "-150" }, { id: `${id}-b`, name: "Casey M.", fanOdds: "+150" }] })) });

test("fan parlay converts PK, favorites and underdogs and combines displayed lines", () => {
  assert.equal(impliedProbability("PK"), .5);
  assert.equal(impliedProbability("-150"), .6);
  assert.equal(impliedProbability("+150"), .4);
  assert.throws(() => impliedProbability("oops"));
  assert.equal(combinedFanOdds([]), null);
  assert.equal(combinedFanOdds([{ fanOdds: "PK" }]), null);
  assert.equal(combinedFanOdds([{ fanOdds: "PK" }, { fanOdds: "PK" }]), "+300");
  assert.equal(combinedFanOdds([{ fanOdds: "-150" }, { fanOdds: "+150" }]), "+317");
  assert.equal(combinedFanOdds([{ fanOdds: "-400" }, { fanOdds: "-400" }]), "-178");
  assert.equal(combinedFanOdds(Array.from({ length: 8 }, () => ({ fanOdds: "PK" }))), "+25,500");
});

test("very large parlays remain representable without an artificial odds cap", () => {
  assert.match(combinedFanOdds(Array.from({ length: 29 }, () => ({ fanOdds: "+9900" }))), /^\+1\.00e\+60$/);
  const enormous = combinedFanOdds(Array.from({ length: 200 }, () => ({ fanOdds: "+9900" })));
  assert.match(enormous, /^\+\d\.\d{2} × 10\^\d+$/);
  assert(!enormous.includes("Infinity"));
});

test("builder is opt-in and holds exactly one selection per match, independent of votes", () => {
  const state = new FanParlay(), data = snapshot(), before = structuredClone(data);
  state.sync(data);
  assert.equal(state.active, false);
  assert.equal(state.expanded, false);
  state.toggle("one", "one-a", data);
  assert.equal(state.picks.size, 0);
  state.active = true;
  state.toggle("one", "one-b", data);
  state.toggle("one", "one-a", data);
  assert.equal(state.picks.size, 1);
  assert.equal(state.picks.get("one"), "one-a");
  state.toggle("one", "one-a", data);
  assert.equal(state.picks.size, 0);
  state.toggle("one", "two-a", data);
  assert.equal(state.picks.size, 0);
  state.toggle("one", "one-b", data);
  state.toggle("two", "two-a", data);
  assert.equal(state.legs(data).length, 2);
  assert.equal(state.expanded, false, "second pick never expands the slip automatically");
  state.active = false;
  assert.equal(state.legs(data).length, 2, "leaving the builder retains the draft in this page");
  assert.deepEqual(data, before, "neither vote selections nor real totals are mutated");
  state.clear();
  assert.equal(state.picks.size, 0);
});

test("refresh updates names and live odds, and removes invalid or changed-event legs", () => {
  const state = new FanParlay(), data = snapshot();
  state.sync(data); state.active = true;
  state.toggle("one", "one-a", data); state.toggle("two", "two-b", data);
  data.matches[0].fighters[0].name = "Updated N.";
  data.matches[0].fighters[0].fanOdds = "PK";
  state.sync(data);
  assert.equal(state.legs(data)[0].name, "Updated N.");
  assert.equal(combinedFanOdds(state.legs(data)), "+400");
  data.matches[0].id = "new-pairing";
  state.sync(data);
  assert.equal(state.picks.size, 1, "votes or draft picks never carry into a new pairing");
  data.matches[1].fighters = [];
  state.sync(data);
  assert.equal(state.picks.size, 0);
  const next = snapshot(); state.toggle("three", "three-a", next);
  next.event.id = "other-event"; state.sync(next);
  assert.equal(state.picks.size, 0);
  state.sync({ event: null, matches: [] });
  assert.equal(state.legs({ event: null, matches: [] }).length, 0);
});

test("closing Fan Pick voting leaves the entertainment draft separate and usable", () => {
  const state = new FanParlay(), data = snapshot();
  state.sync(data); state.active = true; data.event.votingOpen = false;
  state.toggle("one", "one-b", data);
  assert.equal(state.picks.get("one"), "one-b");
  assert.equal(data.matches[0].selectedFighterId, "one-a");
  assert.equal(data.matches[0].totalPicks, 1);
});

test("share text contains selected fighters, combined lines, public link and disclaimer", () => {
  const data = snapshot(), state = new FanParlay(); state.sync(data); state.active = true;
  state.toggle("one", "one-a", data); state.toggle("two", "two-b", data);
  const text = parlayShareText(data.event.name, state.legs(data));
  for (const part of ["MY ROLL WITH IT 3 FAN PARLAY", "Jordan L. ✓ (-150)", "Casey M. ✓ (+150)", "2-Leg Parlay", "Combined Fan Odds: +317", "https://libertyfightleague.com/odds", "no real-money betting"]) assert(text.includes(part));
  assert(!text.includes("one-a"));
});

test("native share, cancellation, clipboard and manual fallback work without accounts", async () => {
  let received;
  assert.equal(await shareParlay("draft", { async share(payload) { received = payload.text; } }), "shared");
  assert.equal(received, "draft");
  assert.equal(await shareParlay("draft", { async share() { throw Object.assign(new Error(), { name: "AbortError" }); }, clipboard: { writeText() { assert.fail("cancelling must not copy"); } } }), "cancelled");
  assert.equal(await shareParlay("copy", { clipboard: { async writeText(text) { received = text; } } }), "copied");
  assert.equal(received, "copy");
  assert.equal(await shareParlay("draft", { async share() { throw new Error("not supported"); }, clipboard: { async writeText() {} } }), "copied");
  assert.equal(await shareParlay("draft", { clipboard: { async writeText() { throw new Error("denied"); } } }), "manual");
  assert.equal(await shareParlay("draft", {}), "manual");
});
