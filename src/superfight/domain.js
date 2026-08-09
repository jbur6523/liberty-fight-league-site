const BELT_RANK = Object.freeze({
  blue: 0,
  purple: 1,
  brown: 2,
  black: 3,
});

export const MATCHMAKING_PENALTIES = Object.freeze({
  unknownDivision: 100_000,
  unknownPreference: 10_000,
  beltStep: 1_000,
  unknownBelt: 4_000,
  missingWeight: 250,
  ageYear: 0.01,
  missingAge: 5,
});

const INSTAGRAM_HOSTS = new Set([
  "instagram.com",
  "www.instagram.com",
  "m.instagram.com",
]);

function normalizeOptionalText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeHandle(value) {
  const handle = value.replace(/^@+/, "").replace(/^\/+|\/+$/g, "").trim();

  if (!handle || !/^[a-zA-Z0-9._]+$/.test(handle)) {
    throw new TypeError("Enter an Instagram username, @handle, or profile URL.");
  }

  return handle.toLowerCase();
}

/**
 * Normalizes the three public input formats supported by the application:
 * @handle, username, and a full Instagram profile URL.
 */
export function normalizeInstagram(value) {
  const input = normalizeOptionalText(value);

  if (!input) {
    return { handle: null, url: null };
  }

  const looksLikeUrl = /^https?:\/\//i.test(input) || /^(?:www\.|m\.)?instagram\.com\//i.test(input);
  let handle;

  if (looksLikeUrl) {
    const candidate = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    let parsed;

    try {
      parsed = new URL(candidate);
    } catch {
      throw new TypeError("Enter a valid Instagram profile URL.");
    }

    if (!INSTAGRAM_HOSTS.has(parsed.hostname.toLowerCase())) {
      throw new TypeError("Enter an Instagram profile URL.");
    }

    const [profileSegment] = parsed.pathname.split("/").filter(Boolean);
    handle = normalizeHandle(profileSegment ?? "");
  } else {
    handle = normalizeHandle(input);
  }

  return {
    handle,
    url: `https://www.instagram.com/${handle}/`,
  };
}

function normalizedBelt(value) {
  const belt = normalizeOptionalText(value)?.toLowerCase();
  return belt && Object.hasOwn(BELT_RANK, belt) ? belt : null;
}

function normalizedWeight(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const weight = Number(value);
  return Number.isFinite(weight) && weight > 0 ? weight : null;
}

function normalizedAge(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const age = Number(value);
  return Number.isInteger(age) && age >= 1 && age <= 120 ? age : null;
}

function normalizedDivision(competitor) {
  const value = normalizeOptionalText(competitor.genderDivision ?? competitor.gender_division)?.toLowerCase();
  return new Set(["mens", "womens"]).has(value) ? value : null;
}

function normalizedPreference(competitor) {
  const value = normalizeOptionalText(
    competitor.grapplingPreference ?? competitor.grappling_preference,
  )?.toLowerCase();
  return new Set(["gi", "no_gi", "both"]).has(value) ? value : null;
}

function preferencesCompatible(left, right) {
  if (!left || !right) return true;
  if (left === "both" || right === "both") return true;
  return left === right;
}

function eventIdentity(competitor) {
  return competitor.eventId ?? competitor.event_id ?? null;
}

function competitorIdentity(competitor) {
  return String(competitor.id ?? competitor.fullName ?? competitor.full_name ?? "");
}

function competitorName(competitor) {
  return normalizeOptionalText(competitor.fullName ?? competitor.full_name) ?? "";
}

function compareText(left, right) {
  return left.localeCompare(right, "en", { sensitivity: "base" });
}

function beltSortValue(competitor) {
  const belt = normalizedBelt(competitor.belt);
  return belt === null ? Number.POSITIVE_INFINITY : BELT_RANK[belt];
}

function weightSortValue(competitor) {
  return normalizedWeight(competitor.competitionWeightLbs ?? competitor.competition_weight_lbs)
    ?? Number.POSITIVE_INFINITY;
}

function ageSortValue(competitor) {
  return normalizedAge(competitor.age) ?? Number.POSITIVE_INFINITY;
}

function divisionSortValue(competitor) {
  return { mens: 0, womens: 1 }[normalizedDivision(competitor)] ?? 2;
}

function preferenceSortValue(competitor) {
  return { gi: 0, both: 1, no_gi: 2 }[normalizedPreference(competitor)] ?? 3;
}

function stableIdentityComparison(left, right) {
  return compareText(competitorName(left), competitorName(right))
    || compareText(competitorIdentity(left), competitorIdentity(right));
}

