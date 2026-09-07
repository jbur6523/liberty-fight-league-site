import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { moveCompetitorPool } from "../src/server/matchmaking-pools.js";

test("pool moves validate destinations and update only the pool on an active competitor", async () => {
  const writes = [];
  const filters = [];
  const query = {
    update(value) { writes.push(value); return this; },
    eq(...args) { filters.push(args); return this; },
    select() { return this; },
    async maybeSingle() { return { data: { id: "fighter", matchmaking_pool: writes.at(-1).matchmaking_pool } }; },
  };
  const service = { from(table) { assert.equal(table, "superfight_competitors"); return query; } };
  for (const pool of ["john_wick", "gauntlet", "standard"]) {
    assert.deepEqual(await moveCompetitorPool(service, "fighter", pool), { id: "fighter", matchmakingPool: pool });
    assert.deepEqual(writes.at(-1), { matchmaking_pool: pool });
    assert.deepEqual(filters.slice(-2), [["id", "fighter"], ["record_state", "active"]]);
  }
  for (const invalid of [null, "matched", "withdrawn", "", "JOHN WICK"]) {
    await assert.rejects(moveCompetitorPool(service, "fighter", invalid), { code: "invalid_pool" });
  }
  assert.equal(writes.length, 3);
  query.maybeSingle = async () => ({ data: null });
  await assert.rejects(moveCompetitorPool(service, "missing", "standard"), { code: "pool_conflict" });
});

test("all migrations validate in PostgreSQL; pool assignments default safely and preserve matches", async () => {
  const db = new PGlite();
  try {
    // Supabase-owned auth scaffolding; pgcrypto's UUID function is built into PostgreSQL.
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql as $$ select null::uuid $$;`);
    const directory = new URL("../supabase/migrations/", import.meta.url);
    const migrations = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
    for (const name of migrations.filter((name) => !name.includes("matchmaking_pools"))) {
      const sql = (await readFile(new URL(name, directory), "utf8"))
        .replace(/create extension if not exists pgcrypto;/gi, "");
      await db.exec(sql);
    }
    const event = (await db.query("insert into superfight_events(public_slug, name) values ('pool-test', 'Pool test') returning id")).rows[0].id;
    const fighters = (await db.query(`insert into superfight_competitors(event_id, source, full_name)
      values ($1, 'admin_quick_add', 'Fighter One'), ($1, 'admin_quick_add', 'Fighter Two') returning id`, [event])).rows;
    await db.query(`insert into superfight_matches(event_id, fighter_a_id, fighter_b_id, bout_type, match_weight_lbs)
      values ($1, $2, $3, 'gi', 160)`, [event, fighters[0].id, fighters[1].id]);
    const before = await db.query("select to_jsonb(c) as row from superfight_competitors c order by id");
    const matches = await db.query("select * from superfight_matches");
    const confirmations = await db.query("select * from superfight_match_confirmations order by id");
    await db.exec(await readFile(new URL(migrations.find((name) => name.includes("matchmaking_pools")), directory), "utf8"));
    assert.deepEqual((await db.query("select matchmaking_pool from superfight_competitors")).rows,
      [{ matchmaking_pool: "standard" }, { matchmaking_pool: "standard" }]);
    for (const pool of ["john_wick", "gauntlet", "standard"]) {
      await db.query("update superfight_competitors set matchmaking_pool=$1 where id=$2", [pool, fighters[0].id]);
      assert.equal((await db.query("select matchmaking_pool from superfight_competitors where id=$1", [fighters[0].id])).rows[0].matchmaking_pool, pool);
    }
    await assert.rejects(db.exec("update superfight_competitors set matchmaking_pool='matched'"), /matchmaking_pool_check/);
    await assert.rejects(db.exec("update superfight_competitors set matchmaking_pool=null"), /not-null/);
    const after = await db.query("select to_jsonb(c) - 'matchmaking_pool' as row from superfight_competitors c order by id");
    for (let i = 0; i < before.rows.length; i++) {
      delete before.rows[i].row.updated_at;
      delete after.rows[i].row.updated_at;
    }
    assert.deepEqual(after.rows, before.rows);
    assert.deepEqual((await db.query("select * from superfight_matches")).rows, matches.rows);
    assert.deepEqual((await db.query("select * from superfight_match_confirmations order by id")).rows, confirmations.rows);
    await db.query("update superfight_competitors set matchmaking_pool='john_wick' where id=$1", [fighters[0].id]);
    await db.exec("update superfight_matches set state='unmatched', unmatched_at=now()");
    assert.equal((await db.query("select matchmaking_pool from superfight_competitors where id=$1", [fighters[0].id])).rows[0].matchmaking_pool, "john_wick");
  } finally { await db.close(); }
});
