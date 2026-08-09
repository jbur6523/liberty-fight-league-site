import { HttpError } from "../server/http.js";

export const BELTS = Object.freeze(["blue", "purple", "brown", "black"]);
export const GENDER_DIVISIONS = Object.freeze(["mens", "womens"]);
export const GRAPPLING_PREFERENCES = Object.freeze(["gi", "no_gi", "both"]);
export const BOUT_TYPES = Object.freeze(["gi", "no_gi"]);

export function optionalText(value, fieldName, maximumLength) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  if (text.length > maximumLength) {
    throw new HttpError(400, `${fieldName} is too long.`, "invalid_application");
  }

  return text;
}

export function requiredText(value, fieldName, maximumLength) {
  const text = optionalText(value, fieldName, maximumLength);
  if (!text) {
    throw new HttpError(400, `${fieldName} is required.`, "invalid_application");
  }
  return text;
}

export function uuid(value, fieldName) {
  const text = requiredText(value, fieldName, 50).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(text)) {
    throw new HttpError(400, `${fieldName} is invalid.`, "invalid_identifier");
  }
  return text;
}

export function belt(value, { optional = false } = {}) {
  const normalized = optionalText(value, "Belt", 20)?.toLowerCase() ?? null;

  if (!normalized && optional) {
    return null;
  }

  if (!normalized || !BELTS.includes(normalized)) {
    throw new HttpError(400, "Select a valid belt.", "invalid_application");
  }

  return normalized;
}

export function email(value, { optional = false } = {}) {
  const normalized = optionalText(value, "Email", 254)?.toLowerCase() ?? null;

  if (!normalized && optional) {
    return null;
  }

  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new HttpError(400, "Enter a valid email address.", "invalid_application");
  }

  return normalized;
}

export function positiveWeight(value, { optional = false } = {}) {
  if ((value === null || value === undefined || value === "") && optional) {
    return null;
  }

  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 9999) {
    throw new HttpError(400, "Enter a valid competition weight.", "invalid_application");
  }

  return Math.round(number * 100) / 100;
}

export function competitorAge(value, { optional = false } = {}) {
  if ((value === null || value === undefined || value === "") && optional) {
    return null;
  }

  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 120) {
    throw new HttpError(400, "Enter a valid age in completed years.", "invalid_application");
  }

  return number;
}

function structuredChoice(value, fieldName, values, { optional = false } = {}) {
  const normalized = optionalText(value, fieldName, 30)?.toLowerCase() ?? null;

  if (!normalized && optional) {
    return null;
  }

  if (!normalized || !values.includes(normalized)) {
    throw new HttpError(400, `Select a valid ${fieldName.toLowerCase()}.`, "invalid_application");
  }

  return normalized;
}

export function genderDivision(value, options) {
  return structuredChoice(value, "Gender / division", GENDER_DIVISIONS, options);
}

export function grapplingPreference(value, options) {
  return structuredChoice(value, "Gi / No-Gi preference", GRAPPLING_PREFERENCES, options);
}

export function boutType(value) {
  return structuredChoice(value, "Bout type", BOUT_TYPES);
}
