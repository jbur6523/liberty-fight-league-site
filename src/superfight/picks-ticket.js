import { boardMatches } from "./board-order.js";

// Only confirmed votes in the server snapshot belong on a normal Fan Picks ticket.
export function savedFanPicks(snapshot) {
  return boardMatches(snapshot.event?.id, snapshot.matches).flatMap(match => {
    const fighter = match.fighters.find(item => item.id === match.selectedFighterId);
    if (!fighter) return [];
    return [{ ...fighter, matchId: match.id }];
  });
}
