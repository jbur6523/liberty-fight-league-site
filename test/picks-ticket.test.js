import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { savedFanPicks } from "../src/superfight/picks-ticket.js";
import { parlayTicketSvg } from "../src/superfight/parlay-ticket.js";

test("normal tickets include only server-confirmed votes and reflect changed selections", () => {
  const a = { id: "a", name: "Alex A.", fanOdds: "-150" };
  const b = { id: "b", name: "Blake B.", fanOdds: "+150" };
  const snapshot = { event: { id: "event" }, matches: [
    { id: "m1", fighters: [a, b], selectedFighterId: "a" },
    { id: "m2", fighters: [a, b], selectedFighterId: null },
    { id: "m3", fighters: [a, b], selectedFighterId: "removed-fighter" },
  ] };
  assert.deepEqual(savedFanPicks(snapshot), [{ ...a, matchId: "m1" }]);
  snapshot.matches[0].selectedFighterId = "b";
  assert.deepEqual(savedFanPicks(snapshot), [{ ...b, matchId: "m1" }]);
  snapshot.matches = [];
  assert.deepEqual(savedFanPicks(snapshot), []);
});

test("one normal vote renders a PNG ticket with individual odds and no parlay language", async () => {
  const args = { eventName: "Roll With It 3", kind: "fan-picks", capturedAt: "2026-09-27T20:00:00.000Z", legs: [{ name: "Alex A.", academy: "Test Academy", fanOdds: "-150" }] };
  const svg = parlayTicketSvg(args);
  assert.match(svg, /MY FAN PICKS/);
  assert.match(svg, /1 SAVED FAN PICK/);
  assert.match(svg, /Alex A\./);
  assert.match(svg, /-150/);
  assert.doesNotMatch(svg, /PARLAY|COMBINED FAN ODDS/);
  assert.match(svg, /Not an admission ticket/);
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  assert.equal((await sharp(png).metadata()).width, 1000);
  assert.throws(() => parlayTicketSvg({ ...args, legs: [] }), /Make a Fan Pick/);
});
