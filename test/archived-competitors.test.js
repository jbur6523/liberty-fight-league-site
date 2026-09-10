import test from "node:test";
import assert from "node:assert/strict";
import { restoreCompetitor } from "../src/server/archived-competitors.js";
import listHandler from "../api/superfight-admin-competitors.js";

test("restore preserves profile data and returns archived competitors to standard Unmatched", async () => {
  const records = [
    { id: "archived", record_state: "withdrawn", matchmaking_pool: "gauntlet", full_name: "Casey", phone: "555", age: 29, gym: "Academy", city: "Oakland", state: "CA", distance_from_sf_miles: 11, notes: "Keep these", status_slug: "casey" },
    { id: "active", record_state: "active", matchmaking_pool: "john_wick" },
    { id: "merged", record_state: "merged", matchmaking_pool: "standard" },
  ];
  const before = structuredClone(records[0]);
  const service = { from(table) {
    assert.equal(table, "superfight_competitors");
    let updates;
    const filters = [];
    return {
      update(value) { updates = value; return this; },
      eq(key, value) { filters.push([key, value]); return this; },
      select() { return this; },
      async maybeSingle() {
        const record = records.find(item => filters.every(([key, value]) => item[key] === value));
        if (record) Object.assign(record, updates);
        return { data: record ? { id: record.id } : null };
      },
    };
  } };
  assert.deepEqual(await restoreCompetitor(service, "archived"), { restored: true, competitorId: "archived" });
  assert.deepEqual(records[0], { ...before, record_state: "active", matchmaking_pool: "standard" });
  for (const id of ["active", "merged", "missing", "archived"]) {
    await assert.rejects(restoreCompetitor(service, id), { code: "restore_conflict" });
  }
  const conflict = { update() { return this; }, eq() { return this; }, select() { return this; }, async maybeSingle() { return { error: { code: "23505" } }; } };
  await assert.rejects(restoreCompetitor({ from: () => conflict }, "archived"), { code: "restore_duplicate" });
});

test("archived list is promoter-only, event-scoped, and restricted to withdrawn records", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-key";
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    requests.push(parsed);
    const resource = parsed.pathname.split("/").at(-1);
    const data = resource === "user" ? { id: "promoter" }
      : resource === "is_superfight_admin" ? true
      : resource === "superfight_competitors" ? [{ id: "old", full_name: "Previously deleted", gym: "Academy", competition_weight_lbs: null }]
      : [];
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
  };
  try {
    const eventId = "00000000-0000-4000-8000-000000000100";
    const response = () => ({ setHeader() {}, end(value) { this.payload = JSON.parse(value); } });
    const unauthorized = response();
    await listHandler({ method: "GET", headers: {}, query: { eventId, view: "archived" } }, unauthorized);
    assert.equal(unauthorized.statusCode, 401);
    assert.equal(requests.length, 0);
    const authorized = response();
    await listHandler({ method: "GET", headers: { cookie: "lfl_superfight_access=test" }, query: { eventId, view: "archived" } }, authorized);
    assert.equal(authorized.statusCode, 200);
    assert.equal(authorized.payload.competitors[0].name, "Previously deleted");
    const query = requests.find(url => url.pathname.endsWith("/superfight_competitors"));
    assert.equal(query.searchParams.get("event_id"), `eq.${eventId}`);
    assert.equal(query.searchParams.get("record_state"), "eq.withdrawn");
  } finally { globalThis.fetch = originalFetch; }
});
