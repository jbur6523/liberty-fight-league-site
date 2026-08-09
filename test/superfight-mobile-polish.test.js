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
  assert.doesNotMatch(script, /incoming\.querySelector\([^\n]+\.focus/);
});

test("intro centers its application action", () => {
  const intro = html.match(/data-screen="intro"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.match(intro, /class="sf-actions sf-actions-centered"/);
  assert.match(css, /\.sf-actions-centered\s*{[\s\S]*?justify-content: center;/);
});

test("success screen places the Instagram CTA before the status actions", () => {
  const success = html.match(/data-screen="success"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.match(success, /id="open-status"/);
  assert.match(success, /id="copy-status"/);
  assert.match(success, /Follow @libertyfightleague on Instagram so we can contact you easily about your match\./);
  assert.match(success, /id="follow-instagram" href="https:\/\/www\.instagram\.com\/libertyfightleague"/);
  assert.match(success, />Follow on Instagram<\/a>/);
  assert.ok(success.indexOf('id="follow-instagram"') < success.indexOf('id="open-status"'));
});