/**
 * Returns a deterministic distance. Lower values indicate more useful visual
 * proximity; this function never creates a match.
 */
export function scoreCompatibility(left, right) {
  const leftEvent = eventIdentity(left);
  const rightEvent = eventIdentity(right);

  if (leftEvent && rightEvent && leftEvent !== rightEvent) {
    return Number.POSITIVE_INFINITY;
  }

  const leftDivision = normalizedDivision(left);
  const rightDivision = normalizedDivision(right);
  if (leftDivision && rightDivision && leftDivision !== rightDivision) {
    return Number.POSITIVE_INFINITY;
  }
  const divisionPenalty = Boolean(leftDivision) === Boolean(rightDivision)
    ? 0
    : MATCHMAKING_PENALTIES.unknownDivision;

  const leftPreference = normalizedPreference(left);
  const rightPreference = normalizedPreference(right);
  if (!preferencesCompatible(leftPreference, rightPreference)) {
    return Number.POSITIVE_INFINITY;
  }
  const preferencePenalty = Boolean(leftPreference) === Boolean(rightPreference)
    ? 0
    : MATCHMAKING_PENALTIES.unknownPreference;

  const leftBelt = normalizedBelt(left.belt);
  const rightBelt = normalizedBelt(right.belt);
  const beltPenalty = leftBelt === null || rightBelt === null
    ? MATCHMAKING_PENALTIES.unknownBelt
    : Math.abs(BELT_RANK[leftBelt] - BELT_RANK[rightBelt]) * MATCHMAKING_PENALTIES.beltStep;

  const leftWeight = normalizedWeight(left.competitionWeightLbs ?? left.competition_weight_lbs);
  const rightWeight = normalizedWeight(right.competitionWeightLbs ?? right.competition_weight_lbs);
  const weightPenalty = leftWeight === null || rightWeight === null
    ? (leftWeight === null && rightWeight === null ? 0 : MATCHMAKING_PENALTIES.missingWeight)
    : Math.abs(leftWeight - rightWeight);

  const leftAge = normalizedAge(left.age);
  const rightAge = normalizedAge(right.age);
  const agePenalty = leftAge === null || rightAge === null
    ? (leftAge === null && rightAge === null ? 0 : MATCHMAKING_PENALTIES.missingAge)
    : Math.abs(leftAge - rightAge) * MATCHMAKING_PENALTIES.ageYear;

  return divisionPenalty + preferencePenalty + beltPenalty + weightPenalty + agePenalty;
}

function canonicalComparison(left, right) {
  return divisionSortValue(left) - divisionSortValue(right)
    || preferenceSortValue(left) - preferenceSortValue(right)
    || beltSortValue(left) - beltSortValue(right)
    || weightSortValue(left) - weightSortValue(right)
    || ageSortValue(left) - ageSortValue(right)
    || stableIdentityComparison(left, right);
}

/**
 * Produces adjacent candidate pairs without selecting or persisting a matchup.
 * Each canonical anchor is followed by its lowest-scoring available candidate.
 */
export function suggestedOrder(competitors) {
  const remaining = [...competitors].sort(canonicalComparison);
  const ordered = [];

  while (remaining.length > 0) {
    const anchor = remaining.shift();
    ordered.push(anchor);

    if (remaining.length === 0) {
      break;
    }

    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let index = 0; index < remaining.length; index += 1) {
      const candidateScore = scoreCompatibility(anchor, remaining[index]);

      if (
        candidateScore < bestScore
        || (
          candidateScore === bestScore
          && bestIndex >= 0
          && canonicalComparison(remaining[index], remaining[bestIndex]) < 0
        )
      ) {
        bestIndex = index;
        bestScore = candidateScore;
      }
    }

    if (bestIndex >= 0) {
      ordered.push(remaining.splice(bestIndex, 1)[0]);
    }
  }

  return ordered;
}

export function sortCompetitors(competitors, mode = "suggested") {
  if (mode === "suggested") {
    return suggestedOrder(competitors);
  }

  const comparisons = {
    belt: canonicalComparison,
    weight: (left, right) => (
      weightSortValue(left) - weightSortValue(right)
      || beltSortValue(left) - beltSortValue(right)
      || stableIdentityComparison(left, right)
    ),
    name: stableIdentityComparison,
  };

  const comparison = comparisons[mode];
  if (!comparison) {
    throw new TypeError(`Unsupported competitor sort mode: ${mode}`);
  }

  return [...competitors].sort(comparison);
}
