import { confirmationState } from "../src/superfight/contracts.js";
import {
  HttpError,
  allowMethods,
  databaseFailure,
  handleApi,
  queryValue,
  sendJson,
} from "../src/server/http.js";
import { getServiceSupabase } from "../src/server/supabase.js";
import { uuid } from "../src/superfight/validation.js";

export default async function handler(request, response) {
  return handleApi(request, response, async () => {
    allowMethods(request, response, ["GET"]);
    const token = uuid(queryValue(request, "token"), "Status link");
    const service = getServiceSupabase();
    const { data: fighter, error: fighterError } = await service
      .from("superfight_competitors")
      .select("id, event_id, full_name, belt, competition_weight_lbs, gym, instagram_handle, instagram_url, record_state")
      .eq("status_token", token)
      .maybeSingle();

    if (fighterError) {
      throw databaseFailure(fighterError, "status fighter lookup failed");
    }
    if (!fighter || fighter.record_state === "merged") {
      throw new HttpError(404, "This status link could not be found.", "status_not_found");
    }

    const { data: event, error: eventError } = await service
      .from("superfight_events")
      .select("name, starts_at, venue")
      .eq("id", fighter.event_id)
      .single();

    if (eventError) {
      throw databaseFailure(eventError, "status event lookup failed");
    }

    const { data: matches, error: matchError } = await service
      .from("superfight_matches")
      .select("id, fighter_a_id, fighter_b_id, match_weight_lbs, bout_type")
      .eq("event_id", fighter.event_id)
      .eq("state", "active")
      .or(`fighter_a_id.eq.${fighter.id},fighter_b_id.eq.${fighter.id}`)
      .limit(1);

    if (matchError) {
      throw databaseFailure(matchError, "status match lookup failed");
    }

    const match = matches?.[0];
    if (!match) {
      sendJson(response, 200, {
        fighter: { name: fighter.full_name },
        event: { name: event.name, startsAt: event.starts_at, venue: event.venue },
        status: "unmatched",
      });
      return;
    }

    const opponentId = match.fighter_a_id === fighter.id ? match.fighter_b_id : match.fighter_a_id;
    const { data: opponent, error: opponentError } = await service
      .from("superfight_competitors")
      .select("full_name, belt, gym, instagram_handle, instagram_url")
      .eq("id", opponentId)
      .single();

    if (opponentError) {
      throw databaseFailure(opponentError, "status opponent lookup failed");
    }

    const { data: confirmations, error: confirmationError } = await service
      .from("superfight_match_confirmations")
      .select("competitor_id, response")
      .eq("match_id", match.id);

    if (confirmationError) {
      throw databaseFailure(confirmationError, "status confirmation lookup failed");
    }

    sendJson(response, 200, {
      fighter: {
        name: fighter.full_name,
        belt: fighter.belt,
        gym: fighter.gym,
      },
      opponent: {
        name: opponent.full_name,
        belt: opponent.belt,
        gym: opponent.gym,
        instagramHandle: opponent.instagram_handle,
        instagramUrl: opponent.instagram_url,
      },
      event: { name: event.name, startsAt: event.starts_at, venue: event.venue },
      match: {
        weightLbs: match.match_weight_lbs === null ? null : Number(match.match_weight_lbs),
        boutType: match.bout_type,
        confirmation: confirmationState(confirmations, match.fighter_a_id, match.fighter_b_id),
      },
      status: "matched",
    });
  });
}
