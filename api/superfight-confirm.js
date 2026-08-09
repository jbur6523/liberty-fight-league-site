import {
  HttpError,
  allowMethods,
  assertSameOrigin,
  databaseFailure,
  handleApi,
  queryValue,
  readJsonBody,
  sendJson,
} from "../src/server/http.js";
import { getServiceSupabase } from "../src/server/supabase.js";
import { optionalText, uuid } from "../src/superfight/validation.js";

async function confirmationDetails(service, token) {
  const { data: confirmation, error: confirmationError } = await service
    .from("superfight_match_confirmations")
    .select("id, match_id, competitor_id, response, responded_at")
    .eq("token", token)
    .maybeSingle();

  if (confirmationError) {
    throw databaseFailure(confirmationError, "confirmation link lookup failed");
  }
  if (!confirmation) {
    throw new HttpError(404, "This confirmation link could not be found.", "confirmation_not_found");
  }

  const { data: match, error: matchError } = await service
    .from("superfight_matches")
    .select("id, event_id, fighter_a_id, fighter_b_id, match_weight_lbs, bout_type, state")
    .eq("id", confirmation.match_id)
    .single();

  if (matchError) {
    throw databaseFailure(matchError, "confirmation match lookup failed");
  }

  const opponentId = match.fighter_a_id === confirmation.competitor_id
    ? match.fighter_b_id
    : match.fighter_a_id;
  const [{ data: fighter, error: fighterError }, { data: opponent, error: opponentError }, { data: event, error: eventError }] = await Promise.all([
    service
      .from("superfight_competitors")
      .select("id, full_name, belt, gym")
      .eq("id", confirmation.competitor_id)
      .single(),
    service
      .from("superfight_competitors")
      .select("id, full_name, belt, gym")
      .eq("id", opponentId)
      .single(),
    service
      .from("superfight_events")
      .select("name, starts_at, venue")
      .eq("id", match.event_id)
      .single(),
  ]);

  if (fighterError || opponentError || eventError) {
    throw databaseFailure(fighterError || opponentError || eventError, "confirmation detail lookup failed");
  }

  return { confirmation, match, fighter, opponent, event };
}

function publicPayload(details) {
  return {
    event: {
      name: details.event.name,
      startsAt: details.event.starts_at,
      venue: details.event.venue,
    },
    fighter: {
      name: details.fighter.full_name,
      belt: details.fighter.belt,
      gym: details.fighter.gym,
    },
    opponent: {
      name: details.opponent.full_name,
      belt: details.opponent.belt,
      gym: details.opponent.gym,
    },
    match: {
      weightLbs: details.match.match_weight_lbs === null
        ? null
        : Number(details.match.match_weight_lbs),
      boutType: details.match.bout_type,
      active: details.match.state === "active",
    },
    confirmation: {
      response: details.confirmation.response,
      respondedAt: details.confirmation.responded_at,
    },
  };
}

export default async function handler(request, response) {
  return handleApi(request, response, async () => {
    allowMethods(request, response, ["GET", "POST", "PATCH"]);
    const token = uuid(queryValue(request, "token"), "Confirmation link");
    const service = getServiceSupabase();

    if (request.method === "GET") {
      sendJson(response, 200, publicPayload(await confirmationDetails(service, token)));
      return;
    }

    assertSameOrigin(request);
    const body = await readJsonBody(request);
    const details = await confirmationDetails(service, token);
    if (details.match.state !== "active") {
      throw new HttpError(409, "This matchup is no longer active.", "match_inactive");
    }

    const updatesGym = Object.hasOwn(body, "gym");
    const gym = updatesGym ? optionalText(body.gym, "Gym / academy", 160) : undefined;

    if (request.method === "POST") {
      const selectedResponse = body.response;
      if (!new Set(["accepted", "declined"]).has(selectedResponse)) {
        throw new HttpError(400, "Choose Accept or Decline.", "invalid_confirmation");
      }

      const { error: responseError } = await service.rpc("submit_superfight_confirmation", {
        confirmation_token: token,
        selected_response: selectedResponse,
        updated_gym: gym,
        should_update_gym: updatesGym,
      });

      if (responseError) {
        throw databaseFailure(responseError, "confirmation response update failed");
      }
    } else if (updatesGym) {
      const { error: gymError } = await service
        .from("superfight_competitors")
        .update({ gym })
        .eq("id", details.fighter.id);

      if (gymError) {
        throw databaseFailure(gymError, "confirmation gym update failed");
      }
    } else {
      throw new HttpError(400, "Gym / academy is required.", "invalid_confirmation");
    }

    sendJson(response, 200, publicPayload(await confirmationDetails(service, token)));
  });
}
