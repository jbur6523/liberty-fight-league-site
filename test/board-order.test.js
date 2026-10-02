import test from "node:test";
import assert from "node:assert/strict";
import { boardMatches, isMainEvent } from "../src/superfight/board-order.js";

const eventId = "0dba77b1-763a-4614-bb9c-cea568e0576c";
const first = { id: "8865d9ec-374a-46cc-bf9d-db4437897a42", fighters: [], selectedFighterId: "saved-pick" };
const second = { id: "a0c8776c-dd8b-4776-ac2f-77fc3d6a318b", fighters: [] };
const group = { id: "314b1cb4-5972-4584-90a4-5ca331fcb97c", groupPick: true, fighters: [] };
const main = { id: "2cdc3fa5-17dd-4e16-9133-ecc2577445fb", fighters: [
  { id: "82c86753-55f7-49c6-87bb-dfbb27565680" },
  { id: "bc52aeaa-f40a-4a43-8866-a2871a677836" },
] };

test("scheduled card order supersedes main-event promotion without changing match or pick data", () => {
  const input = [main, group, second, first];
  const ordered = boardMatches(eventId, input);
  assert.deepEqual(ordered, [first, second, group, main]);
  assert.equal(ordered[0], first);
  assert.equal(ordered[2], group);
  assert.equal(ordered[0].selectedFighterId, "saved-pick");
  assert.deepEqual(input, [main, group, second, first]);
  assert.equal(isMainEvent(eventId, main), true);
});

test("other events retain their supplied order and new cards remain visible at the end", () => {
  const unknownA = { id: "new-a", fighters: [] };
  const unknownB = { id: "new-b", fighters: [] };
  const input = [unknownA, main, unknownB, first];
  assert.deepEqual(boardMatches("another-event", input), input);
  assert.deepEqual(boardMatches(eventId, input), [first, main, unknownA, unknownB]);
  assert.deepEqual(boardMatches(eventId, []), []);
  assert.deepEqual(boardMatches(eventId, [second]), [second]);
});

test("main-event label still requires the original pairing", () => {
  assert.equal(isMainEvent(eventId, { ...main, fighters: [main.fighters[0], { id: "replacement" }] }), false);
  assert.equal(isMainEvent("another-event", main), false);
});
