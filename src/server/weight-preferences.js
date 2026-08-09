import { HttpError, databaseFailure } from "./http.js";

function optionPayload(option) {
  return {
    id: option.id,
    label: option.label,
    valueLbs: Number(option.value_lbs),
    sortOrder: option.sort_order,
    active: option.is_active,
  };
}

export async function validatedEventWeightOptions(service, eventId, weightOptionIds, {
  optional = false,
} = {}) {
  if (weightOptionIds.length === 0) {
    if (optional) return [];
    throw new HttpError(400, "Select at least one acceptable weight class.", "invalid_application");
  }

  const { data, error } = await service
    .from("superfight_event_weight_options")
    .select("id, event_id, label, value_lbs, sort_order, is_active")
    .eq("event_id", eventId)
    .eq("is_active", true)
    .in("id", weightOptionIds)
    .order("sort_order", { ascending: true })
    .order("value_lbs", { ascending: true });

  if (error) throw databaseFailure(error, "weight preference validation failed");
  if (data.length !== weightOptionIds.length) {
    throw new HttpError(400, "Select available weight classes for this event.", "invalid_application");
  }
  return data.map(optionPayload);
}

export async function loadCompetitorWeightOptions(service, competitorIds) {
  const result = new Map(competitorIds.map((id) => [id, []]));
  if (competitorIds.length === 0) return result;

  const { data: preferences, error: preferenceError } = await service
    .from("superfight_competitor_weight_preferences")
    .select("competitor_id, weight_option_id")
    .in("competitor_id", competitorIds);
  if (preferenceError) throw databaseFailure(preferenceError, "competitor weight preference lookup failed");
  if (preferences.length === 0) return result;

  const optionIds = [...new Set(preferences.map((item) => item.weight_option_id))];
  const { data: options, error: optionError } = await service
    .from("superfight_event_weight_options")
    .select("id, event_id, label, value_lbs, sort_order, is_active")
    .in("id", optionIds);
  if (optionError) throw databaseFailure(optionError, "competitor weight option lookup failed");

  const optionMap = new Map(options.map((option) => [option.id, optionPayload(option)]));
  for (const preference of preferences) {
    const option = optionMap.get(preference.weight_option_id);
    if (option) result.get(preference.competitor_id)?.push(option);
  }
  for (const values of result.values()) {
    values.sort((left, right) => left.sortOrder - right.sortOrder || left.valueLbs - right.valueLbs);
  }
  return result;
}

export async function setCompetitorWeightPreferences(service, {
  competitorId,
  eventId,
  weightOptionIds,
  optional = false,
}) {
  const options = await validatedEventWeightOptions(service, eventId, weightOptionIds, { optional });
  const { error: deleteError } = await service
    .from("superfight_competitor_weight_preferences")
    .delete()
    .eq("competitor_id", competitorId);
  if (deleteError) throw databaseFailure(deleteError, "competitor weight preference reset failed");

  if (options.length > 0) {
    const { error: insertError } = await service
      .from("superfight_competitor_weight_preferences")
      .insert(options.map((option) => ({
        competitor_id: competitorId,
        event_id: eventId,
        weight_option_id: option.id,
      })));
    if (insertError) throw databaseFailure(insertError, "competitor weight preference write failed");
  }

  const primary = options[0] ?? null;
  const { error: anchorError } = await service
    .from("superfight_competitors")
    .update({
      weight_option_id: primary?.id ?? null,
      competition_weight_lbs: primary?.valueLbs ?? null,
    })
    .eq("id", competitorId);
  if (anchorError) throw databaseFailure(anchorError, "competitor weight anchor update failed");
  return options;
}
