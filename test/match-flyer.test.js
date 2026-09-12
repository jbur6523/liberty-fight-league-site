import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import handler from "../api/superfight-admin-matches.js";
import { getServiceSupabase } from "../src/server/supabase.js";
import { runInNewContext } from "node:vm";

test("Flyer UI waits for save, ignores repeated clicks, toggles both ways, and recovers from failure", async () => {
  const source = await readFile(new URL("../admin-superfights.js", import.meta.url), "utf8");
  const renderSource = source.slice(source.indexOf("function renderMatched()"), source.indexOf("function bindTableActions("));
  let click, settle, reject, calls = 0, highlighted = false;
  const row = { classList: { toggle(name, value) { assert.equal(name, "is-flyer-completed"); highlighted = value; } } };
  const button = {
    dataset: { flyer: "match" }, disabled: false, textContent: "Flyer",
    addEventListener(event, handler) { click = handler; }, closest() { return row; },
    setAttribute(name, value) { this[name] = value; },
  };
  const match = { id: "match", flyerCompleted: false, fighterA: {}, fighterB: {}, confirmation: { summary: "awaiting_confirmation" } };
  const matched = { innerHTML: "", querySelectorAll(selector) { return selector === "[data-flyer]" ? [button] : []; } };
  const messages = [];
  runInNewContext(`${renderSource}; renderMatched();`, {
    state: { matches: [match] }, elements: { matched }, document: { querySelector() { return {}; } },
    matchFighterCell: () => "Fighter", matchLinks: () => "", label: String, escapeHtml: String,
    confirmationBadge: value => value, bindTableActions() {}, showToast: value => messages.push(value),
    api: async (path, options) => {
      calls++;
      assert.equal(path, "/api/superfight-admin-matches");
      assert.deepEqual(JSON.parse(options.body), { action: "flyer", matchId: "match", flyerCompleted: !match.flyerCompleted });
      return new Promise((resolve, fail) => { settle = resolve; reject = fail; });
    },
  });
  assert.match(matched.innerHTML, /aria-pressed="false"/);
  for (const completed of [true, false]) {
    const pending = click();
    assert.equal(button.disabled, true);
    const count = calls;
    await click();
    assert.equal(calls, count);
    assert.equal(match.flyerCompleted, !completed);
    settle({ match: { id: "match", flyerCompleted: completed } });
    await pending;
    assert.equal(highlighted, completed);
    assert.equal(button["aria-pressed"], String(completed));
    assert.equal(button.textContent, completed ? "Flyer ✓" : "Flyer");
    assert.equal(button.disabled, false);
    assert.equal(match.confirmation.summary, "awaiting_confirmation");
  }
  const failed = click();
  reject(new Error("Save failed"));
  await failed;
  assert.equal(match.flyerCompleted, false);
  assert.equal(highlighted, false);
  assert.equal(button.disabled, false);
  assert.equal(messages.at(-1), "Save failed");
});

