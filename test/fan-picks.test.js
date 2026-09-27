import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import handler from "../api/fan-picks.js";
import { getServiceSupabase } from "../src/server/supabase.js";
import { anonymousVoter, percentages, publicFighter } from "../src/server/fan-picks.js";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-key";

test("baseline percentages complement one another and never display 100–0", () => {
  assert.deepEqual(percentages(0, 0), [50, 50]);
  assert.deepEqual(percentages(1, 0), [60, 40]);
  assert.deepEqual(percentages(0, 1), [40, 60]);
  assert.deepEqual(percentages(100000, 0), [99, 1]);
  for (let a = 0; a < 300; a++) for (let b = 0; b < 30; b++) {
    const [left, right] = percentages(a, b);
    assert.equal(left + right, 100);
    assert(left >= 1 && right >= 1 && left <= 99 && right <= 99);
  }
});

test("browser identity is server-issued, signed, persistent, HttpOnly and never returned publicly", () => {
  const headers = {};
  const res = { setHeader(name, value) { headers[name] = value; } };
  const hash = anonymousVoter({ headers: { "x-forwarded-proto": "https" } }, res, { issue: true });
  assert.match(headers["Set-Cookie"], /HttpOnly; SameSite=Lax; Max-Age=31536000; Secure/);
  const cookie = headers["Set-Cookie"].split(";")[0];
  assert.equal(anonymousVoter({ headers: { cookie } }, res), hash);
  assert.throws(() => anonymousVoter({ headers: { cookie: cookie.slice(0, -1) + "z" } }, res), /refresh/);
  assert.throws(() => anonymousVoter({ headers: {} }, res), /refresh/);
  const fighter = publicFighter(getServiceSupabase(), { id: "id", full_name: "Michael Smith", gym: "Academy", email: "secret", phone: "secret" });
  assert.deepEqual(fighter, { id: "id", firstName: "Michael", name: "Michael S.", academy: "Academy", photoUrl: null });
});

