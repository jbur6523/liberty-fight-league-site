import test from "node:test";
import assert from "node:assert/strict";
import { squareCrop } from "../src/superfight/photo-crop.js";

test("square crops cover portrait, landscape and square photos without empty edges", () => {
  for (const [width, height] of [[1200, 800], [800, 1200], [800, 800]]) {
    const centered = squareCrop(width, height);
    assert.equal(centered.size, 800);
    assert.equal(centered.centerX, width / 2);
    assert.equal(centered.centerY, height / 2);
    for (const zoom of [1, 2, 4]) {
      for (const center of [-10000, 0, 500, 10000]) {
        const crop = squareCrop(width, height, zoom, center, center);
        assert.equal(crop.size, 800 / zoom);
        assert.ok(crop.x >= 0 && crop.y >= 0);
        assert.ok(crop.x + crop.size <= width && crop.y + crop.size <= height);
      }
    }
  }
});

test("zoom preserves the selected center until an image edge constrains it", () => {
  const selected = squareCrop(1600, 1000, 2, 1200, 600);
  const closer = squareCrop(1600, 1000, 4, selected.centerX, selected.centerY);
  assert.equal(closer.centerX, 1200);
  assert.equal(closer.centerY, 600);
  assert.equal(closer.size, 250);
  const wider = squareCrop(1600, 1000, 1, closer.centerX, closer.centerY);
  assert.equal(wider.x + wider.size, 1600);
  assert.equal(wider.y, 0);
});
