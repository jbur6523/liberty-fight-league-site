import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("unmatched competitors can be safely withdrawn from the three-dot action", async () => {
  const [script, styles, api] = await Promise.all([
    readFile(new URL("../admin-superfights.js", import.meta.url), "utf8"),
    readFile(new URL("../admin-superfights.css", import.meta.url), "utf8"),
    readFile(new URL("../api/superfight-admin-competitor.js", import.meta.url), "utf8"),
  ]);

  assert.match(script, /data-delete-competitor="\$\{competitor\.id\}"/);
  assert.match(script, /window\.confirm\([\s\S]*?Delete \$\{competitor\.name\} from matchmaking/);
  assert.match(script, /body: JSON\.stringify\(\{ action: "withdraw", competitorId \}\)/);
  assert.match(styles, /\.admin-overflow-button\s*\{/);

  assert.match(api, /body\.action === "withdraw"/);
  assert.match(api, /\.eq\("state", "active"\)[\s\S]*?fighter_a_id\.eq\.\$\{competitorId\},fighter_b_id\.eq\.\$\{competitorId\}/);
  assert.match(api, /update\(\{ record_state: "withdrawn" \}\)/);
  assert.match(api, /Unmatch this competitor before deleting them/);
});
