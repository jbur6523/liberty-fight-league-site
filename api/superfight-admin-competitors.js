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
import {
  loadCompetitorWeightOptions,
  setCompetitorWeightPreferences,
} from "../src/server/weight-preferences.js";
import { normalizeInstagram, sortCompetitors } from "../src/superfight/domain.js";
import {
  belt,
  competitorAge,
  email,
  genderDivision,
  grapplingPreference,
  optionalText,
  requiredText,
  uuid,
  uuidList,
} from "../src/superfight/validation.js";

function adminCompetitorPayload(competitor) {
  return {
    id: competitor.id,
    name: competitor.full_name,
    age: competitor.age,
    genderDivision: competitor.gender_division,
    grapplingPreference: competitor.grappling_preference,
    belt: competitor.belt,
    weightLbs: competitor.competition_weight_lbs === null
      ? null
      : Number(competitor.competition_weight_lbs),
    weightOptions: competitor.weightOptions ?? [],
    gym: competitor.gym,
    instagramHandle: competitor.instagram_handle,
    instagramUrl: competitor.instagram_url,
    source: competitor.source,
    createdAt: competitor.created_at,
    statusPath: `/status/${competitor.status_token}`,
  };
}

export default async function handler(request, response) {
  return handleApi(request, response, async () => {
    allowMethods(request, response, ["GET", "POST"]);
    const admin = await requireSuperfightAdmin(request, response);
    const service = getServiceSupabase();

    if (request.method === "POST") {
      assertSameOrigin(request);
      const body = await readJsonBody(request);
      const eventId = uuid(body.eventId, "Event");
      const weightOptionIds = uuidList(body.weightOptionIds, "Acceptable weight classes", { optional: true });
      let instagram;
      try {
        instagram = normalizeInstagram(optionalText(body.instagram, "Instagram", 300));
      } catch (error) {
        throw new HttpError(400, error.message, "invalid_competitor");
      }

      const { data, error } = await service
        .from("superfight_competitors")
        .insert({
          event_id: eventId,
          source: "admin_quick_add",
          full_name: requiredText(body.fullName, "Full name", 160),
          age: competitorAge(body.age, { optional: true }),
          gender_division: genderDivision(body.genderDivision, { optional: true }),
          grappling_preference: grapplingPreference(body.grapplingPreference, { optional: true }),
          belt: belt(body.belt, { optional: true }),
          gym: optionalText(body.gym, "Gym / academy", 160),
          instagram_handle: instagram.handle,
          instagram_url: instagram.url,
          phone: optionalText(body.phone, "Phone", 50),
          email: email(body.email, { optional: true }),
          notes: optionalText(body.notes, "Notes", 5_000),
          created_by: admin.id,
        })
        .select("id, status_token")
        .single();

      if (error) {
        throw databaseFailure(error, "admin quick add failed");
      }

      try {
        await setCompetitorWeightPreferences(service, {
          competitorId: data.id,
          eventId,
          weightOptionIds,
          optional: true,
        });
      } catch (preferenceError) {
        await service.from("superfight_competitors").delete().eq("id", data.id);
        throw preferenceError;
      }

      sendJson(response, 201, {
        competitor: { id: data.id, statusPath: `/status/${data.status_token}` },
      });
      return;
    }

    const eventId = uuid(queryValue(request, "eventId"), "Event");
    const sort = queryValue(request, "sort") ?? "suggested";
    const { data: competitors, error: competitorError } = await service
      .from("superfight_competitors")
      .select("id, full_name, age, gender_division, grappling_preference, belt, competition_weight_lbs, gym, instagram_handle, instagram_url, source, created_at, status_token")
      .eq("event_id", eventId)
      .eq("record_state", "active");

    if (competitorError) {
      throw databaseFailure(competitorError, "admin competitor pool lookup failed");
    }

    const weightOptionsByCompetitor = await loadCompetitorWeightOptions(
      service,
      competitors.map((competitor) => competitor.id),
    );
    const competitorsWithWeights = competitors.map((competitor) => ({
      ...competitor,
      weightOptions: weightOptionsByCompetitor.get(competitor.id) ?? [],
    }));

    const { data: matches, error: matchError } = await service
      .from("superfight_matches")
      .select("fighter_a_id, fighter_b_id")
      .eq("event_id", eventId)
      .eq("state", "active");

    if (matchError) {
      throw databaseFailure(matchError, "admin active match lookup failed");
    }

    const matchedIds = new Set(matches.flatMap((match) => [match.fighter_a_id, match.fighter_b_id]));
    let ordered;
    try {
      ordered = sortCompetitors(
        competitorsWithWeights.filter((competitor) => !matchedIds.has(competitor.id)),
        sort,
      );
    } catch (error) {
      throw new HttpError(400, error.message, "invalid_sort");
    }

    sendJson(response, 200, {
      competitors: ordered.map(adminCompetitorPayload),
      sort,
    });
  });
}
