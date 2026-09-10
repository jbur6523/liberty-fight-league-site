import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { competitorLocation, distanceFromSanFrancisco, milesBetween } from "../src/server/city-distance.js";
import { normalizeState } from "../src/superfight/us-states.js";
import applyHandler from "../api/superfight-apply.js";

test("city lookup distinguishes states and calculates approximate SF mileage", () => {
  assert.equal(distanceFromSanFrancisco("San Francisco", "CA"), 0);
  assert.equal(distanceFromSanFrancisco(" san francisco ", "California"), 0);
  assert.ok(distanceFromSanFrancisco("Oakland", "CA") >= 8 && distanceFromSanFrancisco("Oakland", "CA") <= 20);
  assert.ok(distanceFromSanFrancisco("Los Angeles", "CA") > 300);
  assert.notEqual(distanceFromSanFrancisco("Portland", "OR"), distanceFromSanFrancisco("Portland", "ME"));
  assert.equal(distanceFromSanFrancisco("Unrecognized city", "CA"), null);
  assert.equal(distanceFromSanFrancisco(null, null), null);
  assert.equal(normalizeState(" california "), "CA");
  assert.equal(milesBetween([0, 0], [0, 1]), 69);
});

test("application location requires both fields; older/admin records may omit both", () => {
  assert.deepEqual(competitorLocation({ city: "San Francisco", state: "ca" }), { city: "San Francisco", state: "CA", distance_from_sf_miles: 0 });
  assert.deepEqual(competitorLocation({}, { optional: true }), { city: null, state: null, distance_from_sf_miles: null });
  assert.equal(competitorLocation({ city: "Unknown place", state: "CA" }).distance_from_sf_miles, null);
  for (const input of [{}, { city: "Oakland" }, { state: "CA" }, { city: "Oakland", state: "ZZ" }, { city: "x".repeat(101), state: "CA" }]) {
    assert.throws(() => competitorLocation(input), { statusCode: 400 });
  }
  assert.throws(() => competitorLocation({ city: "Oakland" }, { optional: true }), /both city and state/);
});

test("location migration preserves older records and accepts zero miles", async () => {
  const db = new PGlite();
  try {
    await db.exec("create table superfight_competitors(id integer primary key, full_name text); insert into superfight_competitors values (1, 'Existing');");
    await db.exec(await readFile(new URL("../supabase/migrations/20260910034029_competitor_city_state.sql", import.meta.url), "utf8"));
    assert.deepEqual((await db.query("select city,state,distance_from_sf_miles from superfight_competitors")).rows[0], { city: null, state: null, distance_from_sf_miles: null });
    await db.exec("update superfight_competitors set city='San Francisco', state='CA', distance_from_sf_miles=0");
    assert.equal((await db.query("select distance_from_sf_miles from superfight_competitors")).rows[0].distance_from_sf_miles, 0);
    await assert.rejects(db.exec("update superfight_competitors set distance_from_sf_miles=-1"), /check constraint/);
  } finally { await db.close(); }
});

test("public application persists normalized city, state and computed mileage", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-key";
  const originalFetch = globalThis.fetch;
  const eventId = "00000000-0000-4000-8000-000000000100";
  const weightId = "00000000-0000-4000-8000-000000000151";
  let inserted;
  globalThis.fetch = async (url, options) => {
    const table = new URL(url).pathname.split("/").at(-1);
    const method = options.method ?? "GET";
    let data = null;
    if (table === "superfight_events") data = { id: eventId, applications_open: true };
    else if (table === "superfight_event_weight_options") data = [{ id: weightId, event_id: eventId, label: "150 lb", value_lbs: 150, is_active: true }];
    else if (table === "superfight_competitors" && method === "POST") {
      inserted = JSON.parse(options.body);
      data = { id: "00000000-0000-4000-8000-000000000201", status_slug: "sample" };
    }
    return new Response(data === null ? null : JSON.stringify(data), { status: data === null ? 204 : 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const body = { eventId, weightOptionIds: [weightId], fullName: "Sample", phone: "5550100000", age: 20, genderDivision: "mens", grapplingPreference: "gi", belt: "blue", gym: "Ares_bjj", city: " San Francisco ", state: "California", distanceFromSfMiles: 9999 };
    const response = { setHeader() {}, end(value) { this.payload = JSON.parse(value); } };
    await applyHandler({ method: "POST", headers: {}, body }, response);
    assert.equal(response.statusCode, 201);
    assert.equal(inserted.city, "San Francisco");
    assert.equal(inserted.state, "CA");
    assert.equal(inserted.distance_from_sf_miles, 0);
  } finally { globalThis.fetch = originalFetch; }
});
