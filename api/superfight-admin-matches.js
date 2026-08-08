import { requireSuperfightAdmin } from "../src/server/admin-auth.js";
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
import { confirmationState } from "../src/superfight/contracts.js";
import { positiveWeight, uuid } from "../src/superfight/validation.js";

async function listMatches(service, eventId) {
  const { data: matches, error: matchError } = await service
    .from("superfight_matches")
    .select("id, fighter_a_id, fighter_b_id, match_weight_lbs, state, created_at")
    .eq("event_id", eventId)
    .eq("state", "active")
    .order("created_at", { ascending: false });

  if (matchError) {
    throw databaseFailure(matchError, "admin match list failed");
  }
  if (matches.length === 0) {
    return [];
  }

  const competitorIds = [...new Set(matches.flatMap((match) => [match.fighter_a_id, match.fighter_b_id]))];
  const matchIds = matches.map((match) => match.id);
  const [{ data: competitors, error: competitorError }, { data: confirmations, error: confirmationError }] = await Promise.all([
    service
      .from("superfight_competitors")
      .select("id, full_name, belt, gym, instagram_handle, instagram_url")
      .in("id", competitorIds),
    service
      .from("superfight_match_confirmations")
      .select("match_id, competitor_id, token, response, responded_at")
      .in("match_id", matchIds),
  ]);

  if (competitorError || confirmationError) {
    throw databaseFailure(competitorError || confirmationError, "admin match details failed");
  }

  const competitorMap = new Map(competitors.map((competitor) => [competitor.id, competitor]));
  return matches.map((match) => {
    const matchConfirmations = confirmations.filter((item) => item.match_id === match.id);
    const fighterPayload = (competitorId) => {
      const competitor = competitorMap.get(competitorId);
      const confirmation = matchConfirmations.find((item) => item.competitor_id === competitorId);
      return {
        id: competitor.id,
        name: competitor.full_name,
        belt: competitor.belt,
        gym: competitor.gym,
        instagramHandle: competitor.instagram_handle,
        instagramUrl: competitor.instagram_url,
        confirmationPath: confirmation ? `/confirm/${confirmation.token}` : null,
        response: confirmation?.response ?? "awaiting",
        respondedAt: confirmation?.responded_at ?? null,
      };
    };

    return {
      id: match.id,
      weightLbs: match.match_weight_lbs === null ? null : Number(match.match_weight_lbs),
      state: match.state,
      createdAt: match.created_at,
      confirmation: confirmationState(matchConfirmations, match.fighter_a_id, match.fighter_b_id),
      fighterA: fighterPayload(match.fighter_a_id),
      fighterB: fighterPayload(match.fighter_b_id),
    };
  });
}
export default async function handler(request, response) {
  return handleApi(request, response, async () => {
    allowMethods(request, response, ["GET", "POST"]);
    const admin = await requireSuperfightAdmin(request, response);
    const service = getServiceSupabase();

    if (request.method === "GET") {
      const eventId = uuid(queryValue(request, "eventId"), "Event");
      sendJson(response, 200, { matches: await listMatches(service, eventId) });
      return;
    }

    assertSameOrigin(request);
    const body = await readJsonBody(request);

    if (body.action === "unmatch") {
      const { data, error } = await service
        .from("superfight_matches")
        .update({
          state: "unmatched",
          unmatched_at: new Date().toISOString(),
          unmatched_by: admin.id,
        })
        .eq("id", uuid(body.matchId, "Match"))
        .eq("state", "active")
        .select("id")
        .maybeSingle();

      if (error) {
        throw databaseFailure(error, "admin unmatch failed");
      }
      if (!data) {
        throw new HttpError(404, "The active match could not be found.", "match_not_found");
      }
      sendJson(response, 200, { unmatched: true });
      return;
    }

    if (body.action !== "match") {
      throw new HttpError(400, "Choose a valid match action.", "invalid_match_action");
    }

    const eventId = uuid(body.eventId, "Event");
    const fighterAId = uuid(body.fighterAId, "Fighter A");
    const fighterBId = uuid(body.fighterBId, "Fighter B");
    if (fighterAId === fighterBId) {
      throw new HttpError(400, "Choose two different competitors.", "invalid_match");
    }

    const { data, error } = await service
      .from("superfight_matches")
      .insert({
        event_id: eventId,
        fighter_a_id: fighterAId,
        fighter_b_id: fighterBId,
        match_weight_lbs: positiveWeight(body.matchWeightLbs, { optional: true }),
        created_by: admin.id,
      })
      .select("id")
      .single();

    if (error) {
      if (/already belongs to an active match|Only active competitors/i.test(error.message)) {
        throw new HttpError(409, error.message, "match_conflict");
      }
      throw databaseFailure(error, "admin match create failed");
    }

    sendJson(response, 201, { match: { id: data.id } });
  });
}