test("real migrations and public API cover votes, refresh, privacy, current events, unmatching, and closed voting", async () => {
  const db = new PGlite();
  const service = getServiceSupabase();
  const originalRpc = service.rpc;
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$select null::uuid$$;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text);
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon,authenticated;
      grant all on storage.objects to anon,authenticated;
      create policy existing_broad_storage_policy on storage.objects for all to authenticated using(true) with check(true);`);
    const directory = new URL("../supabase/migrations/", import.meta.url);
    for (const name of (await readdir(directory)).filter(n => n.endsWith(".sql")).sort()) {
      await db.exec((await readFile(new URL(name, directory), "utf8")).replace(/create extension if not exists pgcrypto;/gi, ""));
    }
    const eventId = (await db.query("insert into superfight_events(public_slug,name,fan_picks_current) values('fan-test','Test event',true) returning id")).rows[0].id;
    const otherEvent = (await db.query("insert into superfight_events(public_slug,name) values('other-test','Other event') returning id")).rows[0].id;
    const fighters = [];
    for (let i = 0; i < 8; i++) fighters.push((await db.query("insert into superfight_competitors(event_id,source,full_name,gym,belt) values($1,'admin_quick_add',$2,'Academy','blue') returning id", [eventId, i === 0 ? "Michael Smith" : `Fighter ${i}`])).rows[0].id);
    const createMatch = async (ids, type = "gi") => (await db.query("insert into superfight_matches(event_id,fighter_a_id,fighter_b_id,fighter_c_id,bout_type,match_weight_lbs) values($1,$2,$3,$4,$5,155) returning id", [eventId, ids[0], ids[1], ids[2] || null, type])).rows[0].id;
    const matchId = await createMatch(fighters.slice(0, 2));
    const gauntletId = await createMatch(fighters.slice(2, 5), "gauntlet");
    service.rpc = async (name, params) => {
      try {
        const keys = Object.keys(params);
        const { rows } = await db.query(`select public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(",")}) result`, Object.values(params));
        return { data: rows[0].result, error: null };
      } catch (error) { return { data: null, error }; }
    };
    const call = async (method = "GET", body, cookie, extraHeaders = {}) => {
      const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(text) { this.payload = JSON.parse(text); } };
      await handler({ method, body, socket: { remoteAddress: "192.0.2.1" }, headers: { host: "example.com", origin: "https://example.com", cookie, ...extraHeaders } }, response);
      return response;
    };
    const initial = await call();
    const cookie = initial.headers["Set-Cookie"].split(";")[0];
    assert.equal(initial.statusCode, 200);
    assert.equal(initial.payload.matches.length, 1, "multi-fighter specialty bouts are omitted");
    assert.equal(initial.payload.matches[0].totalPicks, 0);
    assert.equal(initial.payload.matches[0].boutType, "gi");
    assert.equal(initial.payload.matches[0].weightLbs, 155);
    assert.deepEqual(initial.payload.matches[0].fighters.map(f => f.percentage), [50, 50]);
    assert.equal(initial.payload.matches[0].fighters[0].name, "Michael S.");
    assert.equal((await db.query("select count(*)::int n from superfight_fan_votes")).rows[0].n, 0, "no fake votes seeded");
    const vote = (fighterId = fighters[0], overrides = {}, browser = cookie) => call("POST", { eventId, matchId, fighterId, ...overrides }, browser);
    assert.equal((await call("POST", { eventId, matchId, fighterId: fighters[0] })).statusCode, 403);
    assert.equal((await call("POST", { eventId, matchId, fighterId: fighters[0] }, cookie, { origin: "https://evil.example" })).statusCode, 403);
    assert.equal((await call("PUT", {}, cookie)).statusCode, 405);
    assert.equal((await vote(fighters[5])).statusCode, 400);
    assert.equal((await vote(fighters[2], { matchId: gauntletId })).statusCode, 409);
    assert.equal((await vote(fighters[0], { eventId: otherEvent })).statusCode, 409);
    assert.equal((await vote("invalid")).statusCode, 400);
    const first = await vote();
    assert.deepEqual(first.payload.matches[0].fighters.map(f => f.percentage), [60, 40]);
    assert.equal(first.payload.matches[0].totalPicks, 1);
    const duplicates = await Promise.all(Array.from({ length: 12 }, () => vote()));
    assert(duplicates.every(r => r.statusCode === 200 && r.payload.matches[0].totalPicks === 1));
    const changed = await vote(fighters[1]);
    assert.equal(changed.payload.matches[0].totalPicks, 1);
    assert.deepEqual(changed.payload.matches[0].fighters.map(f => f.percentage), [40, 60]);
    assert.equal((await call("GET", null, cookie)).payload.matches[0].selectedFighterId, fighters[1]);
    const secondBrowser = (await call()).headers["Set-Cookie"].split(";")[0];
    assert.equal((await vote(fighters[0], {}, secondBrowser)).payload.matches[0].totalPicks, 2, "shared IP allows another browser");
    await db.query("update superfight_competitors set full_name='Mikey Smith',gym='Updated Academy',fan_photo_path='fighter/new.webp' where id=$1", [fighters[0]]);
    const edited = (await call("GET", null, cookie)).payload.matches[0];
    assert.equal(edited.fighters[0].name, "Mikey S.");
    assert.equal(edited.fighters[0].academy, "Updated Academy");
    assert.match(edited.fighters[0].photoUrl, /fighter\/new.webp$/);
    assert.equal(edited.totalPicks, 2);
    await db.query("update superfight_events set fan_picks_open=false where id=$1", [eventId]);
    assert.equal((await vote()).statusCode, 409);
    assert.equal((await call("GET", null, cookie)).payload.matches[0].totalPicks, 2);
    await db.query("update superfight_events set fan_picks_open=true where id=$1", [eventId]);
    await assert.rejects(db.query("update superfight_matches set fighter_b_id=$1 where id=$2", [fighters[5], matchId]), /Unmatch/);
    await db.query("update superfight_matches set state='unmatched',unmatched_at=now() where id=$1", [matchId]);
    assert.equal((await call("GET", null, cookie)).payload.matches.length, 0);
    assert.equal((await vote()).statusCode, 409);
    const newMatch = await createMatch([fighters[0], fighters[5]]);
    const newCard = (await call("GET", null, cookie)).payload.matches[0];
    assert.equal(newCard.id, newMatch);
    assert.equal(newCard.totalPicks, 0);
    assert.equal(newCard.selectedFighterId, null);
    await db.query("select set_superfight_fan_event($1)", [otherEvent]);
    const switched = (await call("GET", null, cookie)).payload;
    assert.equal(switched.event.id, otherEvent);
    assert.equal(switched.matches.length, 0);
    assert.equal((await vote(fighters[0], { matchId: newMatch })).statusCode, 409);
    await db.query("select set_superfight_fan_event($1)", [eventId]);
    await db.exec("update superfight_fan_limits set attempts=40 where bucket like 'browser:%'");
    const limited = await vote(fighters[0], { matchId: newMatch });
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.headers["Retry-After"], "60");
    await db.exec("update superfight_fan_limits set window_start=now()-interval '2 minutes'");
    assert.equal((await vote(fighters[0], { matchId: newMatch })).statusCode, 200);
    const json = JSON.stringify((await call("GET", null, cookie)).payload);
    for (const field of ["voter_hash", "ip_hash", "phone", "email", "full_name", "fan_photo_path"]) assert(!json.includes(field));
    const privileges = await db.query(`select has_table_privilege('anon','superfight_fan_votes','select') a,
      has_table_privilege('authenticated','superfight_fan_votes','insert') b,
      has_function_privilege('anon','cast_superfight_fan_pick(uuid,uuid,uuid,text,text)','execute') c,
      has_function_privilege('authenticated','superfight_fan_picks_snapshot(text)','execute') d`);
    assert.deepEqual(privileges.rows[0], { a: false, b: false, c: false, d: false });
    assert.equal((await db.query("select count(*)::int n from pg_class where relname in ('superfight_fan_votes','superfight_fan_limits') and relrowsecurity")).rows[0].n, 2);
    const bucket = (await db.query("select * from storage.buckets where id='superfight-fighter-photos'")).rows[0];
    assert.equal(bucket.public, true);
    assert.deepEqual(bucket.allowed_mime_types, ["image/webp"]);
    await db.exec("set role authenticated");
    await assert.rejects(db.query("insert into storage.objects(bucket_id) values('superfight-fighter-photos')"), /row-level security/);
    await db.query("insert into storage.objects(bucket_id) values('unrelated-bucket')");
    await db.exec("reset role");
    service.rpc = async () => ({ error: { message: "Forced test failure" } });
    assert.equal((await vote(fighters[0], { matchId: newMatch })).statusCode, 500);
  } finally { service.rpc = originalRpc; await db.close(); }
});
