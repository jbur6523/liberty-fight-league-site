import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { restoreParlay, rememberParlay } from "../src/superfight/parlay-storage.js";
import { parlayTicketSvg } from "../src/superfight/parlay-ticket.js";

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), values };
}
const data = () => ({ event: { id: "event-1" }, matches: [{ id: "m1", fighters: [{ id: "a" }, { id: "b" }] }, { id: "m2", fighters: [{ id: "c" }, { id: "d" }] }] });

test("anonymous parlay autosave restores identifiers, updates choices and clears durably", () => {
  const store = storage(), snapshot = data();
  const picks = new Map([["m1", "a"], ["m2", "d"]]);
  assert.equal(rememberParlay(store, snapshot.event.id, picks), true);
  assert.deepEqual(restoreParlay(store, snapshot), [...picks]);
  picks.set("m1", "b"); rememberParlay(store, snapshot.event.id, picks);
  assert.deepEqual(restoreParlay(store, snapshot), [["m1", "b"], ["m2", "d"]]);
  const saved = JSON.parse([...store.values.values()][0]);
  assert.deepEqual(Object.keys(saved), ["version", "eventId", "picks"]);
  rememberParlay(store, snapshot.event.id, new Map());
  assert.deepEqual(restoreParlay(store, snapshot), []);
  assert.equal(store.values.size, 0);
});

test("saved drafts are isolated by event and never transfer to changed or removed pairings", () => {
  const store = storage(), snapshot = data();
  rememberParlay(store, snapshot.event.id, new Map([["m1", "a"], ["m2", "d"]]));
  assert.deepEqual(restoreParlay(store, { ...snapshot, event: { id: "event-2" } }), []);
  rememberParlay(store, "event-2", new Map([["m1", "b"]]));
  assert.deepEqual(restoreParlay(store, snapshot), [["m1", "a"], ["m2", "d"]]);
  snapshot.matches[0].id = "new-pairing";
  snapshot.matches[1].fighters = [{ id: "c" }, { id: "replacement" }];
  assert.deepEqual(restoreParlay(store, snapshot), []);
  assert.equal(store.values.size, 2);
});

test("blocked, corrupt and unavailable browser storage never breaks voting or restoration", () => {
  const snapshot = data();
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); }, removeItem() { throw new Error("blocked"); } };
  assert.deepEqual(restoreParlay(blocked, snapshot), []);
  assert.equal(rememberParlay(blocked, "event-1", new Map([["m1", "a"]])), false);
  assert.equal(rememberParlay(blocked, "event-1", new Map()), false);
  assert.deepEqual(restoreParlay(null, snapshot), []);
  for (const raw of ["invalid", "null", JSON.stringify({ version: 9 }), JSON.stringify({ version: 1, eventId: "wrong", picks: [["m1", "a"]] })]) assert.deepEqual(restoreParlay({ getItem: () => raw }, snapshot), []);
  const tampered = JSON.stringify({ version: 1, eventId: "event-1", picks: [null, {}, ["m1", "a"], ["m1", "b"], ["missing", "a"], ["m2", "a"]] });
  assert.deepEqual(restoreParlay({ getItem: () => tampered }, snapshot), [["m1", "b"]]);
});

const legs = [{ id: "a", name: "Fernando P.", academy: "Live Oak Jiu-Jitsu", fanOdds: "PK" }, { id: "b", name: "Theodore V.", academy: "Kaiju BJJ", fanOdds: "+150" }];
const ticket = { eventName: "Roll With It 3", legs, capturedAt: "2026-09-27T20:00:00.000Z" };

test("downloaded ticket captures named picks, combined lines, timestamp and fan-only wording", async () => {
  const svg = parlayTicketSvg(ticket);
  for (const text of ["ROLL WITH IT 3", "Fernando P.", "Theodore V.", "+400", "2-LEG PARLAY", "Sep 27, 2026", "1:00 PM PT", "no real-money betting", "Not an admission ticket"]) assert(svg.includes(text), text);
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const meta = await sharp(png).metadata();
  assert.equal(meta.width, 1000);
  assert.equal(meta.height, 798);
  assert.equal(meta.format, "png");
  assert.equal(legs[0].fanOdds, "PK", "image export never changes live picks");
});

test("ticket rendering escapes text and sizes itself to include every selected leg", async () => {
  const escaped = parlayTicketSvg({ ...ticket, legs: [{ ...legs[0], name: '<script>&"', academy: "A & B" }, legs[1]] });
  assert(escaped.includes("&lt;script&gt;&amp;&quot;"));
  assert(!escaped.includes("<script>"));
  const many = parlayTicketSvg({ ...ticket, legs: Array.from({ length: 29 }, (_, i) => ({ ...legs[0], name: `Fighter ${i + 1}.` })) });
  assert(many.includes("Fighter 29."));
  const meta = await sharp(Buffer.from(many)).metadata();
  assert.equal(meta.height, 3336);
  assert.throws(() => parlayTicketSvg({ ...ticket, legs: [] }), /two picks/);
});
