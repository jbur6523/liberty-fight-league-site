import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../admin-superfights.js", import.meta.url), "utf8");

function handlerSource(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Missing ${startMarker}`);
  assert.notEqual(end, -1, `Missing ${endMarker}`);
  return source.slice(start, end);
}

test("Quick Add retains the form before awaiting the API response", () => {
  const handler = handlerSource(
    'document.querySelector("#quick-add-form")',
    'document.querySelector("#match-form")',
  );
  const captureIndex = handler.indexOf("const form = event.currentTarget;");
  const awaitIndex = handler.indexOf("await api(");
  const resetIndex = handler.indexOf("form.reset();");

  assert.ok(captureIndex >= 0 && captureIndex < awaitIndex);
  assert.ok(resetIndex > awaitIndex);
  assert.doesNotMatch(handler, /event\.currentTarget\.reset\(\)/);
});

test("weight setup retains the form before awaiting the API response", () => {
  const handler = handlerSource(
    'document.querySelector("#weight-form")',
    "async function initialize()",
  );
  const captureIndex = handler.indexOf("const form = event.currentTarget;");
  const awaitIndex = handler.indexOf("await api(");
  const resetIndex = handler.indexOf("form.reset();");

  assert.ok(captureIndex >= 0 && captureIndex < awaitIndex);
  assert.ok(resetIndex > awaitIndex);
  assert.doesNotMatch(handler, /event\.currentTarget\.reset\(\)/);
});
