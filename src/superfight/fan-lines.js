// Every matchup opens with two baseline picks per side and no real votes.
// PK is an immutable opening rule, never a snapshot of today's vote totals.
export const OPENING_PERCENTAGE = 50;

export function fanOdds(percentage) {
  const share = Math.max(1, Math.min(99, percentage));
  if (share === 50) return "PK";
  // Use complementary integer shares so both sides round identically at half steps.
  const amount = Math.round(Math.max(share, 100 - share) / Math.min(share, 100 - share) * 20) * 5;
  return `${share > 50 ? "-" : "+"}${amount}`;
}

export function withFanLines(snapshot) {
  const matches = snapshot.matches.map(match => {
    const fighters = match.fighters.map(fighter => ({
      ...fighter,
      openingOdds: "PK",
      fanOdds: fanOdds(fighter.percentage),
      movement: fighter.percentage - OPENING_PERCENTAGE,
    }));
    return {
      ...match, fighters, openingLine: "PK",
      trendFighterId: fighters.find(f => f.movement > 0)?.id || null,
    };
  });
  // Stable IDs break ties, so editing a name never rearranges tied summaries.
  const candidates = matches.flatMap(match => match.fighters.map(fighter => ({
    matchId: match.id, fighterId: fighter.id, name: fighter.name,
    percentage: fighter.percentage, picks: fighter.picks,
    fanOdds: fighter.fanOdds, movement: fighter.movement,
  }))).sort((a, b) => a.matchId.localeCompare(b.matchId) || a.fighterId.localeCompare(b.fighterId));
  const leaders = candidates.filter(f => f.picks > 0);
  const maximum = (items, value) => items.reduce((best, item) => !best || value(item) > value(best) ? item : best, null);
  const closest = [...matches].sort((a, b) => Math.abs(a.fighters[0].percentage - 50) - Math.abs(b.fighters[0].percentage - 50) || a.id.localeCompare(b.id))[0];
  return { ...snapshot, matches, summary: {
    mostPicked: maximum(leaders, f => f.picks),
    biggestFavorite: maximum(leaders.filter(f => f.percentage > 50), f => f.percentage),
    closestLine: closest ? { matchId: closest.id, names: closest.fighters.map(f => f.name), odds: closest.fighters.map(f => f.fanOdds) } : null,
    biggestMover: maximum(leaders.filter(f => f.movement > 0), f => f.movement),
  } };
}
