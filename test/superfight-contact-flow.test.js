import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, script] = await Promise.all([
  readFile(new URL("../superfight.html", import.meta.url), "utf8"),
  readFile(new URL("../superfight.js", import.meta.url), "utf8"),
]);

test("public contact step contains Instagram and Cell Phone without email", () => {
  const contact = html.match(/data-screen="contact"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.match(contact, /for="instagram">Instagram</);
  assert.match(contact, /for="phone">Cell Phone</);
  assert.match(contact, /name="preferredContactMethod" value="instagram"/);
  assert.match(contact, /name="preferredContactMethod" value="cell_phone"/);
  assert.doesNotMatch(contact, /email/i);
});

test("Instagram is collected once and has no separate application step", () => {
  assert.equal((html.match(/id="instagram"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /data-screen="instagram"/);
  assert.doesNotMatch(script, /"gym", "instagram"/);
  assert.match(script, /const questionScreens = \["name", "contact", "age", "division", "grappling", "belt", "weight", "gym"\]/);
});

test("the final gym step submits the application", () => {
  const gym = html.match(/data-screen="gym"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.match(gym, /type="submit" id="submit-button"/);
});
