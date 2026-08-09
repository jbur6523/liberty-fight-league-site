import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, script, css] = await Promise.all([
  readFile(new URL("../superfight.html", import.meta.url), "utf8"),
  readFile(new URL("../superfight.js", import.meta.url), "utf8"),
  readFile(new URL("../superfight.css", import.meta.url), "utf8"),
]);

test("every application back button uses the same accessible SVG icon", () => {
  const buttons = html.match(/<button class="sf-button secondary sf-back"[\s\S]*?<\/button>/g) ?? [];
  assert.equal(buttons.length, 8);
  assert.ok(buttons.every((button) => button.includes('aria-label="Back"')));
  assert.ok(buttons.every((button) => button.includes('class="sf-back-icon"')));
  assert.doesNotMatch(html, /â†|Â†|>←<|>â/);
});

test("mobile viewport and focus handling use resizing and semantic scrolling", () => {
  assert.match(html, /interactive-widget=resizes-content/);
  assert.match(script, /window\.visualViewport/);
  assert.match(script, /scrollIntoView\(\{ block: "center"/);
  assert.match(css, /--sf-viewport-height: 100dvh/);
  assert.match(css, /min-height: var\(--sf-viewport-height\)/);
});

test("success screen keeps status actions and adds the Instagram CTA", () => {
  const success = html.match(/data-screen="success"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.match(success, /id="open-status"/);
  assert.match(success, /id="copy-status"/);
  assert.match(success, /Follow @libertyfightleague on Instagram so we can contact you easily about your match\./);
  assert.match(success, /id="follow-instagram" href="https:\/\/www\.instagram\.com\/libertyfightleague"/);
  assert.match(success, />Follow on Instagram<\/a>/);
});
