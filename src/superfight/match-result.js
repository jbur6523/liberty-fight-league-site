// A group winner is a real participant, while votes use the A/B outcome keys.
export function matchResult(match) {
  if (!match.winnerFighterId) return null;
  const participants = match.groupPick ? [match.anchor, ...match.opponents] : match.fighters;
  const winner = participants.find(fighter => fighter.id === match.winnerFighterId);
  if (!winner) return null;
  return { winnerName: winner.name, outcomeId: match.groupPick && winner.id !== match.anchor.id ? match.fighters[1].id : winner.id };
}
