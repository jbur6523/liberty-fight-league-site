import { allowMethods, assertSameOrigin, databaseFailure, handleApi, HttpError, readJsonBody, sendJson } from "../src/server/http.js";
import { getServiceSupabase } from "../src/server/supabase.js";
import { anonymousVoter, fanPicksSnapshot, ipSignal } from "../src/server/fan-picks.js";
import { uuid } from "../src/superfight/validation.js";

export default async function handler(request, response) {
  return handleApi(request, response, async () => {
    allowMethods(request, response, ["GET", "POST"]);
    const service = getServiceSupabase();
    if (request.method === "POST") {
      assertSameOrigin(request);
      if (request.headers["sec-fetch-site"] === "cross-site") throw new HttpError(403, "Cross-site request rejected.", "cross_site_request");
    }
    const voterHash = anonymousVoter(request, response, { issue: request.method === "GET" });
    if (request.method === "POST") {
      const body = await readJsonBody(request, 2048);
      const { data, error } = await service.rpc("cast_superfight_fan_pick", {
        requested_event: uuid(body.eventId, "Event"), requested_match: uuid(body.matchId, "Match"),
        picked_fighter: uuid(body.fighterId, "Fighter"), voter_hash: voterHash, ip_hash: ipSignal(request),
      });
      if (error) throw databaseFailure(error, "Fan Picks vote failed");
      const failures = {
        closed: [409, "Voting is closed. You can still view the fan picks."],
        unavailable: [409, "This matchup is no longer available. Refresh to see the current card."],
        invalid: [400, "Choose a fighter in this matchup."],
        rate_limited: [429, "Too many picks in a short time. Please wait a minute and try again."],
      };
      if (failures[data]) {
        if (data === "rate_limited") response.setHeader("Retry-After", "60");
        throw new HttpError(...failures[data], data);
      }
      if (data !== "saved") throw databaseFailure(new Error("Unexpected vote result"), "Fan Picks vote failed");
    }
    sendJson(response, 200, await fanPicksSnapshot(service, voterHash));
  });
}
