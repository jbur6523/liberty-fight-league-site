import { HttpError, databaseFailure } from "./http.js";

export async function moveCompetitorPool(service, competitorId, pool) {
  if (!["standard", "john_wick", "gauntlet"].includes(pool)) {
    throw new HttpError(400, "Choose a valid matchmaking pool.", "invalid_pool");
  }
  const { data, error } = await service.from("superfight_competitors")
    .update({ matchmaking_pool: pool })
    .eq("id", competitorId)
    .eq("record_state", "active")
    .select("id, matchmaking_pool")
    .maybeSingle();
  if (error) throw databaseFailure(error, "admin matchmaking pool move failed");
  if (!data) throw new HttpError(409, "This competitor is no longer available.", "pool_conflict");
  return { id: data.id, matchmakingPool: data.matchmaking_pool };
}
