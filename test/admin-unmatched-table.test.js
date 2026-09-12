import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("admin unmatched table uses the requested display-only columns and names", async () => {
  const [script, styles] = await Promise.all([
    readFile(new URL("../admin-superfights.js", import.meta.url), "utf8"),
    readFile(new URL("../admin-superfights.css", import.meta.url), "utf8"),
  ]);
  const unmatchedRenderer = script.slice(
    script.indexOf("function unmatchedTableName"),
    script.indexOf("function confirmationBadge"),
  );

  assert.match(unmatchedRenderer, /<th>Name<\/th><th>Gi \/ No-Gi \/ Both<\/th><th>Weight<\/th><th>Instagram<\/th>/);
  assert.doesNotMatch(unmatchedRenderer, /<th>Age<\/th>|<th>Gender<\/th>|<th>Belt<\/th>|<th>Match Action<\/th>|Acceptable weights/);
  const formatName = new Function("escapeHtml", `${script.slice(
    script.indexOf("function unmatchedTableName"),
    script.indexOf("function unmatchedBeltClass"),
  )}; return unmatchedTableName;`)((value) => value);
  assert.equal(formatName({ name: "Jordan Lee", age: 27 }), "Jordan (27)");
  assert.equal(formatName({ name: "  Ana   Maria Silva  ", age: 24, genderDivision: "womens" }), "Ana 💕 (24)");
  assert.equal(formatName({ name: "Luca" }), "Luca (—)");
  assert.equal(formatName({ name: "Élodie Martin", age: 30 }), "Élodie (30)");
  assert.match(unmatchedRenderer, /competitor\.genderDivision === "womens" \? " 💕" : ""/);
  assert.match(unmatchedRenderer, /\(\$\{competitor\.age \?\? "—"\}\)/);
  assert.match(unmatchedRenderer, /weightSummary\(competitor, true\)/);
  assert.match(unmatchedRenderer, /label\(competitor\.grapplingPreference\)/);
  assert.match(unmatchedRenderer, /new Set\(\["blue", "purple", "brown", "black"\]\)/);
  assert.match(unmatchedRenderer, /addEventListener\("dblclick"[\s\S]*?selectCompetitor\(button\.dataset\.unmatchedName\)/);
  assert.match(unmatchedRenderer, /addEventListener\("touchend"[\s\S]*?touchedAt - lastTouchAt < 350[\s\S]*?selectCompetitor\(button\.dataset\.unmatchedName\)/);
  assert.match(unmatchedRenderer, /data-select="\$\{competitor\.id\}"/);
  assert.match(styles, /\.admin-unmatched-table\s*{[\s\S]*?min-width: 0;[\s\S]*?table-layout: fixed;/);
  for (const belt of ["blue", "purple", "brown", "black"]) {
    assert.match(styles, new RegExp(`\\.admin-name-button\\.belt-${belt} \\{ color:`));
  }
});
