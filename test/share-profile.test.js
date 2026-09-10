import test from "node:test";
import assert from "node:assert/strict";
import { profileShareUrl, readProfileSnapshot } from "../src/superfight/share-profile.js";

test("share links round-trip Unicode and contain only the public profile fields", () => {
  const fighter = { name: "José 李 #1", age: 27, belt: "blue", gym: "A&B", instagramHandle: "jose", weightOptions: [{ id: "private-id", label: "Light — 155 lb" }], phone: "private-phone", email: "private-email", notes: "private-notes", statusPath: "/status/private-token" };
  const url = new URL(profileShareUrl(fighter, "https://example.com"));
  assert.equal(url.pathname, "/fighter-profile.html");
  assert.deepEqual(readProfileSnapshot(url.hash), { name: fighter.name, age: 27, belt: "blue", gym: "A&B", instagramHandle: "jose", weightClasses: ["Light — 155 lb"] });
  assert.ok(!decodeURIComponent(url.hash).includes("private"));
});

test("missing optional details remain shareable and malformed links are rejected", () => {
  assert.equal(readProfileSnapshot(new URL(profileShareUrl({ name: "Casey" }, "https://example.com")).hash).age, null);
  for (const hash of ["", "#%", "#null", "#{}", "#[]", "#" + encodeURIComponent(JSON.stringify({ name: "Test", age: 23, belt: {}, gym: "", instagramHandle: "", weightClasses: [] }))]) {
    assert.equal(readProfileSnapshot(hash), null);
  }
});
