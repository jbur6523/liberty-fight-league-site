import { fanPicksSnapshot } from "../src/server/fan-picks.js";
import { matchResult } from "../src/superfight/match-result.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import { PGlite } from "@electric-sql/pglite";
import handler from "../api/superfight-admin-matches.js";
import { getServiceSupabase } from "../src/server/supabase.js";

test("bout editor prevents duplicate saves and retains entered details after a failed save", async () => {
  const source = await readFile(new URL("../admin-superfights.js", import.meta.url), "utf8");
  const start = source.indexOf('document.querySelector("#edit-bout-form").addEventListener');
  const end = source.indexOf('document.querySelector("#match-form").addEventListener', start);
  let submit, resolveSave, rejectSave, calls = 0, closed = false, reloads = 0;
  const form = { dataset: { matchId: "existing-match" }, addEventListener(name, handler) { submit = handler; } };
  const controls = [{ disabled: false }, { disabled: true }];
  const dialog = { querySelectorAll() { return controls; }, addEventListener() {}, removeEventListener() {}, close() { closed = true; } };
  const fields = {
    "#edit-bout-form": form, "#edit-bout-dialog": dialog, "#edit-bout-error": { textContent: "" },
    "#edit-bout-weight-option": { value: "" }, "#edit-bout-weight": { value: "160" },
    "#edit-bout-type": { value: "no_gi" }, "#edit-bout-notes": { value: "6 minutes" },
  };
  runInNewContext(source.slice(start, end), {
    document: { querySelector: selector => fields[selector] }, showToast() {},
    loadActiveView: async () => { reloads++; },
    api: async (path, options) => {
      calls++;
      assert.equal(path, "/api/superfight-admin-matches");
      assert.deepEqual(JSON.parse(options.body), { action: "edit", matchId: "existing-match", weightOptionId: "", agreedWeightLbs: "160", boutType: "no_gi", notes: "6 minutes" });
      return new Promise((resolve, reject) => { resolveSave = resolve; rejectSave = reject; });
    },
  });
  const event = { preventDefault() {}, currentTarget: form };
  const first = submit(event);
  await submit(event);
  assert.equal(calls, 1);
  assert(controls.every(control => control.disabled));
  rejectSave(new Error("Save failed"));
  await first;
  assert.equal(closed, false);
  assert.equal(reloads, 0);
  assert.equal(fields["#edit-bout-error"].textContent, "Save failed");
  assert.equal(fields["#edit-bout-notes"].value, "6 minutes");
  assert.deepEqual(controls.map(control => control.disabled), [false, true]);
  const second = submit(event);
  resolveSave({ match: { id: "existing-match" } });
  await second;
  assert.equal(closed, true);
  assert.equal(reloads, 1);
  assert.equal(form.dataset.saving, "false");
});

