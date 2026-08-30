import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publicFiles = ["index.html", "event.html", "fighters.html", "ppv.html", "crispy.html"];

async function readPublicPages() {
  return Promise.all(publicFiles.map((file) => readFile(new URL(`../${file}`, import.meta.url), "utf8")));
}

test("public event pages present Roll With It 3 without previous-event promotion", async () => {
  const pages = await readPublicPages();
  const combined = pages.join("\n");

  assert.match(combined, /Roll With It 3/i);
  assert.match(combined, /October 3, 2026/i);
  assert.match(combined, /SOMArts/i);
  assert.doesNotMatch(combined, /June\s+6|The Revolution|Contra Costa|Antioch/i);
  assert.doesNotMatch(combined, /buytickets|tickettailor|dacast|docs\.google\.com\/forms/i);
  assert.doesNotMatch(combined, /poster\.jpg|ppv-splash/i);
});

test("public routes point competitors and retired promotions to current RWI 3 pages", async () => {
  const routes = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const redirectMap = new Map(routes.redirects.map(({ source, destination }) => [source, destination]));
  const rewriteMap = new Map(routes.rewrites.map(({ source, destination }) => [source, destination]));

  assert.equal(rewriteMap.get("/event"), "/event.html");
  assert.equal(rewriteMap.get("/fighters"), "/fighters.html");
  assert.equal(rewriteMap.get("/contact"), "/contact.html");
  assert.equal(redirectMap.get("/tickets"), "/event");
  assert.equal(redirectMap.get("/BJJ"), "/superfight");
  assert.equal(redirectMap.get("/bjj"), "/superfight");
  assert.equal([...redirectMap.values()].some((destination) => /buytickets|tickettailor|docs\.google\.com/i.test(destination)), false);
});
