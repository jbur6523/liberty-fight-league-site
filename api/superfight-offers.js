import { allowMethods, assertSameOrigin, databaseFailure, handleApi, HttpError, queryValue, readJsonBody, sendJson } from "../src/server/http.js";
import { getServiceSupabase } from "../src/server/supabase.js";
import { availableCompetitors, offerInstagram, offerRateLimit, publicCompetitor, compareAvailableCompetitors } from "../src/server/offers.js";
import { loadCompetitorWeightOptions } from "../src/server/weight-preferences.js";
import { boutType, optionalText, uuid, uuidList } from "../src/superfight/validation.js";
import { notifyOffer } from "../src/server/offer-notifications.js";

export default async function handler(request, response) {
  return handleApi(request, response, async () => {
    allowMethods(request, response, ["GET", "POST"]);
    const service = getServiceSupabase();
    if (request.method === "GET") {
      const id = queryValue(request, "id");
      const records = await availableCompetitors(service, { competitorId: id ? uuid(id, "Competitor") : undefined });
      if (id && !records.length) throw new HttpError(404, "This match is no longer available.", "unavailable");
      const weights = await loadCompetitorWeightOptions(service, records.map((record) => record.id));
      const competitors = records.map((record) => publicCompetitor(record, weights.get(record.id), { detail: Boolean(id) }));
      sendJson(response, 200, id ? { competitor: competitors[0] } : { competitors: competitors.sort(compareAvailableCompetitors) });
      return;
    }
    assertSameOrigin(request);
    const body = await readJsonBody(request);
    if (body.website) { sendJson(response, 201, { received: true }); return; }
    const targetId = uuid(body.targetId, "Competitor");
    const handle = offerInstagram(body.instagram);
    await offerRateLimit(service, request, body.action === "lookup" ? "lookup" : "submit");
    if (body.action === "lookup") {
      const [target] = await availableCompetitors(service, { competitorId: targetId });
      if (!target) throw new HttpError(409, "This match is no longer available.", "unavailable");
      const { data: records, error } = await service.from("superfight_competitors")
        .select("id,full_name,belt,experience_level,grappling_preference,instagram_handle,gym,record_state")
        .eq("event_id", target.event_id).ilike("instagram_handle", handle.replaceAll("_", "\\_"))
        .order("created_at", { ascending: true });
      if (error) throw databaseFailure(error, "offer Instagram lookup failed");
      const existing = records.find((record) => record.record_state === "active") ?? records[0];
      if (existing && existing.record_state !== "active") throw new HttpError(409, "Your registration needs promoter review. Please contact Liberty Fight League.", "registration_unavailable");
      if (existing?.id === targetId) throw new HttpError(409, "You cannot offer a match against yourself.", "self_offer");
      const weights = existing ? await loadCompetitorWeightOptions(service, [existing.id]) : new Map();
      const profile = existing ? publicCompetitor(existing, weights.get(existing.id), { detail: true }) : null;
      if (profile) delete profile.id;
      const { data: classes, error: classError } = await service.from("superfight_event_weight_options")
        .select("id,label,value_lbs").eq("event_id", target.event_id).eq("is_active", true).order("sort_order", { ascending: true });
      if (classError) throw databaseFailure(classError, "offer weight classes failed");
      sendJson(response, 200, { existing: Boolean(existing), instagramHandle: handle, profile,
        selectedWeightOptionIds: (weights.get(existing?.id) ?? []).map((option) => option.id),
        weightOptions: classes.map((option) => ({ id: option.id, label: option.label, valueLbs: Number(option.value_lbs) })) });
      return;
    }
    if (body.action !== "submit") throw new HttpError(400, "Choose a valid offer action.", "invalid_offer");
    const weightOptionIds = uuidList(body.weightOptionIds, "Acceptable weight classes");
    if (!weightOptionIds.length) throw new HttpError(400, "Select at least one acceptable weight class.", "invalid_weight");
    const { data, error } = await service.rpc("submit_superfight_offer_classes", {
      target_id: targetId, handle, selected_bout: boutType(body.boutType), submission_key: uuid(body.requestKey, "Submission"),
      first_name: optionalText(body.firstName, "First name", 80), submitted_belt: optionalText(body.belt, "Belt", 30),
      selected_weights: weightOptionIds, submitted_gym: optionalText(body.gym, "Gym", 160),
    });
    if (error) {
      if (error.code === "P0001") throw new HttpError(409, error.message, "offer_conflict");
      throw databaseFailure(error, "offer submission failed");
    }
    await notifyOffer(service, data.id);
    // No competitor IDs, status tokens, or application details in the receipt.
    sendJson(response, 201, { received: true });
  });
}
