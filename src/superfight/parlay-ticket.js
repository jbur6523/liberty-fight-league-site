import { combinedFanOdds } from "./parlay.js";

const xml = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const fit = (text, max) => [...String(text)].length > max ? [...String(text)].slice(0, max - 1).join("") + "…" : String(text);

export function parlayTicketSvg({ eventName, legs, capturedAt, logoDataUrl = "", kind = "parlay" }) {
  const normalPicks = kind === "fan-picks";
  if (legs.length < (normalPicks ? 1 : 2)) throw new Error(normalPicks ? "Make a Fan Pick before downloading a ticket." : "Choose at least two picks before downloading a ticket.");
  const height = 610 + legs.length * 94;
  const footer = 412 + legs.length * 94;
  const stamp = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles" }).format(new Date(capturedAt));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${height}" viewBox="0 0 1000 ${height}">
  <defs><linearGradient id="bg" x2=".7" y2="1"><stop stop-color="#38101e"/><stop offset=".5" stop-color="#111116"/><stop offset="1" stop-color="#08090c"/></linearGradient><linearGradient id="gold" x2="0" y2="1"><stop stop-color="#ffe8a6"/><stop offset="1" stop-color="#c59643"/></linearGradient></defs>
  <rect width="1000" height="${height}" fill="url(#bg)"/>
  <rect x="24" y="24" width="952" height="${height - 48}" rx="20" fill="none" stroke="#987544" stroke-width="2"/>
  <g font-family="Arial, Helvetica, sans-serif">
  ${logoDataUrl ? `<rect x="64" y="64" width="92" height="92" rx="8" fill="#faf9f5"/><image href="${xml(logoDataUrl)}" x="64" y="64" width="92" height="92"/>` : ""}
  <text x="${logoDataUrl ? 180 : 64}" y="98" fill="#f3e8df" font-size="23" font-weight="700" letter-spacing="2">LIBERTY FIGHT LEAGUE</text>
  <text x="${logoDataUrl ? 180 : 64}" y="137" fill="#c5ad92" font-size="19" letter-spacing="3">${normalPicks ? "MY FAN PICKS" : "MY FAN PARLAY"}</text>
  <text x="64" y="225" fill="url(#gold)" font-size="${Math.min(62, 1400 / Math.max(eventName.length, 1))}" font-weight="900">${xml(fit(eventName.toUpperCase(), 60))}</text>
  <text x="66" y="265" fill="#c8b9c5" font-size="22">${normalPicks ? `${legs.length} SAVED FAN ${legs.length === 1 ? "PICK" : "PICKS"}` : `${legs.length}-LEG PARLAY`} · COMMUNITY FAN LINES</text>
  <rect x="64" y="295" width="872" height="91" rx="8" fill="#23141b" stroke="#8d3a48"/>
  ${normalPicks ? '<text x="88" y="332" fill="#f2cd79" font-size="26" font-weight="700">YOUR PICKS · INDIVIDUAL FAN ODDS</text><text x="88" y="364" fill="#c6b6c1" font-size="19">A snapshot of your saved votes and current community lines</text>' : `<text x="88" y="330" fill="#c6b6c1" font-size="19" letter-spacing="1">COMBINED FAN ODDS</text><text x="911" y="358" text-anchor="end" fill="#f2cd79" font-size="${combinedFanOdds(legs).length > 14 ? 32 : 52}" font-weight="800">${xml(combinedFanOdds(legs))}</text>`}
  ${legs.map((leg, i) => {
    const y = 441 + i * 94;
    return `<circle cx="80" cy="${y - 9}" r="14" fill="#3a2c17" stroke="#b3914c"/><text x="80" y="${y - 3}" text-anchor="middle" fill="#e8c578" font-size="17">✓</text><text x="113" y="${y}" fill="#f1edf1" font-size="29" font-weight="700">${xml(fit(leg.name, 35))}</text><text x="113" y="${y + 30}" fill="#b3a5b5" font-size="19">${xml(fit(leg.academy || "", 65))}</text><text x="930" y="${y + 3}" text-anchor="end" fill="#edcc81" font-size="29" font-weight="700">${xml(leg.fanOdds)}</text><path d="M64 ${y + 51}H936" stroke="#39303a"/>`;
  }).join("")}
  <text x="64" y="${footer + 24}" fill="#b9a8b9" font-size="18">LINES CAPTURED ${xml(stamp)} PT</text>
  <text x="64" y="${footer + 61}" fill="#f0ce83" font-size="24" font-weight="700">LibertyFightLeague.com/odds</text>
  <text x="64" y="${footer + 103}" fill="#dbccd9" font-size="19">Fan Picks only — no real-money betting.</text>
  <text x="64" y="${footer + 135}" fill="#a99bad" font-size="17">For fun only · No wagering, payouts or prizes · Not an admission ticket</text>
  </g></svg>`;
}

export async function createParlayTicket({ eventName, legs, capturedAt = new Date().toISOString(), kind = "parlay" }) {
  let logoDataUrl = "";
  try {
    const response = await fetch("/rwi-logo.svg");
    if (response.ok) logoDataUrl = `data:image/svg+xml;base64,${btoa(await response.text())}`;
  } catch { /* The ticket still works if the brand asset is temporarily unavailable. */ }
  const source = new Blob([parlayTicketSvg({ eventName, legs, capturedAt, logoDataUrl, kind })], { type: "image/svg+xml" });
  const url = URL.createObjectURL(source);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image export is unavailable in this browser.");
    context.drawImage(image, 0, 0);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Couldn't create the ticket image.")), "image/png"));
    return { blob, capturedAt };
  } finally { URL.revokeObjectURL(url); }
}
