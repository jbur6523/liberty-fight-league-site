import places from "./data/us-places.json" with { type: "json" };
import { normalizeState } from "../superfight/us-states.js";
import { HttpError } from "./http.js";
import { optionalText, requiredText } from "../superfight/validation.js";

export const SAN_FRANCISCO = [37.7749, -122.4194];

function cityKey(value) {
  return String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[.'’]/g, "").replace(/\s+/g, " ").trim();
}

const coordinates = new Map();
for (const [state, name, latitude, longitude] of places) {
  const city = name.replace(/ (?:city and borough|municipality|unified government|consolidated government|metro government|metropolitan government|city|town|village|borough|CDP)$/i, "");
  const key = `${state}:${cityKey(city)}`;
  // Same-name places within a state are ambiguous; do not guess a distance.
  coordinates.set(key, coordinates.has(key) ? null : [latitude, longitude]);
}
coordinates.set("CA:san francisco", SAN_FRANCISCO);

export function milesBetween([latitude, longitude], [targetLatitude, targetLongitude]) {
  const radians = degrees => degrees * Math.PI / 180;
  const a = Math.sin(radians(targetLatitude - latitude) / 2) ** 2
    + Math.cos(radians(latitude)) * Math.cos(radians(targetLatitude))
    * Math.sin(radians(targetLongitude - longitude) / 2) ** 2;
  return Math.round(3958.7613 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a)))));
}

export function distanceFromSanFrancisco(city, state) {
  const point = coordinates.get(`${normalizeState(state)}:${cityKey(city ?? "")}`);
  return point ? milesBetween(point, SAN_FRANCISCO) : null;
}

export function competitorLocation(body, { optional = false } = {}) {
  const city = optional ? optionalText(body.city, "City", 100) : requiredText(body.city, "City", 100);
  const stateInput = optionalText(body.state, "State", 60);
  const state = normalizeState(stateInput);
  if ((stateInput && !state) || (!optional && !state)) {
    throw new HttpError(400, "Select a valid state.", "invalid_application");
  }
  if (Boolean(city) !== Boolean(state)) {
    throw new HttpError(400, "Enter both city and state.", "invalid_application");
  }
  return { city, state, distance_from_sf_miles: city && state ? distanceFromSanFrancisco(city, state) : null };
}
