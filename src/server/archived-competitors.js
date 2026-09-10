import { HttpError, databaseFailure } from "./http.js";

export async function restoreCompetitor(service, competitorId) {
  const { data, error } = await service.from("superfight_competitors")
    .update({ record_state: "active", matchmaking_pool: "standard" })
    .eq("id", competitorId)
    .eq("record_state", "withdrawn")
    .select("id")
    .maybeSingle();
  if (error?.code === "23505") {
    throw new HttpError(409, "An active competitor already uses this Instagram for this event. Update the duplicate before restoring this profile.", "restore_duplicate");
  }
  if (error) throw databaseFailure(error, "admin competitor restore failed");
  if (!data) throw new HttpError(409, "This competitor is no longer archived. Refresh the list and try again.", "restore_conflict");
  return { restored: true, competitorId: data.id };
}
