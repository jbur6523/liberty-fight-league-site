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
import { loadCompetitorWeightOptions } from "../src/server/weight-preferences.js";
import { confirmationState } from "../src/superfight/contracts.js";
import { formatPreferencesConflict, resolveMatchWeight } from "../src/superfight/match-agreement.js";
import { boutType, uuid } from "../src/superfight/validation.js";

async function listMatches(service, eventId) {
  const { data: matches, error: matchError } = await service
    .from("superfight_matches")
    .select("id, fighter_a_id, fighter_b_id, weight_option_id, match_weight_lbs, bout_type, state, created_at")
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
  const weightOptionIds = [...new Set(matches.map((match) => match.weight_option_id).filter(Boolean))];
  const optionLookup = weightOptionIds.length > 0
    ? service
      .from("superfight_event_weight_options")
      .select("id, label, value_lbs")
      .in("id", weightOptionIds)
    : Promise.resolve({ data: [], error: null });
  const [
    { data: competitors, error: competitorError },
    { data: confirmations, error: confirmationError },
    { data: weightOptions, error: weightOptionError },
  ] = await Promise.all([
    service
      .from("superfight_competitors")
      .select("id, full_name, belt, gym, instagram_handle, instagram_url")
      .in("id", competitorIds),
    service
      .from("superfight_match_confirmations")
      .select("match_id, competitor_id, token, response, responded_at")
      .in("match_id", matchIds),
    optionLookup,
  ]);

  if (competitorError || confirmationError || weightOptionError) {
    throw databaseFailure(competitorError || confirmationError || weightOptionError, "admin match details failed");
  }

  const competitorMap = new Map(competitors.map((competitor) => [competitor.id, competitor]));
  const weightOptionMap = new Map(weightOptions.map((option) => [option.id, option]));
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
      weightOption: weightOptionMap.has(match.weight_option_id) ? {
        id: match.weight_option_id,
        label: weightOptionMap.get(match.weight_option_id).label,
        valueLbs: Number(weightOptionMap.get(match.weight_option_id).value_lbs),
      } : null,
      boutType: match.bout_type,
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
    const finalBoutType = boutType(body.boutType);
    if (fighterAId === fighterBId) {
      throw new HttpError(400, "Choose two different competitors.", "invalid_match");
    }

    const [preferences, { data: competitors, error: competitorError }] = await Promise.all([
      loadCompetitorWeightOptions(service, [fighterAId, fighterBId]),
      service
        .from("superfight_competitors")
        .select("id, event_id, grappling_preference")
        .in("id", [fighterAId, fighterBId]),
    ]);
    if (competitorError) throw databaseFailure(competitorError, "match competitor lookup failed");
    if (competitors.length !== 2 || competitors.some((competitor) => competitor.event_id !== eventId)) {
      throw new HttpError(400, "Choose two competitors from this event.", "invalid_match");
    }

    const fighterA = competitors.find((competitor) => competitor.id === fighterAId);
    const fighterB = competitors.find((competitor) => competitor.id === fighterBId);
    if (formatPreferencesConflict(fighterA.grappling_preference, fighterB.grappling_preference)
      && body.formatOverrideConfirmed !== true) {
      throw new HttpError(
        409,
        "These competitors selected different format preferences. Confirm the agreed bout type.",
        "match_conflict",
      );
    }

    const fighterAWeights = new Set((preferences.get(fighterAId) ?? []).map((option) => option.id));
    const sharedWeightOptionIds = (preferences.get(fighterBId) ?? [])
      .map((option) => option.id)
      .filter((optionId) => fighterAWeights.has(optionId));
    const { weightOptionId, matchWeightLbs } = resolveMatchWeight({
      sharedWeightOptionIds,
      weightOptionId: body.weightOptionId,
      agreedWeightLbs: body.agreedWeightLbs,
    });

    const { data, error } = await service
      .from("superfight_matches")
      .insert({
        event_id: eventId,
        fighter_a_id: fighterAId,
        fighter_b_id: fighterBId,
        weight_option_id: weightOptionId,
        match_weight_lbs: matchWeightLbs,
        bout_type: finalBoutType,
        created_by: admin.id,
      })
      .select("id")
      .single();

    if (error) {
      if (/already belongs to an active match|Only active competitors|same gender division|final bout type|weight class|agreed match weight/i.test(error.message)) {
        throw new HttpError(409, error.message, "match_conflict");
      }
      throw databaseFailure(error, "admin match create failed");
    }

    sendJson(response, 201, { match: { id: data.id } });
  });
}