test("bout edits persist through the admin API, validate event weights, and preserve participants, confirmations and picks", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-key";
  const db = new PGlite();
  const service = getServiceSupabase();
  const originals = { from: service.from, rpc: service.rpc, getUser: service.auth.getUser };
  let authorized = true, fail = false;
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$select null::uuid$$;`);
    const directory = new URL("../supabase/migrations/", import.meta.url);
    for (const name of (await readdir(directory)).filter(name => name.endsWith(".sql")).sort()) {
      await db.exec((await readFile(new URL(name, directory), "utf8")).replace(/create extension if not exists pgcrypto;/gi, ""));
    }
    const eventId = (await db.query("insert into superfight_events(public_slug,name,fan_picks_current) values('edit-test','Edit test',true) returning id")).rows[0].id;
    const otherEventId = (await db.query("insert into superfight_events(public_slug,name) values('edit-other','Other') returning id")).rows[0].id;
    const fighters = [];
    for (let i = 0; i < 5; i++) fighters.push((await db.query("insert into superfight_competitors(event_id,source,full_name,belt) values($1,'admin_quick_add',$2,'blue') returning id", [eventId, `Fighter ${i}`])).rows[0].id);
    const matchId = (await db.query("insert into superfight_matches(event_id,fighter_a_id,fighter_b_id,bout_type,match_weight_lbs,flyer_completed) values($1,$2,$3,'gi',155,true) returning id", [eventId, ...fighters.slice(0, 2)])).rows[0].id;
    const groupId = (await db.query("insert into superfight_matches(event_id,fighter_a_id,fighter_b_id,fighter_c_id,bout_type,match_weight_lbs) values($1,$2,$3,$4,'gauntlet',180) returning id", [eventId, ...fighters.slice(2)])).rows[0].id;
    const weight = async (event, active) => (await db.query("insert into superfight_event_weight_options(event_id,label,value_lbs,is_active) values($1,$2,$3,$4) returning id", [event, randomUUID(), active ? 170 : 175, active])).rows[0].id;
    const optionId = await weight(eventId, true), inactiveId = await weight(eventId, false), foreignId = await weight(otherEventId, true);
    await db.query("update superfight_match_confirmations set response='accepted',responded_at=now() where competitor_id=$1", [fighters[0]]);
    const confirmations = (await db.query("select * from superfight_match_confirmations order by id")).rows;
    await db.query("select cast_superfight_fan_pick($1,$2,$3,$4,$5)", [eventId, matchId, fighters[0], "a".repeat(64), "b".repeat(64)]);
    const votes = (await db.query("select * from superfight_fan_votes")).rows;
    service.auth.getUser = async () => ({ data: { user: { id: randomUUID() } } });
    service.rpc = async () => ({ data: authorized });
    // Execute the handler's queries against the real migrated PostgreSQL schema.
    service.from = table => {
      let columns = "*", update, order;
      const filters = [], params = [];
      const parameter = value => { params.push(value); return `$${params.length}`; };
      const execute = async () => {
        if (fail) return { data: null, error: { message: "Forced test failure" } };
        try {
          const where = filters.length ? ` where ${filters.join(" and ")}` : "";
          const sql = update
            ? `update ${table} set ${Object.entries(update).map(([key, value]) => `${key}=${parameter(value)}`).join(",")}${where} returning ${columns}`
            : `select ${columns} from ${table}${where}${order ? ` order by ${order}` : ""}`;
          return { data: (await db.query(sql, params)).rows, error: null };
        } catch (error) { return { data: null, error }; }
      };
      return {
        select(value) { columns = value; return this; },
        eq(key, value) { filters.push(`${key}=${parameter(value)}`); return this; },
        in(key, values) { filters.push(`${key} in (${values.map(parameter).join(",")})`); return this; },
        order(key) { order = key; return this; },
        update(value) { update = value; return this; },
        then(resolve, reject) { return execute().then(resolve, reject); },
        async maybeSingle() { const result = await execute(); return { ...result, data: result.data?.[0] ?? null }; },
      };
    };
    const body = { action: "edit", matchId, weightOptionId: "", agreedWeightLbs: "162.5", boutType: "no_gi", notes: "  6 minutes\nSubmission only  " };
    const request = async (input = body, { method = "POST", cookie = "lfl_superfight_access=test", origin = "https://example.com" } = {}) => {
      const response = { setHeader() {}, end(text) { this.payload = JSON.parse(text); } };
      await handler({ method, body: input, query: { eventId }, headers: { cookie, origin, host: "example.com" } }, response);
      return response;
    };
    assert.equal((await request()).statusCode, 200);
    let match = (await request(null, { method: "GET" })).payload.matches.find(match => match.id === matchId);
    assert.equal(match.weightLbs, 162.5);
    assert.equal(match.boutType, "no_gi");
    assert.equal(match.notes, "6 minutes\nSubmission only");
    assert.equal(match.flyerCompleted, true);
    assert.equal(match.fighterA.id, fighters[0]);
    assert.equal(match.fighterB.id, fighters[1]);
    assert.equal((await request({ ...body, weightOptionId: optionId, agreedWeightLbs: "", notes: "" })).statusCode, 200);
    match = (await request(null, { method: "GET" })).payload.matches.find(match => match.id === matchId);
    assert.equal(match.weightOption.id, optionId);
    assert.equal(match.weightLbs, 170);
    assert.equal(match.notes, "");
    assert.deepEqual((await db.query("select * from superfight_match_confirmations order by id")).rows, confirmations);
    assert.deepEqual((await db.query("select * from superfight_fan_votes")).rows, votes);
    for (const patch of [
      { agreedWeightLbs: "" }, { agreedWeightLbs: "0" }, { agreedWeightLbs: "-2" }, { agreedWeightLbs: "10000" },
      { boutType: "both" }, { matchId: "invalid" }, { notes: "x".repeat(5001) },
      { weightOptionId: optionId }, { weightOptionId: inactiveId, agreedWeightLbs: "" },
      { weightOptionId: foreignId, agreedWeightLbs: "" }, { matchId: groupId },
    ]) assert.equal((await request({ ...body, ...patch })).statusCode, 400, JSON.stringify(patch).slice(0, 100));
    assert.equal((await request({ ...body, matchId: groupId, boutType: "gauntlet" })).statusCode, 200);
    assert.equal((await request({ ...body, matchId: randomUUID() })).statusCode, 404);
    assert.equal((await request(body, { cookie: "" })).statusCode, 401);
    authorized = false;
    assert.equal((await request()).statusCode, 403);
    authorized = true;
    assert.equal((await request(body, { origin: "https://other.com" })).statusCode, 403);
    fail = true;
    assert.equal((await request()).statusCode, 500);
    fail = false;
    // The authenticated result write flows through the real snapshot and voting functions.
    const resultBody = { action: "result", matchId, winnerFighterId: fighters[0] };
    assert.equal((await request(resultBody, { cookie: "" })).statusCode, 401);
    authorized = false;
    assert.equal((await request(resultBody)).statusCode, 403);
    authorized = true;
    assert.equal((await request(resultBody, { origin: "https://other.com" })).statusCode, 403);
    assert.equal((await request({ ...resultBody, winnerFighterId: fighters[2] })).statusCode, 400);
    assert.equal((await request({ ...resultBody, winnerFighterId: "invalid" })).statusCode, 400);
    assert.equal((await request({ ...resultBody, winnerFighterId: undefined })).statusCode, 400);
    assert.equal((await request(resultBody)).statusCode, 200);
    assert.equal((await request(null, { method: "GET" })).payload.matches.find(m => m.id === matchId).winnerFighterId, fighters[0]);
    const snapshotService = { storage: service.storage, rpc: async (_name, params) => ({ data: (await db.query("select superfight_fan_picks_snapshot_v2($1) result", [params.voter_hash])).rows[0].result }) };
    const publicCard = async id => (await fanPicksSnapshot(snapshotService, "a".repeat(64))).matches.find(m => m.id === id);
    let card = await publicCard(matchId);
    assert.equal(card.winnerFighterId, fighters[0]);
    assert.equal(matchResult(card).outcomeId, fighters[0]);
    assert.equal(card.totalPicks, 1);
    assert.equal(card.selectedFighterId, fighters[0]);
    const cast = async () => (await db.query("select cast_superfight_fan_pick($1,$2,$3,$4,$5) result", [eventId, matchId, fighters[1], "a".repeat(64), "b".repeat(64)])).rows[0].result;
    assert.equal(await cast(), "completed");
    assert.deepEqual((await db.query("select * from superfight_fan_votes")).rows, votes);
    assert.equal((await request({ ...resultBody, winnerFighterId: fighters[1] })).statusCode, 200);
    assert.equal((await publicCard(matchId)).winnerFighterId, fighters[1]);
    assert.equal((await request({ ...resultBody, winnerFighterId: null })).statusCode, 200);
    assert.equal((await publicCard(matchId)).winnerFighterId, null);
    assert.equal(await cast(), "saved");
    // A C-side gauntlet winner resolves to the opponent outcome, never to a fake two-person pairing.
    assert.equal((await request({ action: "result", matchId: groupId, winnerFighterId: fighters[4] })).statusCode, 200);
    card = await publicCard(groupId);
    assert.equal(matchResult(card).outcomeId, fighters[3]);
    assert.equal(matchResult(card).winnerName, card.opponents[1].name);
    assert.equal((await request({ action: "result", matchId: groupId, winnerFighterId: fighters[2] })).statusCode, 200);
    assert.equal(matchResult(await publicCard(groupId)).outcomeId, fighters[2]);
    assert.deepEqual((await db.query("select * from superfight_match_confirmations order by id")).rows, confirmations);
    fail = true;
    assert.equal((await request(resultBody)).statusCode, 500);
    fail = false;
    await db.query("update superfight_matches set state='unmatched', unmatched_at=now() where id=$1", [matchId]);
    assert.equal((await request(resultBody)).statusCode, 404);
    assert.equal((await request()).statusCode, 404);
  } finally {
    service.from = originals.from; service.rpc = originals.rpc; service.auth.getUser = originals.getUser;
    await db.close();
  }
});
