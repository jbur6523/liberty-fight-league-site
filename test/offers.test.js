import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { publicCompetitor, offerInstagram } from "../src/server/offers.js";
import { offerEmail, notifyOffer } from "../src/server/offer-notifications.js";

test("public cards and lookup profiles expose only their allowlisted fields", () => {
  const privateRecord = { id: "fighter", full_name: "First PrivateLastname", belt: "blue", experience_level: null, grappling_preference: "both", gym: "Test Gym", instagram_handle: "test_fighter", phone: "PRIVATE", email: "PRIVATE", age: 35, notes: "PRIVATE", status_slug: "PRIVATE", status_token: "PRIVATE", competition_weight_lbs: 149 };
  const options = [{ id: "private-id", label: "Feather — 154 lbs & under", valueLbs: 154, sortOrder: 3 }];
  assert.deepEqual(publicCompetitor(privateRecord, options), { id: "fighter", firstName: "First", belt: "blue", grapplingPreference: "both", weightOptions: [{ label: "Feather — 154 lbs & under", valueLbs: 154 }] });
  const profile = publicCompetitor(privateRecord, options, { detail: true });
  assert.deepEqual(Object.keys(profile).sort(), ["id", "firstName", "belt", "grapplingPreference", "weightOptions", "instagramHandle", "gym"].sort());
  assert.doesNotMatch(JSON.stringify(profile), /PRIVATE|PrivateLastname|149/);
  for (const value of ["@Test_Fighter", "test_fighter", "https://www.instagram.com/Test_Fighter/"]) assert.equal(offerInstagram(value), "test_fighter");
  for (const invalid of ["", "https://evil.com/test", "a%", "x".repeat(31)]) assert.throws(() => offerInstagram(invalid), /valid Instagram/);
});

