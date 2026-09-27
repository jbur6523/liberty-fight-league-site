import test from "node:test";
import assert from "node:assert/strict";
import { boardMatches, isMainEvent } from "../src/superfight/board-order.js";

const eventId = "0dba77b1-763a-4614-bb9c-cea568e0576c";
const main = { id: "2cdc3fa5-17dd-4e16-9133-ecc2577445fb", fighters: [
  { id: "82c86753-55f7-49c6-87bb-dfbb27565680", name: "Updated name" },
  { id: "bc52aeaa-f40a-4a43-8866-a2871a677836", name: "Ty C." },
] };
const others = [{ id: "a", fighters: [] }, { id: "b", fighters: [] }];

test("main event leads only its event, preserving other order and original matchup objects", () => {
  const input = [...others, main];
  const ordered = boardMatches(eventId, input);
  assert.deepEqual(ordered, [main, ...others]);
  assert.equal(ordered[0], main);
  assert.deepEqual(input, [...others, main]);
  assert.deepEqual(boardMatches("next-event", input), input);
  assert.equal(isMainEvent(eventId, main), true);
});

test("removed or changed main-event pairings are never fabricated or promoted", () => {
  assert.deepEqual(boardMatches(eventId, others), others);
  const changed = { ...main, fighters: [main.fighters[0], { id: "replacement" }] };
  assert.equal(isMainEvent(eventId, changed), false);
  assert.deepEqual(boardMatches(eventId, [...others, changed]), [...others, changed]);
});
