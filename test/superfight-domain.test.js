import test from "node:test";
import assert from "node:assert/strict";

import {
  MATCHMAKING_PENALTIES,
  normalizeInstagram,
  scoreCompatibility,
  sortCompetitors,
  suggestedOrder,
} from "../src/superfight/domain.js";

test("normalizes Instagram handles, usernames, and profile URLs", () => {
  const expected = {
    handle: "libertyfightleague",
    url: "https://www.instagram.com/libertyfightleague/",
  };

  assert.deepEqual(normalizeInstagram("@LibertyFightLeague"), expected);
  assert.deepEqual(normalizeInstagram(" LibertyFightLeague "), expected);
  assert.deepEqual(
    normalizeInstagram("https://instagram.com/LibertyFightLeague/?utm_source=test"),
    expected,
  );
});

test("treats Instagram as optional and rejects unrelated URLs", () => {
  assert.deepEqual(normalizeInstagram("  "), { handle: null, url: null });
  assert.throws(
    () => normalizeInstagram("https://example.com/libertyfightleague"),
    /Instagram profile URL/,
  );
});

test("same-belt proximity outweighs a small cross-belt weight difference", () => {
  const blue150 = { eventId: "event-1", belt: "blue", competitionWeightLbs: 150 };
  const blue165 = { eventId: "event-1", belt: "blue", competitionWeightLbs: 165 };
  const purple151 = { eventId: "event-1", belt: "purple", competitionWeightLbs: 151 };

  assert.equal(scoreCompatibility(blue150, blue165), 15);
  assert.equal(
    scoreCompatibility(blue150, purple151),
    MATCHMAKING_PENALTIES.beltStep + 1,
  );
  assert.ok(
    scoreCompatibility(blue150, blue165) < scoreCompatibility(blue150, purple151),
  );
});

test("competitors from different events are never suggested to one another", () => {
  const left = { eventId: "event-1", belt: "blue", competitionWeightLbs: 150 };
  const right = { eventId: "event-2", belt: "blue", competitionWeightLbs: 150 };

  assert.equal(scoreCompatibility(left, right), Number.POSITIVE_INFINITY);
});

test("suggested ordering places each anchor beside its nearest available candidate", () => {
  const competitors = [
    { id: "blue-205", fullName: "Blue 205", belt: "blue", competitionWeightLbs: 205 },
    { id: "purple-151", fullName: "Purple 151", belt: "purple", competitionWeightLbs: 151 },
    { id: "blue-155", fullName: "Blue 155", belt: "blue", competitionWeightLbs: 155 },
    { id: "blue-200", fullName: "Blue 200", belt: "blue", competitionWeightLbs: 200 },
    { id: "blue-150", fullName: "Blue 150", belt: "blue", competitionWeightLbs: 150 },
  ];

  assert.deepEqual(
    suggestedOrder(competitors).map(({ id }) => id),
    ["blue-150", "blue-155", "blue-200", "blue-205", "purple-151"],
  );
});

test("alternate sort modes are stable and do not mutate the input", () => {
  const competitors = [
    { id: "z", fullName: "Zed", belt: "purple", competitionWeightLbs: 145 },
    { id: "a", fullName: "Amy", belt: "blue", competitionWeightLbs: 170 },
    { id: "b", fullName: "Ben", belt: "blue", competitionWeightLbs: 150 },
  ];

  assert.deepEqual(sortCompetitors(competitors, "belt").map(({ id }) => id), ["b", "a", "z"]);
  assert.deepEqual(sortCompetitors(competitors, "weight").map(({ id }) => id), ["z", "b", "a"]);
  assert.deepEqual(sortCompetitors(competitors, "name").map(({ id }) => id), ["a", "b", "z"]);
  assert.deepEqual(competitors.map(({ id }) => id), ["z", "a", "b"]);
  assert.throws(() => sortCompetitors(competitors, "automatic"), /Unsupported/);
});
