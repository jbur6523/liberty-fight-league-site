import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// Render exact event typography and the unchanged official SVG into a crawler-friendly PNG.
const logo = Buffer.from(await readFile(new URL("../rwi-logo.svg", import.meta.url))).toString("base64");
const lights = Array.from({ length: 27 }, (_, i) => `<circle cx="${54 + i * 42}" cy="32" r="2"/><circle cx="${54 + i * 42}" cy="598" r="2"/>`).join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="arena"><stop stop-color="#691323"/><stop offset="1" stop-color="#09090d"/></radialGradient>
    <linearGradient id="gold" x2="0.3" y2="1"><stop stop-color="#fff0bd"/><stop offset=".5" stop-color="#f1ce79"/><stop offset="1" stop-color="#b98939"/></linearGradient>
    <linearGradient id="red" x2="0" y2="1"><stop stop-color="#f0324b"/><stop offset="1" stop-color="#ac1028"/></linearGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="17"/></filter>
  </defs>
  <rect width="1200" height="630" fill="#08090c"/>
  <ellipse cx="600" cy="50" rx="800" ry="590" fill="url(#arena)"/>
  <g fill="#f42b43" opacity=".1"><path d="M60 0 440 570 610 570 130 0Z"/><path d="M1140 0 760 570 590 570 1070 0Z"/></g>
  <g stroke="#ec2844" stroke-width="3" opacity=".2"><path d="M65 0 405 630M1135 0 795 630"/></g>
  <rect x="25" y="24" width="1150" height="582" rx="13" fill="none" stroke="#f12445" stroke-width="7" opacity=".5" filter="url(#glow)"/>
  <rect x="24" y="23" width="1152" height="584" rx="12" fill="none" stroke="#925437"/>
  <rect x="40" y="48" width="1120" height="534" rx="5" fill="none" stroke="#e8bf6422"/>
  <g fill="#efcc82" opacity=".65">${lights}</g>
  <rect x="82" y="74" width="86" height="86" rx="7" fill="#faf9f5"/>
  <image href="data:image/svg+xml;base64,${logo}" x="82" y="74" width="86" height="86"/>
  <g font-family="Arial, Helvetica, sans-serif">
    <text x="188" y="109" fill="#f0e9e0" font-size="23" font-weight="700" letter-spacing="2">LIBERTY FIGHT LEAGUE</text>
    <text x="188" y="140" fill="#bfa98f" font-size="15" letter-spacing="4">SAN FRANCISCO · FIGHT NIGHT</text>
    <rect x="848" y="90" width="270" height="48" rx="24" fill="#230d14" stroke="#b23848"/>
    <circle cx="876" cy="114" r="6" fill="#ff4058"/>
    <text x="896" y="121" fill="#ffeded" font-size="20" font-weight="700" letter-spacing="1">LIVE FAN ODDS</text>
    <text x="600" y="287" text-anchor="middle" fill="#000" opacity=".55" font-size="98" font-weight="900" letter-spacing="-3">ROLL WITH IT 3</text>
    <text x="600" y="282" text-anchor="middle" fill="url(#gold)" font-size="98" font-weight="900" letter-spacing="-3">ROLL WITH IT 3</text>
    <path d="M400 307H800" stroke="#d82b43" stroke-width="3"/>
    <text x="600" y="356" text-anchor="middle" fill="#f7f3ef" font-size="31" font-weight="700" letter-spacing="2">OCTOBER 3, 2026 · 4:00 PM</text>
    <text x="600" y="400" text-anchor="middle" fill="#c9bcc1" font-size="24">SOMArts · San Francisco</text>
    <rect x="83" y="459" width="1034" height="89" rx="7" fill="#09090bb3" stroke="#653638"/>
    <rect x="98" y="473" width="380" height="61" rx="5" fill="url(#red)" stroke="#ff6576"/>
    <text x="288" y="512" text-anchor="middle" fill="#fff" font-size="24" font-weight="700" letter-spacing="1">GET YOUR TICKETS</text>
    <text x="512" y="512" fill="#f3d28a" font-size="28" font-weight="700">CornerPass.com/RWI3</text>
    <text x="1085" y="512" text-anchor="end" fill="#e9c87b" font-size="32">↗</text>
    <text x="600" y="574" text-anchor="middle" fill="#b3a4aa" font-size="15" letter-spacing=".4">FAN PICKS ONLY — NO REAL-MONEY BETTING</text>
  </g>
</svg>`;
const directory = new URL("../social/", import.meta.url);
await mkdir(directory, { recursive: true });
await sharp(Buffer.from(svg)).png().toFile(fileURLToPath(new URL("rwi3-odds-v1.png", directory)));
console.log("Built social/rwi3-odds-v1.png (1200 × 630)");
