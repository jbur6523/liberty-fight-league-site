// Deliberately include only the six fields intended for sharing.
export function profileSnapshot(competitor) {
  return {
    name: String(competitor.name ?? ""),
    age: competitor.age ?? null,
    belt: String(competitor.belt ?? ""),
    weightClasses: (competitor.weightOptions ?? []).map(option => String(option.label)),
    gym: String(competitor.gym ?? ""),
    instagramHandle: String(competitor.instagramHandle ?? "").replace(/^@/, ""),
  };
}

export function profileShareUrl(competitor, origin) {
  const url = new URL("/fighter-profile.html", origin);
  url.hash = encodeURIComponent(JSON.stringify(profileSnapshot(competitor)));
  return url.href;
}

export function readProfileSnapshot(hash) {
  try {
    if (!hash || hash.length > 20000) return null;
    const data = JSON.parse(decodeURIComponent(hash.replace(/^#/, "")));
    if (!data || typeof data.name !== "string" || !data.name.trim()
      || ![data.belt, data.gym, data.instagramHandle].every(value => typeof value === "string")
      || !(data.age === null || (Number.isInteger(data.age) && data.age >= 0 && data.age <= 130))
      || !Array.isArray(data.weightClasses) || !data.weightClasses.every(value => typeof value === "string")) return null;
    return data;
  } catch {
    return null;
  }
}
