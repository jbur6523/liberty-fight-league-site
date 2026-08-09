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
import { normalizeInstagram } from "../src/superfight/domain.js";
import {
  belt,
  competitorAge,
  email,
  genderDivision,
  grapplingPreference,
  optionalText,
  resolvePreferredContact,
  requiredText,
  uuid,
  uuidList,
} from "../src/superfight/validation.js";

async function competitorDetail(service, competitorId) {
  const { data: competitor, error } = await service
    .from("superfight_competitors")
    .select("id, event_id, full_name, phone, email, preferred_contact_method, age, gender_division, grappling_preference, belt, competition_weight_lbs, gym, instagram_handle, instagram_url, notes, source, record_state, merged_into_competitor_id, application_submitted_at, created_at, status_slug")
    .eq("id", competitorId)
    .maybeSingle();

  if (error) {
    throw databaseFailure(error, "admin competitor detail failed");
  }
  if (!competitor) {
    throw new HttpError(404, "Competitor could not be found.", "competitor_not_found");
  }
  const weightOptionsByCompetitor = await loadCompetitorWeightOptions(service, [competitor.id]);
  const weightOptions = weightOptionsByCompetitor.get(competitor.id) ?? [];

  const { data: matches, error: matchError } = await service
    .from("superfight_matches")
    .select("id, fighter_a_id, fighter_b_id, weight_option_id, match_weight_lbs, bout_type, state")
    .eq("event_id", competitor.event_id)
    .eq("state", "active")
    .or(`fighter_a_id.eq.${competitor.id},fighter_b_id.eq.${competitor.id}`)
    .limit(1);

  if (matchError) {
    throw databaseFailure(matchError, "admin competitor match detail failed");
  }

  let match = null;
  if (matches?.[0]) {
    const record = matches[0];
    const opponentId = record.fighter_a_id === competitor.id ? record.fighter_b_id : record.fighter_a_id;
    const optionLookup = record.weight_option_id
      ? service
        .from("superfight_event_weight_options")
        .select("id, label, value_lbs, sort_order, is_active")
        .eq("id", record.weight_option_id)
        .single()
      : Promise.resolve({ data: null, error: null });
    const [
      { data: opponent, error: opponentError },
      { data: confirmations, error: confirmationError },
      { data: weightOption, error: weightOptionError },
    ] = await Promise.all([
      service
        .from("superfight_competitors")
        .select("id, full_name, age, gender_division, grappling_preference, belt, competition_weight_lbs, gym, instagram_handle, instagram_url")
        .eq("id", opponentId)
        .single(),
      service
        .from("superfight_match_confirmations")
        .select("competitor_id, response, responded_at")
        .eq("match_id", record.id),
      optionLookup,
    ]);

    if (opponentError || confirmationError || weightOptionError) {
      throw databaseFailure(opponentError || confirmationError || weightOptionError, "admin competitor opponent detail failed");
    }
    match = {
      id: record.id,
      weightLbs: record.match_weight_lbs === null ? null : Number(record.match_weight_lbs),
      weightOption: weightOption ? {
        id: weightOption.id,
        label: weightOption.label,
        valueLbs: Number(weightOption.value_lbs),
      } : null,
      boutType: record.bout_type,
      opponent,
      confirmations,
    };
  }

  return {
    id: competitor.id,
    eventId: competitor.event_id,
    name: competitor.full_name,
    phone: competitor.phone,
    email: competitor.email,
    preferredContactMethod: competitor.preferred_contact_method,
    age: competitor.age,
    genderDivision: competitor.gender_division,
    grapplingPreference: competitor.grappling_preference,
    belt: competitor.belt,
    weightLbs: competitor.competition_weight_lbs === null ? null : Number(competitor.competition_weight_lbs),
    weightOptions,
    gym: competitor.gym,
    instagramHandle: competitor.instagram_handle,
    instagramUrl: competitor.instagram_url,
    notes: competitor.notes,
    source: competitor.source,
    recordState: competitor.record_state,
    mergedIntoCompetitorId: competitor.merged_into_competitor_id,
    applicationSubmittedAt: competitor.application_submitted_at,
    createdAt: competitor.created_at,
    statusPath: `/status/${competitor.status_slug}`,
    match,
  };
}