test("flyer migration backfills existing matches and preserves confirmations and rematching", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$select null::uuid$$;`);
    const directory = new URL("../supabase/migrations/", import.meta.url);
    const migrations = (await readdir(directory)).filter(name => name.endsWith(".sql")).sort();
    const flyerMigration = migrations.find(name => name.endsWith("_match_flyer_tracking.sql"));
    for (const name of migrations.filter(name => name !== flyerMigration)) {
      await db.exec((await readFile(new URL(name, directory), "utf8")).replace(/create extension if not exists pgcrypto;/gi, ""));
    }
    const event = (await db.query("insert into superfight_events(public_slug,name) values('flyer-test','Flyer test') returning id")).rows[0].id;
    const admin = randomUUID();
    await db.query("insert into auth.users(id) values($1)", [admin]);
    const fighters = [];
    for (let i = 0; i < 4; i++) {
      fighters.push((await db.query("insert into superfight_competitors(event_id,source,full_name,belt) values($1,'admin_quick_add',$2,'blue') returning id", [event, `Fighter ${i}`])).rows[0].id);
    }
    const create = async (a, b) => (await db.query("select create_superfight_group_match($1,$2,$3,null,154,'gi',$4) id", [event, a, b, admin])).rows[0].id;
    const first = await create(fighters[0], fighters[1]);
    const second = await create(fighters[2], fighters[3]);
    const confirmations = (await db.query("select * from superfight_match_confirmations order by id")).rows;
    await db.exec(await readFile(new URL(flyerMigration, directory), "utf8"));
    assert.deepEqual((await db.query("select flyer_completed from superfight_matches")).rows.map(row => row.flyer_completed), [false, false]);
    await db.query("update superfight_matches set flyer_completed=true where id=$1", [first]);
    assert.equal((await db.query("select flyer_completed from superfight_matches where id=$1", [first])).rows[0].flyer_completed, true);
    assert.equal((await db.query("select flyer_completed from superfight_matches where id=$1", [second])).rows[0].flyer_completed, false);
    assert.deepEqual((await db.query("select * from superfight_match_confirmations order by id")).rows, confirmations);
    await db.query("select * from submit_superfight_confirmation($1,'accepted',null,false)", [confirmations.find(row => row.match_id === first).token]);
    assert.equal((await db.query("select flyer_completed from superfight_matches where id=$1", [first])).rows[0].flyer_completed, true);
    await db.query("update superfight_matches set flyer_completed=false where id=$1", [first]);
    assert.equal((await db.query("select flyer_completed from superfight_matches where id=$1", [first])).rows[0].flyer_completed, false);
    await assert.rejects(db.query("update superfight_matches set flyer_completed=null where id=$1", [first]), /not-null/);
    await db.query("update superfight_matches set flyer_completed=true, state='unmatched', unmatched_at=now(), unmatched_by=$2 where id=$1", [first, admin]);
    const rematch = await create(fighters[0], fighters[1]);
    assert.equal((await db.query("select flyer_completed from superfight_matches where id=$1", [rematch])).rows[0].flyer_completed, false);
    assert.equal((await db.query("select relrowsecurity from pg_class where relname='superfight_matches'")).rows[0].relrowsecurity, true);
  } finally { await db.close(); }
});

test("admin flyer API persists explicit on/off state, lists it, and rejects invalid or unauthorized changes", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-key";
  const service = getServiceSupabase();
  const originals = { from: service.from, rpc: service.rpc, getUser: service.auth.getUser };
  const id = randomUUID(), eventId = randomUUID(), fighterA = randomUUID(), fighterB = randomUUID();
  const record = { id, event_id: eventId, fighter_a_id: fighterA, fighter_b_id: fighterB, state: "active", flyer_completed: false, match_weight_lbs: 154 };
  let authorized = true, fail = false;
  const updates = [];
  service.auth.getUser = async () => ({ data: { user: { id: randomUUID() } } });
  service.rpc = async () => ({ data: authorized });
  service.from = (table) => {
    const filters = {};
    let update;
    const result = () => {
      if (fail) return { error: { message: "Database unavailable" } };
      if (table === "superfight_competitors") return { data: [fighterA, fighterB].map(id => ({ id, full_name: "Fighter" })) };
      if (table === "superfight_match_confirmations") return { data: [] };
      const found = Object.entries(filters).every(([key, value]) => record[key] === value);
      if (found && update) { updates.push(update); Object.assign(record, update); }
      return { data: found ? [{ ...record }] : [] };
    };
    return {
      select() { return this; }, eq(key, value) { filters[key] = value; return this; },
      in() { return this; }, order() { return this; }, update(value) { update = value; return this; },
      then(resolve) { return Promise.resolve(result()).then(resolve); },
      async maybeSingle() { const response = result(); return { ...response, data: response.data?.[0] ?? null }; },
    };
  };
  const request = async (body, { method = "POST", cookie = "lfl_superfight_access=test", origin = "https://example.com" } = {}) => {
    const response = { setHeader() {}, end(text) { this.payload = JSON.parse(text); } };
    await handler({ method, body, headers: { cookie, origin, host: "example.com" }, query: { eventId } }, response);
    return response;
  };
  try {
    for (const flyerCompleted of [true, true, false]) {
      const response = await request({ action: "flyer", matchId: id, flyerCompleted });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.payload.match, { id, flyerCompleted });
      const fresh = await request(null, { method: "GET" });
      assert.equal(fresh.payload.matches[0].flyerCompleted, flyerCompleted);
      assert.equal(fresh.payload.matches[0].confirmation.summary, "awaiting_confirmation");
      assert.equal(record.state, "active");
    }
    assert.deepEqual(updates, [{ flyer_completed: true }, { flyer_completed: true }, { flyer_completed: false }]);
    for (const flyerCompleted of [null, "true", 1, undefined]) assert.equal((await request({ action: "flyer", matchId: id, flyerCompleted })).statusCode, 400);
    assert.equal((await request({ action: "flyer", matchId: "bad", flyerCompleted: true })).statusCode, 400);
    assert.equal((await request({ action: "flyer", matchId: randomUUID(), flyerCompleted: true })).statusCode, 404);
    assert.equal((await request({ action: "flyer", matchId: id, flyerCompleted: true }, { cookie: "" })).statusCode, 401);
    authorized = false;
    assert.equal((await request({ action: "flyer", matchId: id, flyerCompleted: true })).statusCode, 403);
    authorized = true;
    assert.equal((await request({ action: "flyer", matchId: id, flyerCompleted: true }, { origin: "https://other.com" })).statusCode, 403);
    fail = true;
    assert.equal((await request({ action: "flyer", matchId: id, flyerCompleted: true })).statusCode, 500);
    fail = false;
    assert.equal((await request({ action: "unmatch", matchId: id })).statusCode, 200);
    assert.equal(record.state, "unmatched");
    assert.equal((await request({ action: "flyer", matchId: id, flyerCompleted: true })).statusCode, 404);
  } finally {
    service.from = originals.from; service.rpc = originals.rpc; service.auth.getUser = originals.getUser;
  }
});
