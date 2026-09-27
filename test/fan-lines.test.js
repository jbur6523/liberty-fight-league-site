import test from "node:test";
import assert from "node:assert/strict";
import { fanOdds, withFanLines } from "../src/superfight/fan-lines.js";

const match = (id, left, right, leftPicks, rightPicks) => ({
  id, totalPicks: leftPicks + rightPicks,
  fighters: [
    { id: `${id}-a`, name: "Jordan L.", percentage: left, picks: leftPicks },
    { id: `${id}-b`, name: "Casey M.", percentage: right, picks: rightPicks },
  ],
});

test("fan moneylines use complementary percentages and clean increments of five", () => {
  for (const [percentage, expected] of [[50, "PK"], [55, "-120"], [45, "+120"], [60, "-150"], [40, "+150"], [65, "-185"], [35, "+185"], [99, "-9900"], [1, "+9900"]]) {
    assert.equal(fanOdds(percentage), expected);
  }
  assert.equal(fanOdds(100), "-9900");
  assert.equal(fanOdds(0), "+9900");
  for (let percentage = 51; percentage < 100; percentage++) {
    assert.equal(Number(fanOdds(percentage)), -Number(fanOdds(100 - percentage)));
    assert.equal(Math.abs(Number(fanOdds(percentage))) % 5, 0);
  }
});

test("no real votes means PK, no movement and no invented individual leaders", () => {
  const result = withFanLines({ event: { id: "event" }, matches: [match("m", 50, 50, 0, 0)] });
  assert.deepEqual(result.matches[0].fighters.map(f => [f.fanOdds, f.openingOdds, f.movement, f.picks]), [["PK", "PK", 0, 0], ["PK", "PK", 0, 0]]);
  assert.equal(result.matches[0].openingLine, "PK");
  assert.equal(result.matches[0].trendFighterId, null);
  assert.equal(result.summary.mostPicked, null);
  assert.equal(result.summary.biggestFavorite, null);
  assert.equal(result.summary.biggestMover, null);
  assert.deepEqual(result.summary.closestLine.odds, ["PK", "PK"]);
  assert.deepEqual(withFanLines({ event: null, matches: [] }).summary, { mostPicked: null, biggestFavorite: null, closestLine: null, biggestMover: null });
});

test("summaries distinguish real pick volume, strongest support, and closest market", () => {
  const result = withFanLines({ matches: [match("popular", 55, 45, 20, 16), match("favorite", 25, 75, 0, 4), match("close", 50, 50, 3, 3)] });
  assert.equal(result.summary.mostPicked.fighterId, "popular-a");
  assert.equal(result.summary.mostPicked.picks, 20);
  assert.equal(result.summary.biggestFavorite.fighterId, "favorite-b");
  assert.equal(result.summary.biggestFavorite.fanOdds, "-300");
  assert.equal(result.summary.closestLine.matchId, "close");
  assert.equal(result.summary.biggestMover.fighterId, "favorite-b");
  assert.equal(result.summary.biggestMover.movement, 25);
});

test("changing picks updates all lines and leaders, while opening stays PK", () => {
  const original = { matches: [match("m", 60, 40, 1, 0)] };
  const before = withFanLines(original);
  const after = withFanLines({ matches: [match("m", 40, 60, 0, 1)] });
  assert.deepEqual(before.matches[0].fighters.map(f => f.fanOdds), ["-150", "+150"]);
  assert.deepEqual(after.matches[0].fighters.map(f => f.fanOdds), ["+150", "-150"]);
  assert.equal(before.matches[0].trendFighterId, "m-a");
  assert.equal(after.matches[0].trendFighterId, "m-b");
  assert.equal(after.summary.mostPicked.fighterId, "m-b");
  assert.equal(after.summary.biggestFavorite.fighterId, "m-b");
  assert.equal(after.summary.biggestMover.fighterId, "m-b");
  assert.equal(after.matches[0].openingLine, before.matches[0].openingLine);
  assert.equal(after.matches[0].totalPicks, before.matches[0].totalPicks);
  assert.equal(original.matches[0].fighters[0].fanOdds, undefined, "does not mutate database snapshot");
});

test("equal highlights are stable when source row order or display names change", () => {
  const rows = [match("z", 60, 40, 1, 0), match("a", 60, 40, 1, 0)];
  const first = withFanLines({ matches: rows }).summary;
  const second = withFanLines({ matches: [...rows].reverse() }).summary;
  assert.deepEqual(second, first);
  rows[1].fighters[0].name = "Updated N.";
  const renamed = withFanLines({ matches: rows }).summary;
  assert.equal(renamed.mostPicked.fighterId, "a-a");
  assert.equal(renamed.mostPicked.name, "Updated N.");
  assert.equal(renamed.closestLine.matchId, "a");
});
