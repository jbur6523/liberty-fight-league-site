// Editorial placement for RWI 3, using the actual event and pairing IDs.
// This never creates a matchup or changes its votes or admin lineup order.
const mainEvent = {
  eventId: "0dba77b1-763a-4614-bb9c-cea568e0576c",
  matchId: "2cdc3fa5-17dd-4e16-9133-ecc2577445fb",
  fighterIds: ["82c86753-55f7-49c6-87bb-dfbb27565680", "bc52aeaa-f40a-4a43-8866-a2871a677836"],
};

export function isMainEvent(eventId, match) {
  return eventId === mainEvent.eventId && match.id === mainEvent.matchId &&
    match.fighters.length === 2 && mainEvent.fighterIds.every(id => match.fighters.some(fighter => fighter.id === id));
}

export function boardMatches(eventId, matches) {
  return [...matches].sort((a, b) => Number(isMainEvent(eventId, b)) - Number(isMainEvent(eventId, a)));
}
