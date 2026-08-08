export function confirmationState(confirmations, fighterAId, fighterBId) {
  const responses = new Map(confirmations.map((item) => [item.competitor_id, item.response]));
  const fighterA = responses.get(fighterAId) ?? "awaiting";
  const fighterB = responses.get(fighterBId) ?? "awaiting";

  let summary = "awaiting_confirmation";
  if (fighterA === "declined" || fighterB === "declined") {
    summary = "declined";
  } else if (fighterA === "accepted" && fighterB === "accepted") {
    summary = "both_accepted";
  } else if (fighterA === "accepted") {
    summary = "fighter_a_accepted";
  } else if (fighterB === "accepted") {
    summary = "fighter_b_accepted";
  }

  return { fighterA, fighterB, summary };
}
