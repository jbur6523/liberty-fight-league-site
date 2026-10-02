import test from "node:test";
import assert from "node:assert/strict";
import { matchResult } from "../src/superfight/match-result.js";
import { FanParlay } from "../src/superfight/parlay.js";

test("result labels resolve real group winners without confusing opponent identity and outcome", () => {
  const anchor = { id: "a", name: "Anchor" };
  const opponents = [{ id: "b", name: "Opponent B" }, { id: "c", name: "Opponent C" }];
  const card = { groupPick: true, anchor, opponents, fighters: [anchor, opponents[0]] };
  assert.equal(matchResult(card), null);
  assert.equal(matchResult({ ...card, winnerFighterId: "unknown" }), null);
  assert.deepEqual(matchResult({ ...card, winnerFighterId: "c" }), { winnerName: "Opponent C", outcomeId: "b" });
  assert.deepEqual(matchResult({ ...card, winnerFighterId: "a" }), { winnerName: "Anchor", outcomeId: "a" });
});

test("finished matches preserve saved parlay legs but reject new or changed selections", () => {
  const card = { id: "match", fighters: [{ id: "a", name: "A", fanOdds: "PK" }, { id: "b", name: "B", fanOdds: "PK" }] };
  const snapshot = { event: { id: "event" }, matches: [card] };
  const parlay = new FanParlay();
  parlay.sync(snapshot); parlay.active = true;
  parlay.toggle("match", "a", snapshot);
  card.winnerFighterId = "b";
  parlay.sync(snapshot);
  parlay.toggle("match", "b", snapshot);
  assert.equal(parlay.picks.get("match"), "a");
  assert.equal(parlay.legs(snapshot).length, 1);
  parlay.clear();
  parlay.toggle("match", "b", snapshot);
  assert.equal(parlay.picks.size, 0);
});
