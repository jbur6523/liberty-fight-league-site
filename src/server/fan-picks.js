import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { HttpError, databaseFailure } from "./http.js";
import { withFanLines } from "../superfight/fan-lines.js";

const COOKIE = "lfl_fan_picks";
export const PHOTO_BUCKET = "superfight-fighter-photos";

function hash(value) {
  const secret = process.env.FAN_PICKS_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new HttpError(503, "Fan Picks is not configured yet.", "not_configured");
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function anonymousVoter(request, response, { issue = false } = {}) {
  const token = String(request.headers.cookie || "").split(";").map(part => part.trim())
    .find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (token && /^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(token)) {
    const [id, signature] = token.split(".");
    if (timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(hash(`cookie:${id}`), "hex"))) {
      return hash(`voter:${id}`);
    }
  }
  if (!issue) throw new HttpError(403, "Please refresh the page and allow cookies to save your pick.", "cookie_required");
  const id = randomBytes(32).toString("hex");
  const secure = process.env.VERCEL === "1" || request.headers["x-forwarded-proto"] === "https";
  response.setHeader("Set-Cookie", `${COOKIE}=${id}.${hash(`cookie:${id}`)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure ? "; Secure" : ""}`);
  return hash(`voter:${id}`);
}

export function ipSignal(request) {
  // Vercel overwrites this header. Never trust a client-supplied forwarding header locally.
  const ip = process.env.VERCEL === "1"
    ? String(request.headers["x-vercel-forwarded-for"] || "unknown").split(",")[0].trim()
    : request.socket?.remoteAddress || "unknown";
  return hash(`ip:${ip}`);
}

export function percentages(votesA, votesB) {
  const a = Math.max(1, Math.min(99, Math.round((votesA + 2) / (votesA + votesB + 4) * 100)));
  return [a, 100 - a];
}

export function photoUrl(service, path) {
  return path ? service.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl : null;
}

export function publicFighter(service, fighter) {
  const words = fighter.full_name.trim().split(/\s+/);
  return {
    id: fighter.id,
    firstName: words[0],
    name: words[0] + (words.length > 1 ? ` ${Array.from(words.at(-1))[0].toLocaleUpperCase()}.` : ""),
    academy: fighter.gym || "Academy not listed",
    photoUrl: photoUrl(service, fighter.fan_photo_path),
  };
}

export async function fanPicksSnapshot(service, voterHash) {
  const { data, error } = await service.rpc("superfight_fan_picks_snapshot_v2", { voter_hash: voterHash });
  if (error) throw databaseFailure(error, "Fan Picks snapshot failed");
  if (!data) return withFanLines({ event: null, matches: [] });
  return withFanLines({
    event: { id: data.event.id, name: data.event.name, votingOpen: data.event.voting_open },
    matches: data.matches.map(match => {
      const votesA = Number(match.votes_a), votesB = Number(match.votes_b);
      const [percentageA, percentageB] = percentages(votesA, votesB);
      const anchor = publicFighter(service, match.fighter_a);
      const opponents = match.opponents?.map(fighter => publicFighter(service, fighter));
      return {
        id: match.id, totalPicks: votesA + votesB, selectedFighterId: match.selected_fighter_id,
        boutType: match.bout_type, weightLbs: match.match_weight_lbs == null ? null : Number(match.match_weight_lbs),
        ...(opponents ? { groupPick: true, anchor, opponents } : {}),
        fighters: [
          { ...anchor, ...(opponents ? { name: `${anchor.name} sweeps`, description: `Beats all ${opponents.length} opponents`, academy: `Beats ${opponents.map(f => f.name).join(', ')}` } : {}), percentage: percentageA, picks: votesA },
          { ...publicFighter(service, match.fighter_b), ...(opponents ? { name: `Opponents vs ${anchor.name}`, firstName: "Opponents", photoUrl: null, description: `Any opponent beats ${anchor.firstName}`, academy: opponents.map(f => f.name).join(', ') } : {}), percentage: percentageB, picks: votesB },
        ],
      };
    }),
  });
}
