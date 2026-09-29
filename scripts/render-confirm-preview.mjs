import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// Raster social previews use the unmodified official SVG artwork as a layer.
const root = new URL("../", import.meta.url);
const logo = await sharp(await readFile(new URL("rwi-logo.svg", root)))
  .resize(500, 500)
  .png()
  .toBuffer();
const artwork = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#101113"/>
  <rect width="1200" height="12" fill="#ff2633"/>
  <path d="M940 12H1200V630H1110L810 12Z" fill="#191a1d"/>
  <rect x="48" y="98" width="390" height="400" rx="28" fill="#f6f5f1"/>
  <g font-family="Arial, Helvetica, sans-serif">
    <text x="496" y="105" fill="#c3c4c8" font-size="22" font-weight="700" letter-spacing="3">LIBERTY FIGHT LEAGUE</text>
    <rect x="496" y="135" width="66" height="6" rx="3" fill="#ff2633"/>
    <g font-size="70" font-weight="900" letter-spacing="-2">
      <text x="492" y="230" fill="#ffffff">CONFIRM</text>
      <text x="492" y="308" fill="#ffffff">YOUR</text>
      <text x="492" y="386" fill="#ff3844">SUPERFIGHT</text>
    </g>
    <text x="496" y="454" fill="#e3e3e6" font-size="27">Review your matchup &amp; details.</text>
    <line x1="48" y1="546" x2="1152" y2="546" stroke="#36373b"/>
    <text x="48" y="588" fill="#adaeb4" font-size="20" letter-spacing="2">COMPETITOR CONFIRMATION</text>
    <path d="M1090 579h51m-13-13 13 13-13 13" fill="none" stroke="#ff3844" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`);
await mkdir(new URL("social/", root), { recursive: true });
await sharp(artwork)
  .composite([{ input: logo, left: -12, top: 68 }])
  .png()
  .toFile(fileURLToPath(new URL("social/confirm-superfight-v1.png", root)));
console.log("Rendered social/confirm-superfight-v1.png (1200 × 630).");
