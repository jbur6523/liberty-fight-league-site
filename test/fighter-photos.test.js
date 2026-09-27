import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import handler from "../api/superfight-admin-photo.js";
import { validatedPhoto, saveFighterPhoto, MAX_PHOTO_BYTES } from "../src/server/fighter-photos.js";
import { getServiceSupabase } from "../src/server/supabase.js";

const validBody = async () => ({ type: "image/png", image: (await sharp({ create: { width: 40, height: 60, channels: 3, background: "#777777" } }).png().toBuffer()).toString("base64") });

test("uploads decode safely, strip metadata, keep aspect ratio, and reject unsafe types/size", async () => {
  const image = await validatedPhoto(await validBody());
  const result = await sharp(image).metadata();
  assert.equal(result.format, "webp");
  assert.equal(result.width / result.height, 40 / 60);
  assert.equal(result.exif, undefined);
  await assert.rejects(validatedPhoto({ type: "image/svg+xml", image: Buffer.from("<svg/>").toString("base64") }), /JPEG/);
  await assert.rejects(validatedPhoto({ type: "image/png", image: "a".repeat(Math.ceil(MAX_PHOTO_BYTES / 3) * 4 + 1) }), /3 MB/);
  await assert.rejects(validatedPhoto({ type: "image/png", image: "not base64!" }), /read/);
  await assert.rejects(validatedPhoto({ type: "image/png", image: Buffer.from("not an image").toString("base64") }), /valid/);
});

test("image upload, replacement, removal, failures and concurrent replacement preserve the competitor record", async () => {
  const fighter = { id: "competitor", fan_photo_path: null };
  const objects = new Map();
  let failUpload = false, conflict = false, failSave = false;
  const bucket = {
    async upload(path, buffer) { if (failUpload) return { error: new Error("Upload failed") }; objects.set(path, buffer); return {}; },
    async remove(paths) { for (const path of paths) objects.delete(path); return {}; },
    getPublicUrl(path) { return { data: { publicUrl: `https://example.com/${path}` } }; },
  };
  const service = {
    storage: { from() { return bucket; } },
    from() {
      let values;
      return { select() { return this; }, eq() { return this; }, is() { return this; }, update(input) { values = input; return this; },
        async maybeSingle() {
          if (values) {
            if (failSave) return { error: new Error("Save failed") };
            if (conflict) return { data: null };
            Object.assign(fighter, values);
          }
          return { data: { ...fighter } };
        },
      };
    },
  };
  const body = await validBody();
  const first = await saveFighterPhoto(service, fighter.id, body);
  const firstPath = fighter.fan_photo_path;
  assert.match(first.photoUrl, /competitor\/.*\.webp$/);
  assert.equal(objects.size, 1);
  const replacement = await saveFighterPhoto(service, fighter.id, body);
  assert.notEqual(replacement.photoUrl, first.photoUrl);
  assert(!objects.has(firstPath));
  assert.equal(objects.size, 1);
  const winningPath = fighter.fan_photo_path;
  failUpload = true;
  await assert.rejects(saveFighterPhoto(service, fighter.id, body));
  failUpload = false; failSave = true;
  await assert.rejects(saveFighterPhoto(service, fighter.id, body));
  assert.equal(objects.size, 2, "uncertain database write retains the new object rather than risking a broken reference");
  for (const path of objects.keys()) if (path !== winningPath) objects.delete(path);
  failSave = false; conflict = true;
  await assert.rejects(saveFighterPhoto(service, fighter.id, body), /another window/);
  conflict = false;
  assert.equal(fighter.fan_photo_path, winningPath);
  assert.equal(objects.size, 1);
  assert.equal((await saveFighterPhoto(service, fighter.id, {}, true)).photoUrl, null);
  assert.equal(fighter.fan_photo_path, null);
  assert.equal(objects.size, 0);
});

test("photo endpoint requires existing promoter authorization and same-origin requests", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-key";
  const service = getServiceSupabase();
  const original = { rpc: service.rpc, getUser: service.auth.getUser };
  let authorized = false;
  service.auth.getUser = async () => ({ data: { user: { id: "admin" } } });
  service.rpc = async () => ({ data: authorized });
  const call = async (cookie, origin = "https://example.com", method = "POST") => {
    const response = { setHeader() {}, end(text) { this.payload = JSON.parse(text); } };
    await handler({ method, headers: { cookie, origin, host: "example.com" }, body: {} }, response);
    return response.statusCode;
  };
  try {
    assert.equal(await call(), 401);
    assert.equal(await call("lfl_superfight_access=test"), 403);
    authorized = true;
    assert.equal(await call("lfl_superfight_access=test", "https://evil.example"), 403);
    assert.equal(await call("lfl_superfight_access=test", "https://example.com", "GET"), 405);
  } finally { service.rpc = original.rpc; service.auth.getUser = original.getUser; }
});
