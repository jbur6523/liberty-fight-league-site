import { HttpError } from "../server/http.js";
import { positiveWeight, uuid } from "./validation.js";

function normalizedPreference(value) {
  return ["gi", "no_gi", "both"].includes(value) ? value : null;
}

export function formatPreferencesConflict(leftPreference, rightPreference) {
  const left = normalizedPreference(leftPreference);
  const right = normalizedPreference(rightPreference);
  return Boolean(left && right && left !== "both" && right !== "both" && left !== right);
}

export function resolveMatchWeight({
  sharedWeightOptionIds,
  weightOptionId,
  agreedWeightLbs,
}) {
  const shared = new Set(sharedWeightOptionIds);
  const hasWeightOption = weightOptionId !== null && weightOptionId !== undefined && weightOptionId !== "";
  const hasManualWeight = agreedWeightLbs !== null && agreedWeightLbs !== undefined && agreedWeightLbs !== "";

  if (shared.size > 0) {
    if (hasManualWeight) {
      throw new HttpError(400, "Choose the contracted weight class shared by both competitors.", "invalid_match");
    }
    const selectedWeightOptionId = uuid(weightOptionId, "Final weight class");
    if (!shared.has(selectedWeightOptionId)) {
      throw new HttpError(409, "Choose a final weight class accepted by both competitors.", "match_conflict");
    }
    return { weightOptionId: selectedWeightOptionId, matchWeightLbs: null };
  }

  if (hasWeightOption) {
    throw new HttpError(400, "Enter the agreed match weight in pounds.", "invalid_match");
  }

  return {
    weightOptionId: null,
    matchWeightLbs: positiveWeight(agreedWeightLbs),
  };
}

