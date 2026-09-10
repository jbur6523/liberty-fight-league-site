import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createProfileShare, getProfileShare } from "../src/server/profile-shares.js";
import handler from "../api/superfight-profile.js";

test("short links preserve a snapshot, retry collisions, and expose only profile fields", async () => {
  const fighter = { id: "fighter", full_name: "José Lee", age: 27, belt: "blue", gym: "Gym", instagram_handle: "jose", phone: "private" };
  const saved = new Map();
  let collision = true;
  const service = { from(table) {
    const filters = {};
    return {
      select() { return this; }, eq(key, value) { filters[key] = value; return this; },
      in() { return Promise.resolve({ data: [] }); },
      async maybeSingle() {
        if (table === "superfight_competitors") return { data: filters.id === "fighter" && filters.record_state === "active" ? fighter : null };
        return { data: saved.has(filters.token) ? { profile: saved.get(filters.token) } : null };
      },
      async insert({ token, profile }) {
        if (collision) { collision = false; return { error: { code: "23505" } }; }
        assert.match(token, /^[A-Za-z0-9_-]{16}$/);
        saved.set(token, structuredClone(profile));
        return {};
      },
    };
  } };
  const { path } = await createProfileShare(service, "fighter");
  assert.equal(path.length, 19);
  fighter.full_name = "Updated name";
  const token = path.split("/").at(-1);
  saved.get(token).notes = "private";
  assert.deepEqual(await getProfileShare(service, token), { name: "José Lee", age: 27, belt: "blue", gym: "Gym", instagramHandle: "jose", weightClasses: [] });
  for (const missing of [null, "", "../", "a".repeat(16)]) {
    await assert.rejects(getProfileShare(service, missing), { statusCode: 404 });
  }
  await assert.rejects(createProfileShare(service, "missing"), { statusCode: 404 });
});

test("share storage enforces token uniqueness, RLS, and server-only access", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    await db.exec(await readFile(new URL("../supabase/migrations/20260910033459_fighter_profile_shares.sql", import.meta.url), "utf8"));
    const profile = { name: "Sample", age: 27, belt: "blue", gym: "Gym", instagramHandle: "sample", weightClasses: ["155 lb"] };
    await db.exec("set role service_role");
    await db.query("insert into superfight_profile_shares(token, profile) values ($1, $2)", ["abcdefghijklmnop", profile]);
    assert.deepEqual((await db.query("select profile from superfight_profile_shares where token=$1", ["abcdefghijklmnop"])).rows[0].profile, profile);
    await assert.rejects(db.query("insert into superfight_profile_shares(token, profile) values ($1, $2)", ["abcdefghijklmnop", profile]), /duplicate key/);
    await db.exec("reset role");
    assert.equal((await db.query("select relrowsecurity from pg_class where relname='superfight_profile_shares'")).rows[0].relrowsecurity, true);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query("select * from superfight_profile_shares"), /permission denied/);
      await assert.rejects(db.query("insert into superfight_profile_shares(token, profile) values ($1, $2)", ["ponmlkjihgfedcba", profile]), /permission denied/);
      await db.exec("reset role");
    }
  } finally { await db.close(); }
});

test("share API rejects unsigned creation, cross-origin writes, and unsupported methods", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-key";
  for (const [method, headers, expected] of [
    ["POST", { host: "example.com" }, 401],
    ["POST", { host: "example.com", origin: "https://other.example" }, 403],
    ["DELETE", { host: "example.com" }, 405],
  ]) {
    const response = { setHeader() {}, end(value) { this.body = JSON.parse(value); } };
    await handler({ method, headers, body: { competitorId: "ignored" } }, response);
    assert.equal(response.statusCode, expected);
  }
});
