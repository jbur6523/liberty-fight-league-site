import { randomBytes } from "node:crypto";
import { HttpError, databaseFailure } from "./http.js";
import { loadCompetitorWeightOptions } from "./weight-preferences.js";
import { profileSnapshot, readProfileSnapshot } from "../superfight/share-profile.js";

export async function createProfileShare(service, competitorId) {
  const { data: fighter, error } = await service.from("superfight_competitors")
    .select("id, full_name, age, belt, gym, instagram_handle")
    .eq("id", competitorId).eq("record_state", "active").maybeSingle();
  if (error) throw databaseFailure(error, "profile share competitor lookup failed");
  if (!fighter) throw new HttpError(404, "Competitor could not be found.", "competitor_not_found");
  const weights = await loadCompetitorWeightOptions(service, [fighter.id]);
  const profile = profileSnapshot({ name: fighter.full_name, age: fighter.age, belt: fighter.belt,
    gym: fighter.gym, instagramHandle: fighter.instagram_handle, weightOptions: weights.get(fighter.id) });
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = randomBytes(12).toString("base64url");
    const { error: insertError } = await service.from("superfight_profile_shares").insert({ token, profile });
    if (!insertError) return { path: `/p/${token}` };
    if (insertError.code !== "23505") throw databaseFailure(insertError, "profile share creation failed");
  }
  throw new HttpError(503, "Could not create a profile link. Please try again.");
}

export async function getProfileShare(service, token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{16}$/.test(token)) {
    throw new HttpError(404, "Profile link not found.", "profile_not_found");
  }
  const { data, error } = await service.from("superfight_profile_shares")
    .select("profile").eq("token", token).maybeSingle();
  if (error) throw databaseFailure(error, "profile share lookup failed");
  const profile = data && readProfileSnapshot(encodeURIComponent(JSON.stringify(data.profile)));
  if (!profile) throw new HttpError(404, "Profile link not found.", "profile_not_found");
  // Reapply the allowlist even if stored data contains unexpected fields.
  return profileSnapshot({ ...profile, weightOptions: profile.weightClasses.map(label => ({ label })) });
}