test("notification includes requested details and sends with a stable idempotency key", async () => {
  const offer = { id: "offer-id", target_competitor_id: "target", offering_competitor_id: "sender", bout_type: "no_gi", offered_weight_lbs: 151, notification_state: "pending", notification_attempts: 0 };
  const target = { id: "target", full_name: "Target Fighter" };
  const fighter = { id: "sender", full_name: "Offering Fighter", instagram_handle: "offerer", belt: "purple", gym: "Test Gym" };
  const email = offerEmail(offer, target, fighter);
  for (const value of ["Target Fighter", "Offering Fighter", "@offerer", "151", "purple", "Test Gym", "No-Gi"]) assert.ok(email.text.includes(value));
  const updates = [];
  const service = { from(table) {
    const q = { select() { return q; }, eq() { return q; }, neq() { return q; }, in() { return q; }, update(value) { updates.push(value); return q; },
      single: async () => ({ data: offer }),
      then(resolve) { return Promise.resolve({ data: table === "superfight_competitors" ? [target, fighter] : table === "superfight_admin_users" ? [{ promoter_id: "promoter" }] : table === "promoters" ? [{ email: "admin@example.com" }] : [] }).then(resolve); },
    }; return q;
  } };
  const savedKey = process.env.RESEND_API_KEY, savedFrom = process.env.SUPERFIGHT_NOTIFY_FROM;
  process.env.RESEND_API_KEY = "test-only"; process.env.SUPERFIGHT_NOTIFY_FROM = "LFL <test@example.com>";
  try {
    assert.equal(await notifyOffer(service, offer.id, async (url, request) => {
      assert.equal(url, "https://api.resend.com/emails");
      assert.equal(request.headers["Idempotency-Key"], "superfight-offer-offer-id");
      assert.deepEqual(JSON.parse(request.body).to, ["admin@example.com"]);
      return { ok: true };
    }), true);
    assert.equal(updates.at(-1).notification_state, "sent");
  } finally {
    if (savedKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = savedKey;
    if (savedFrom === undefined) delete process.env.SUPERFIGHT_NOTIFY_FROM; else process.env.SUPERFIGHT_NOTIFY_FROM = savedFrom;
  }
});

test("offer transactions reuse Instagram records, preserve availability, deny safely, and make real matches", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$select null::uuid$$;`);
    const directory = new URL("../supabase/migrations/", import.meta.url);
    for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
      await db.exec((await readFile(new URL(name, directory), "utf8")).replace(/create extension if not exists pgcrypto;/gi, ""));
    }
    const eventId = (await db.query("insert into superfight_events(public_slug,name,applications_open) values ('offers-test','Offers test',true) returning id")).rows[0].id;
    const adminId = randomUUID(); await db.query("insert into auth.users(id) values ($1)", [adminId]);
    const target = (await db.query("insert into superfight_competitors(event_id,source,full_name,instagram_handle,belt) values($1,'admin_quick_add','Target PrivateLastname','target_handle','blue') returning *", [eventId])).rows[0];
    const submit = async (handle, { id = target.id, key = randomUUID(), firstName = "Offering", belt = "purple", weight = 151, gym = "Test Gym" } = {}) => {
      return (await db.query("select submit_superfight_offer($1,$2,'gi',$3,$4,$5,$6,$7) as offer", [id, handle, key, firstName, belt, weight, gym])).rows[0].offer;
    };
    const requestKey = randomUUID();
    const first = await submit("Offering_Handle", { key: requestKey });
    const retry = await submit("offering_handle", { key: requestKey });
    assert.equal(first.id, retry.id); assert.equal(retry.created, false);
    const samePair = await submit("offering_handle");
    assert.equal(samePair.id, first.id);
    assert.equal((await db.query("select count(*)::int as n from superfight_competitors")).rows[0].n, 2);
    const second = await submit("another_handle");
    assert.notEqual(second.id, first.id);
    assert.deepEqual((await db.query("select * from superfight_competitors where id=$1", [target.id])).rows[0], target);
    assert.equal((await db.query("select count(*)::int as n from superfight_matches")).rows[0].n, 0);
    // Denying changes only the offer, with both registrations still active/standard.
    await db.query("update superfight_offers set state='denied',resolved_at=now() where id=$1", [second.id]);
    assert.equal((await db.query("select count(*)::int as n from superfight_competitors where record_state='active' and matchmaking_pool='standard'")).rows[0].n, 3);
    const originalSender = (await db.query("select * from superfight_competitors where instagram_handle='offering_handle'")).rows[0];
    await submit("offering_handle", { firstName: "Overwrite", belt: "black", weight: 199, gym: "Overwrite" });
    assert.deepEqual((await db.query("select * from superfight_competitors where id=$1", [originalSender.id])).rows[0], originalSender);
    await assert.rejects(submit("target_handle"), /against yourself/);
    await db.query("update superfight_competitors set matchmaking_pool='gauntlet' where id=$1", [target.id]);
    await assert.rejects(submit("new_handle"), /no longer available/);
    await db.query("update superfight_competitors set matchmaking_pool='standard' where id=$1", [target.id]);
    const competing = await submit("waiting_handle", { belt: "white" });
    assert.equal((await db.query("select experience_level from superfight_competitors where instagram_handle='waiting_handle'")).rows[0].experience_level, "white");
    await assert.rejects(submit("incomplete_handle", { firstName: "" }), /Complete your/);
    assert.equal((await db.query("select count(*)::int as n from superfight_competitors where instagram_handle='incomplete_handle'")).rows[0].n, 0);
    // New and existing offers participate in the normal match tables and confirmations.
    const matchId = (await db.query("select create_superfight_match_with_offer($1,$2,$3,null,154,'gi',$4,$5) as id", [eventId,target.id,originalSender.id,adminId,first.id])).rows[0].id;
    assert.ok(matchId);
    assert.equal((await db.query("select state from superfight_offers where id=$1", [first.id])).rows[0].state, "matched");
    assert.equal((await db.query("select state from superfight_offers where id=$1", [competing.id])).rows[0].state, "closed");
    assert.equal((await db.query("select count(*)::int as n from superfight_match_confirmations where match_id=$1", [matchId])).rows[0].n, 2);
    await assert.rejects(submit("unavailable_handle"), /no longer available/);
    await assert.rejects(db.query("select create_superfight_match_with_offer($1,$2,$3,null,154,'gi',$4,$5)", [eventId,target.id,originalSender.id,adminId,first.id]), /no longer available/);
    await assert.rejects(db.query("insert into superfight_competitors(event_id,source,full_name,instagram_handle) values($1,'admin_quick_add','Duplicate','OFFERING_HANDLE')", [eventId]), /event_instagram_unique/);
    // New tables and mutation functions cannot be accessed directly from a public client.
    const grants = await db.query("select has_table_privilege('anon','superfight_offers','SELECT') as read, has_function_privilege('anon','submit_superfight_offer(uuid,text,superfight_bout_type,uuid,text,text,numeric,text)','EXECUTE') as execute");
    assert.deepEqual(grants.rows[0], { read: false, execute: false });
    assert.equal((await db.query("select consume_superfight_offer_limit('test-bucket',1) as allowed")).rows[0].allowed, true);
    assert.equal((await db.query("select consume_superfight_offer_limit('test-bucket',1) as allowed")).rows[0].allowed, false);
  } finally { await db.close(); }
});
