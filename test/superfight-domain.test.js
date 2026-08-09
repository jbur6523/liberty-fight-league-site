import test from "node:test";
import assert from "node:assert/strict";

import {
  MATCHMAKING_PENALTIES,
  normalizeInstagram,
  scoreCompatibility,
  sharedWeightOptionIds,
  sortCompetitors,
  suggestedOrder,
} from "../src/superfight/domain.js";

const weight = (id, valueLbs, sortOrder = 0) => ({ id, valueLbs, sortOrder });

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

test("competitors are weight-compatible only when configured choices overlap", () => {
  const common = { eventId: "event-1", genderDivision: "mens", grapplingPreference: "both", belt: "blue" };
  const featherLight = { ...common, weightOptions: [weight("feather", 154, 2), weight("light", 168, 3)] };
  const lightMiddle = { ...common, weightOptions: [weight("light", 168, 3), weight("middle", 182, 4)] };
  const middleOnly = { ...common, weightOptions: [weight("middle", 182, 4)] };

  assert.deepEqual(sharedWeightOptionIds(featherLight, lightMiddle), ["light"]);
  assert.ok(Number.isFinite(scoreCompatibility(featherLight, lightMiddle)));
  assert.equal(scoreCompatibility(featherLight, middleOnly), Number.POSITIVE_INFINITY);
});

test("gender divisions are hard matchmaking boundaries", () => {
  const common = {
    eventId: "event-1",
    grapplingPreference: "both",
    belt: "blue",
    competitionWeightLbs: 155,
    age: 28,
  };

  assert.equal(
    scoreCompatibility(
      { ...common, genderDivision: "mens" },
      { ...common, genderDivision: "womens" },
    ),
    Number.POSITIVE_INFINITY,
  );
});

test("Gi and No-Gi preferences follow the compatibility matrix", () => {
  const competitor = (grapplingPreference) => ({
    eventId: "event-1",
    genderDivision: "mens",
    grapplingPreference,
    belt: "purple",
    competitionWeightLbs: 170,
    age: 30,
  });

  assert.ok(Number.isFinite(scoreCompatibility(competitor("gi"), competitor("gi"))));
  assert.ok(Number.isFinite(scoreCompatibility(competitor("no_gi"), competitor("no_gi"))));
  assert.ok(Number.isFinite(scoreCompatibility(competitor("gi"), competitor("both"))));
  assert.ok(Number.isFinite(scoreCompatibility(competitor("no_gi"), competitor("both"))));
  assert.ok(Number.isFinite(scoreCompatibility(competitor("both"), competitor("both"))));
  assert.equal(
    scoreCompatibility(competitor("gi"), competitor("no_gi")),
    Number.POSITIVE_INFINITY,
  );
});

test("belt, weight, then age determine compatible candidate proximity", () => {
  const anchor = {
    eventId: "event-1",
    genderDivision: "womens",
    grapplingPreference: "both",
    belt: "blue",
    competitionWeightLbs: 150,
    age: 25,
  };
  const sameBeltFartherWeight = { ...anchor, competitionWeightLbs: 175, age: 25 };
  const crossBeltCloserWeight = { ...anchor, belt: "purple", competitionWeightLbs: 151, age: 25 };
  const sameWeightCloseAge = { ...anchor, age: 26 };
  const sameWeightFarAge = { ...anchor, age: 40 };

  assert.ok(
    scoreCompatibility(anchor, sameBeltFartherWeight)
      < scoreCompatibility(anchor, crossBeltCloserWeight),
  );
  assert.ok(
    scoreCompatibility(anchor, sameWeightCloseAge)
      < scoreCompatibility(anchor, sameWeightFarAge),
  );
});

test("suggested ordering does not pair across incompatible divisions or formats", () => {
  const competitors = [
    { id: "mens-gi-a", fullName: "A", genderDivision: "mens", grapplingPreference: "gi", belt: "blue", competitionWeightLbs: 150, age: 24 },
    { id: "womens-gi-a", fullName: "B", genderDivision: "womens", grapplingPreference: "gi", belt: "blue", competitionWeightLbs: 150, age: 24 },
    { id: "mens-no-gi", fullName: "C", genderDivision: "mens", grapplingPreference: "no_gi", belt: "blue", competitionWeightLbs: 150, age: 24 },
    { id: "mens-gi-b", fullName: "D", genderDivision: "mens", grapplingPreference: "gi", belt: "blue", competitionWeightLbs: 152, age: 25 },
  ];

  const order = suggestedOrder(competitors).map(({ id }) => id);
  assert.deepEqual(order.slice(0, 2), ["mens-gi-a", "mens-gi-b"]);
  assert.equal(scoreCompatibility(competitors[0], competitors[1]), Number.POSITIVE_INFINITY);
  assert.equal(scoreCompatibility(competitors[0], competitors[2]), Number.POSITIVE_INFINITY);
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
