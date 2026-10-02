import { requireSuperfightAdmin } from "../src/server/admin-auth.js";
import { photoUrl } from "../src/server/fan-picks.js";
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
import { boutType, optionalText, positiveWeight, uuid, uuidList } from "../src/superfight/validation.js";

async function listMatches(service, eventId) {
  const { data: matches, error: matchError } = await service
    .from("superfight_matches")
    .select("id, fighter_a_id, fighter_b_id, fighter_c_id, fighter_d_id, weight_option_id, match_weight_lbs, bout_type, notes, state, flyer_completed, winner_fighter_id, created_at")
    .eq("event_id", eventId)
    .eq("state", "active")
    .order("created_at", { ascending: false });

  if (matchError) {
    throw databaseFailure(matchError, "admin match list failed");
  }
  if (matches.length === 0) {
    return [];
  }

  const competitorIds = [...new Set(matches.flatMap((match) => [match.fighter_a_id, match.fighter_b_id, match.fighter_c_id, match.fighter_d_id].filter(Boolean)))];
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
      .select("id, full_name, belt, gym, city, state, distance_from_sf_miles, instagram_handle, instagram_url, fan_photo_path")
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
        photoUrl: photoUrl(service, competitor.fan_photo_path),
        belt: competitor.belt,
        gym: competitor.gym,
        city: competitor.city,
        state: competitor.state,
        distanceFromSfMiles: competitor.distance_from_sf_miles,
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
      notes: match.notes ?? "",
      state: match.state,
      flyerCompleted: match.flyer_completed,
      winnerFighterId: match.winner_fighter_id,
      createdAt: match.created_at,
      confirmation: confirmationState(matchConfirmations, match.fighter_a_id, match.fighter_b_id, [match.fighter_c_id, match.fighter_d_id].filter(Boolean)),
      fighterA: fighterPayload(match.fighter_a_id),
      fighterB: fighterPayload(match.fighter_b_id),
      extraFighters: [match.fighter_c_id, match.fighter_d_id].filter(Boolean).map(fighterPayload),
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

    if (body.action === "result") {
      const matchId = uuid(body.matchId, "Match");
      const winnerFighterId = body.winnerFighterId === null ? null : uuid(body.winnerFighterId, "Winner");
      const { data, error } = await service.from("superfight_matches")
        .update({ winner_fighter_id: winnerFighterId })
        .eq("id", matchId).eq("state", "active")
        .select("id, winner_fighter_id").maybeSingle();
      if (error?.code === "23514" || error?.code === "23503") throw new HttpError(400, "Choose a competitor in this matchup.", "invalid_winner");
      if (error) throw databaseFailure(error, "admin match result failed");
      if (!data) throw new HttpError(404, "The active match could not be found.", "match_not_found");
      sendJson(response, 200, { match: { id: data.id, winnerFighterId: data.winner_fighter_id } });
      return;
    }

    if (body.action === "edit") {
      const matchId = uuid(body.matchId, "Match");
      const finalBoutType = boutType(body.boutType, { special: true });
      const weightOptionId = body.weightOptionId ? uuid(body.weightOptionId, "Weight class") : null;
      if (weightOptionId && body.agreedWeightLbs !== "" && body.agreedWeightLbs != null) {
        throw new HttpError(400, "Choose a weight class or enter an agreed weight, not both.", "invalid_match");
      }
      const weightLbs = weightOptionId ? null : positiveWeight(body.agreedWeightLbs);
      const notes = optionalText(body.notes, "Bout notes", 5000);
      const { data: existing, error: lookupError } = await service.from("superfight_matches")
        .select("id, event_id, fighter_c_id, fighter_d_id")
        .eq("id", matchId).eq("state", "active").maybeSingle();
      if (lookupError) throw databaseFailure(lookupError, "admin match edit lookup failed");
      if (!existing) throw new HttpError(404, "The active match could not be found.", "match_not_found");
      if ((existing.fighter_c_id || existing.fighter_d_id) && finalBoutType !== "gauntlet") {
        throw new HttpError(400, "Bouts with more than two competitors must remain Gauntlet.", "invalid_match");
      }
      if (weightOptionId) {
        const { data: option, error } = await service.from("superfight_event_weight_options")
          .select("id").eq("id", weightOptionId).eq("event_id", existing.event_id)
          .eq("is_active", true).maybeSingle();
        if (error) throw databaseFailure(error, "admin match weight lookup failed");
        if (!option) throw new HttpError(400, "Choose an active weight class for this event.", "invalid_match");
      }
      const { data, error } = await service.from("superfight_matches")
        .update({ weight_option_id: weightOptionId, match_weight_lbs: weightLbs, bout_type: finalBoutType, notes })
        .eq("id", matchId).eq("state", "active").select("id").maybeSingle();
      if (error) {
        if (error.code === "P0001" || error.code === "23514") {
          throw new HttpError(409, "The bout could not be updated. Check its weight class and bout type and try again.", "match_conflict");
        }
        throw databaseFailure(error, "admin match edit failed");
      }
      if (!data) throw new HttpError(404, "The active match could not be found.", "match_not_found");
      sendJson(response, 200, { match: { id: data.id } });
      return;
    }

    if (body.action === "flyer") {
      if (typeof body.flyerCompleted !== "boolean") {
        throw new HttpError(400, "Choose a valid flyer status.", "invalid_flyer_status");
      }
      const { data, error } = await service
        .from("superfight_matches")
        .update({ flyer_completed: body.flyerCompleted })
        .eq("id", uuid(body.matchId, "Match"))
        .eq("state", "active")
        .select("id, flyer_completed")
        .maybeSingle();

      if (error) throw databaseFailure(error, "admin flyer update failed");
      if (!data) throw new HttpError(404, "The active match could not be found.", "match_not_found");
      sendJson(response, 200, { match: { id: data.id, flyerCompleted: data.flyer_completed } });
      return;
    }

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
    const finalBoutType = boutType(body.boutType, { special: true });
    const extraIds = uuidList(body.extraCompetitorIds, "Additional competitors", { optional: true, maximum: 2 });
    const participantIds = [fighterAId, fighterBId, ...extraIds];
    if ((body.extraCompetitorIds?.length ?? 0) !== extraIds.length || new Set(participantIds).size !== participantIds.length || (extraIds.length && finalBoutType !== "gauntlet")) {
      throw new HttpError(400, "Choose up to four different competitors for Gauntlet; other bouts use two.", "invalid_match");
    }
    if (fighterAId === fighterBId) {
      throw new HttpError(400, "Choose two different competitors.", "invalid_match");
    }

    const [preferences, { data: competitors, error: competitorError }] = await Promise.all([
      loadCompetitorWeightOptions(service, participantIds),
      service
        .from("superfight_competitors")
        .select("id, event_id, grappling_preference")
        .in("id", participantIds),
    ]);
    if (competitorError) throw databaseFailure(competitorError, "match competitor lookup failed");
    if (competitors.length !== participantIds.length || competitors.some((competitor) => competitor.event_id !== eventId)) {
      throw new HttpError(400, "Choose competitors from this event.", "invalid_match");
    }

    if (competitors.some((left) => competitors.some((right) => formatPreferencesConflict(left.grappling_preference, right.grappling_preference)))
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
      .filter((optionId) => fighterAWeights.has(optionId) && extraIds.every((id) => (preferences.get(id) ?? []).some((option) => option.id === optionId)));
    const { weightOptionId, matchWeightLbs } = resolveMatchWeight({
      sharedWeightOptionIds,
      weightOptionId: body.weightOptionId,
      agreedWeightLbs: body.agreedWeightLbs,
    });

    const { data, error } = await service.rpc("create_superfight_group_match", {
      event_id_input: eventId, fighter_a: fighterAId, fighter_b: fighterBId,
      fighter_c: extraIds[0] ?? null, fighter_d: extraIds[1] ?? null,
      weight_option: weightOptionId, agreed_weight: matchWeightLbs,
      selected_bout: finalBoutType, admin_id: admin.id,
      offer_id: body.offerId ? uuid(body.offerId, "Offer") : null,
    });

    if (error) {
      if (error.code === "P0001" || /already belongs to an active match|Only active competitors|same gender division|final bout type|weight class|agreed match weight|no longer/i.test(error.message)) {
        throw new HttpError(409, error.message, "match_conflict");
      }
      throw databaseFailure(error, "admin match create failed");
    }

    sendJson(response, 201, { match: { id: data } });
  });
}