export default async function handler(request, response) {
  return handleApi(request, response, async () => {
    allowMethods(request, response, ["GET", "PATCH", "POST"]);
    await requireSuperfightAdmin(request, response);
    const service = getServiceSupabase();
    const body = request.method === "GET" ? null : await readJsonBody(request);
    const competitorId = uuid(
      request.method === "GET" ? queryValue(request, "id") : body.competitorId,
      "Competitor",
    );

    if (request.method === "GET") {
      sendJson(response, 200, { competitor: await competitorDetail(service, competitorId) });
      return;
    }

    assertSameOrigin(request);

    if (request.method === "POST" && body.action === "merge") {
      const targetId = uuid(body.targetCompetitorId, "Target competitor");
      const { error } = await service.rpc("merge_superfight_competitors", {
        source_competitor_id: competitorId,
        target_competitor_id: targetId,
      });
      if (error) {
        if (/cannot be merged|Only active|Unmatch|must exist|same record/i.test(error.message)) {
          throw new HttpError(409, error.message, "merge_conflict");
        }
        throw databaseFailure(error, "admin competitor merge failed");
      }
      sendJson(response, 200, { merged: true, targetCompetitorId: targetId });
      return;
    }

    if (request.method !== "PATCH") {
      throw new HttpError(400, "Choose a valid competitor action.", "invalid_competitor_action");
    }

    const { data: current, error: currentError } = await service
      .from("superfight_competitors")
      .select("event_id, phone, preferred_contact_method, instagram_handle, instagram_url")
      .eq("id", competitorId)
      .maybeSingle();
    if (currentError) throw databaseFailure(currentError, "admin competitor lookup failed");
    if (!current) throw new HttpError(404, "Competitor could not be found.", "competitor_not_found");

    const updates = {};
    if (Object.hasOwn(body, "fullName")) updates.full_name = requiredText(body.fullName, "Full name", 160);
    if (Object.hasOwn(body, "phone")) updates.phone = optionalText(body.phone, "Cell Phone", 50);
    if (Object.hasOwn(body, "email")) updates.email = email(body.email, { optional: true });
    if (Object.hasOwn(body, "age")) updates.age = competitorAge(body.age, { optional: true });
    if (Object.hasOwn(body, "genderDivision")) {
      updates.gender_division = genderDivision(body.genderDivision, { optional: true });
    }
    if (Object.hasOwn(body, "grapplingPreference")) {
      updates.grappling_preference = grapplingPreference(body.grapplingPreference, { optional: true });
    }
    if (Object.hasOwn(body, "belt")) updates.belt = belt(body.belt, { optional: true });
    if (Object.hasOwn(body, "gym")) updates.gym = optionalText(body.gym, "Gym / academy", 160);
    if (Object.hasOwn(body, "notes")) updates.notes = optionalText(body.notes, "Notes", 5_000);
    if (Object.hasOwn(body, "instagram")) {
      try {
        const instagram = normalizeInstagram(optionalText(body.instagram, "Instagram", 300));
        updates.instagram_handle = instagram.handle;
        updates.instagram_url = instagram.url;
      } catch (error) {
        throw new HttpError(400, error.message, "invalid_competitor");
      }
    }
    const hasContactChange = ["phone", "instagram", "preferredContactMethod"]
      .some((field) => Object.hasOwn(body, field));
    if (hasContactChange) {
      updates.preferred_contact_method = resolvePreferredContact({
        phone: Object.hasOwn(updates, "phone") ? updates.phone : current.phone,
        instagramHandle: Object.hasOwn(updates, "instagram_handle")
          ? updates.instagram_handle
          : current.instagram_handle,
        requestedMethod: Object.hasOwn(body, "preferredContactMethod")
          ? body.preferredContactMethod
          : current.preferred_contact_method,
        optional: true,
      });
    }
    const hasWeightPreferences = Object.hasOwn(body, "weightOptionIds");
    const weightOptionIds = hasWeightPreferences
      ? uuidList(body.weightOptionIds, "Acceptable weight classes", { optional: true })
      : null;
    if (Object.keys(updates).length === 0 && !hasWeightPreferences) {
      throw new HttpError(400, "No competitor changes were supplied.", "invalid_competitor");
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await service
        .from("superfight_competitors")
        .update(updates)
        .eq("id", competitorId);
      if (error) {
        throw databaseFailure(error, "admin competitor update failed");
      }
    }

    if (hasWeightPreferences) {
      await setCompetitorWeightPreferences(service, {
        competitorId,
        eventId: current.event_id,
        weightOptionIds,
        optional: true,
      });
    }

    sendJson(response, 200, { competitor: await competitorDetail(service, competitorId) });
  });
}
