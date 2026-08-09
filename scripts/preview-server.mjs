import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const port = Number(process.env.PORT || 4173);
const root = path.resolve(".");
const previewEvent = {
  id: "00000000-0000-4000-8000-000000000100",
  slug: "preview-event",
  name: "Superfight Preview Event",
  startsAt: "2026-10-10T23:00:00.000Z",
  venue: "Preview Venue · California",
  applicationInfo: "A local interface preview using sample configuration only.",
  applicationsOpen: true,
  instagramUrl: "https://instagram.com/libertyfightleague",
  weightOptions: [
    { id: "00000000-0000-4000-8000-000000000151", label: "Preview · 150 lb", valueLbs: 150 },
    { id: "00000000-0000-4000-8000-000000000156", label: "Preview · 155 lb", valueLbs: 155 },
  ],
};

const competitors = [
  { id: "00000000-0000-4000-8000-000000000201", name: "Jordan Lee", age: 27, genderDivision: "womens", grapplingPreference: "both", belt: "blue", weightLbs: 150, gym: "North Bay Jiu-Jitsu", instagramHandle: "jordanlee", instagramUrl: "https://instagram.com/jordanlee", source: "public_application", createdAt: new Date().toISOString(), statusPath: "/status/00000000-0000-4000-8000-000000000401" },
  { id: "00000000-0000-4000-8000-000000000202", name: "Casey Morgan", age: 29, genderDivision: "womens", grapplingPreference: "gi", belt: "blue", weightLbs: 155, gym: "Bay Area Grappling", instagramHandle: "caseymorgan", instagramUrl: "https://instagram.com/caseymorgan", source: "admin_quick_add", createdAt: new Date().toISOString(), statusPath: "/status/00000000-0000-4000-8000-000000000402" },
  { id: "00000000-0000-4000-8000-000000000203", name: "Riley Santos", age: 31, genderDivision: "mens", grapplingPreference: "no_gi", belt: "purple", weightLbs: 160, gym: "Liberty Academy", instagramHandle: "rileysantos", instagramUrl: "https://instagram.com/rileysantos", source: "public_application", createdAt: new Date().toISOString(), statusPath: "/status/00000000-0000-4000-8000-000000000403" },
];

function json(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function confirmationPayload(response = "awaiting", gym = "North Bay Jiu-Jitsu") {
  return {
    event: { name: previewEvent.name, startsAt: previewEvent.startsAt, venue: previewEvent.venue },
    fighter: { name: "Jordan Lee", belt: "blue", gym },
    opponent: { name: "Casey Morgan", belt: "blue", gym: "Bay Area Grappling" },
    match: { weightLbs: 155, boutType: "gi", active: true },
    confirmation: { response, respondedAt: response === "awaiting" ? null : new Date().toISOString() },
  };
}

async function mockApi(request, response, url) {
  if (url.pathname === "/api/superfight-event") return json(response, 200, { event: previewEvent });
  if (url.pathname === "/api/superfight-apply") {
    await body(request);
    return json(response, 201, { received: true, statusPath: "/status/00000000-0000-4000-8000-000000000401" });
  }
  if (url.pathname === "/api/superfight-status") {
    return json(response, 200, {
      fighter: { name: "Jordan Lee", belt: "blue", gym: "North Bay Jiu-Jitsu" },
      opponent: { name: "Casey Morgan", belt: "blue", gym: "Bay Area Grappling", instagramHandle: "caseymorgan", instagramUrl: "https://instagram.com/caseymorgan" },
      event: { name: previewEvent.name, startsAt: previewEvent.startsAt, venue: previewEvent.venue },
      match: { weightLbs: 155, boutType: "gi", confirmation: { fighterA: "accepted", fighterB: "awaiting", summary: "fighter_a_accepted" } },
      status: "matched",
    });
  }
  if (url.pathname === "/api/superfight-confirm") {
    const input = request.method === "GET" ? {} : await body(request);
    return json(response, 200, confirmationPayload(input.response ?? "awaiting", input.gym ?? "North Bay Jiu-Jitsu"));
  }
  if (url.pathname === "/api/superfight-admin-session") {
    return json(response, 200, { signedIn: request.method !== "DELETE", email: "promoter@example.com" });
  }
  if (url.pathname === "/api/superfight-admin-events") {
    return json(response, 200, { events: [previewEvent] });
  }
  if (url.pathname === "/api/superfight-admin-competitors") {
    if (request.method === "POST") return json(response, 201, { competitor: competitors[0] });
    return json(response, 200, { competitors, sort: url.searchParams.get("sort") ?? "suggested" });
  }
  if (url.pathname === "/api/superfight-admin-matches") {
    if (request.method === "POST") return json(response, 200, { match: { id: "preview-match" } });
    return json(response, 200, {
      matches: [{
        id: "00000000-0000-4000-8000-000000000301",
        weightLbs: 155,
        boutType: "gi",
        confirmation: { summary: "fighter_a_accepted" },
        fighterA: { ...competitors[0], confirmationPath: "/confirm/00000000-0000-4000-8000-000000000501", response: "accepted" },
        fighterB: { ...competitors[1], confirmationPath: "/confirm/00000000-0000-4000-8000-000000000502", response: "awaiting" },
      }],
    });
  }
  if (url.pathname === "/api/superfight-admin-competitor") {
    return json(response, 200, {
      competitor: {
        ...competitors[0],
        eventId: previewEvent.id,
        phone: "(555) 010-2026",
        email: "jordan@example.com",
        notes: "Preview notes",
        recordState: "active",
        applicationSubmittedAt: new Date().toISOString(),
        match: null,
      },
    });
  }
  return json(response, 404, { message: "Preview endpoint not found." });
}

const rewrites = new Map([
  ["/superfight", "/superfight.html"],
  ["/admin/superfights", "/admin-superfights.html"],
]);

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname.startsWith("/api/")) return mockApi(request, response, url);

  let pathname = rewrites.get(url.pathname) ?? url.pathname;
  if (pathname.startsWith("/status/")) pathname = "/status.html";
  if (pathname.startsWith("/confirm/")) pathname = "/confirm.html";
  if (pathname === "/") pathname = "/index.html";
  const filePath = path.resolve(root, `.${decodeURIComponent(pathname)}`);
  if (!filePath.startsWith(root)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const details = await stat(filePath);
    if (!details.isFile()) throw new Error("not a file");
    const type = {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".jpg": "image/jpeg",
      ".js": "text/javascript; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml",
    }[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
    response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Superfight preview available at http://127.0.0.1:${port}`);
});
