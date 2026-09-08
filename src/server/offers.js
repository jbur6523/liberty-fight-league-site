import { createHmac } from "node:crypto";
import { HttpError, databaseFailure } from "./http.js";
import { loadCompetitorWeightOptions } from "./weight-preferences.js";
import { normalizeInstagram } from "../superfight/domain.js";

export function offerInstagram(value) {
  try {
    const result = normalizeInstagram(value);
    if (!result.handle || result.handle.length > 30) throw new Error();
    return result.handle;
  } catch { throw new HttpError(400, "Enter a valid Instagram handle or profile URL.", "invalid_instagram"); }
}

export function publicCompetitor(record, weights = [], { detail = false } = {}) {
  const result = {
    id: record.id,
    firstName: record.full_name.trim().split(/\s+/)[0],
    belt: record.belt ?? record.experience_level ?? null,
    grapplingPreference: record.grappling_preference,
    weightOptions: weights.map(({ label, valueLbs }) => ({ label, valueLbs })),
  };
  if (detail) {
    result.instagramHandle = record.instagram_handle;
    result.gym = record.gym;
  }
  return result;
}

export async function availableCompetitors(service, { eventId, competitorId } = {}) {
  let query = service.from("superfight_competitors")
    .select("id,event_id,full_name,belt,experience_level,grappling_preference,instagram_handle,gym")
    .eq("record_state", "active").eq("matchmaking_pool", "standard");
  if (eventId) query = query.eq("event_id", eventId);
  if (competitorId) query = query.eq("id", competitorId);
  const { data: records, error } = await query.order("created_at", { ascending: true });
  if (error) throw databaseFailure(error, "public available competitors failed");
  if (!records.length) return [];
  const eventIds = [...new Set(records.map((record) => record.event_id))];
  const [{ data: events, error: eventError }, { data: matches, error: matchError }] = await Promise.all([
    service.from("superfight_events").select("id").in("id", eventIds).eq("applications_open", true),
    service.from("superfight_matches").select("fighter_a_id,fighter_b_id,fighter_c_id,fighter_d_id").in("event_id", eventIds).eq("state", "active"),
  ]);
  if (eventError || matchError) throw databaseFailure(eventError || matchError, "public availability failed");
  const open = new Set(events.map((event) => event.id));
  const matched = new Set(matches.flatMap((match) => [match.fighter_a_id, match.fighter_b_id, match.fighter_c_id, match.fighter_d_id].filter(Boolean)));
  return records.filter((record) => open.has(record.event_id) && !matched.has(record.id));
}

export async function offerRateLimit(service, request, action) {
  const ip = String(request.headers["x-vercel-forwarded-for"] || request.headers["x-forwarded-for"] || request.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const hash = createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY).update(ip).digest("hex");
  const { data, error } = await service.rpc("consume_superfight_offer_limit", {
    rate_bucket: `${action}:${hash}`, maximum: action === "lookup" ? 40 : 10,
  });
  if (error) throw databaseFailure(error, "offer rate limit failed");
  if (!data) throw new HttpError(429, "Too many requests. Please try again in a few minutes.", "rate_limited");
}

export async function adminOffers(service, eventId) {
  const { data: offers, error } = await service.from("superfight_offers")
    .select("id,event_id,target_competitor_id,offering_competitor_id,bout_type,offered_weight_lbs,state,created_at,notification_state")
    .eq("event_id", eventId).eq("state", "pending").order("created_at", { ascending: false });
  if (error) throw databaseFailure(error, "admin offers failed");
  if (!offers.length) return [];
  const ids = [...new Set(offers.flatMap((offer) => [offer.target_competitor_id, offer.offering_competitor_id]))];
  const [{ data: competitors, error: fighterError }, weights, { data: matches, error: matchError }] = await Promise.all([
    service.from("superfight_competitors").select("id,full_name,belt,experience_level,competition_weight_lbs,gym,instagram_handle,grappling_preference,gender_division,age,record_state,matchmaking_pool").in("id", ids),
    loadCompetitorWeightOptions(service, ids),
    service.from("superfight_matches").select("fighter_a_id,fighter_b_id,fighter_c_id,fighter_d_id").eq("event_id", eventId).eq("state", "active"),
  ]);
  if (fighterError || matchError) throw databaseFailure(fighterError || matchError, "admin offer competitors failed");
  const matched = new Set(matches.flatMap((match) => [match.fighter_a_id, match.fighter_b_id, match.fighter_c_id, match.fighter_d_id].filter(Boolean)));
  const map = new Map(competitors.map((record) => [record.id, {
    id: record.id, name: record.full_name, belt: record.belt ?? record.experience_level,
    weightLbs: record.competition_weight_lbs, gym: record.gym, instagramHandle: record.instagram_handle,
    grapplingPreference: record.grappling_preference, genderDivision: record.gender_division, age: record.age,
    weightOptions: weights.get(record.id) ?? [], matchmakingPool: record.matchmaking_pool,
    available: record.record_state === "active" && !matched.has(record.id),
  }]));
  return offers.map((offer) => ({
    id: offer.id, target: map.get(offer.target_competitor_id), offering: map.get(offer.offering_competitor_id),
    boutType: offer.bout_type, weightLbs: offer.offered_weight_lbs, createdAt: offer.created_at,
    notificationState: offer.notification_state,
    canMatch: map.get(offer.target_competitor_id)?.available && map.get(offer.target_competitor_id)?.matchmakingPool === "standard" && map.get(offer.offering_competitor_id)?.available,
  }));
}

export function compareAvailableCompetitors(left, right) {
  const ranks = { blue: 0, purple: 1, brown: 2, black: 3, white: 4, unranked: 5 };
  const lightest = (fighter) => Math.min(...fighter.weightOptions.map((option) =>
    /open weight/i.test(option.label) || !Number(option.valueLbs) ? Infinity : Number(option.valueLbs)));
  return (ranks[left.belt] ?? 6) - (ranks[right.belt] ?? 6)
    || (lightest(left) - lightest(right)) || left.firstName.localeCompare(right.firstName);
}
