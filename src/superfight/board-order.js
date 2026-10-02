// Scheduled display order for RWI 3, using verified public matchup IDs.
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

// Match numbers follow the published October 3 schedule. Unknown cards stay at the end.
const scheduledMatchIds = [
  "8865d9ec-374a-46cc-bf9d-db4437897a42", // 1: Theodore V. vs Fernando P.
  "a0c8776c-dd8b-4776-ac2f-77fc3d6a318b", // 2: Neel W. vs Andy L.
  "7efea92f-b1cf-44b0-ba92-449750e110f4", // 3: Jonathan M. vs Stiwart M.
  "5745ea5b-7b6e-424f-ac4c-d3c3858cf79a", // 4: Matthew Y. vs Nate N.
  "22516a5a-86a0-442b-9660-7806664cc530", // 5: Elijah H. vs Carlos U.
  "9fa4b986-d00b-4d89-b100-888dbfb7716b", // 6: Orry E. vs Jonathan C.
  "63f64066-30d5-41b2-ad8b-aea2812f4d45", // 7: Ricky M. vs William E.
  "373d1c64-17c9-4f51-a8a5-c37f68af0f6a", // 8: Kurtis W. vs Joseph H.
  "88aa574d-0d4b-4555-945a-970ee165fdcc", // 9: Matthew M. vs Bradley A.
  "bac57098-d592-42a2-a39e-aaa23016677f", // 10: Eddie G. vs Beau O.
  "1b52155a-8136-4c36-b925-a669fbab308a", // 11: Will H. vs Luca
  "95270b93-f28e-4323-b4ce-3dc2a087e4e5", // 12: Hazaiah F. vs Daniel A.
  "94d88b3c-68e7-48bc-98fd-99ecd82c3b7b", // 13: Victor S. vs Asinobi I.
  "18404fe0-b497-4d2f-a642-0c1c4fdb277b", // 14: Angel vs Rickieh
  "e80a2907-7c16-4dd7-9622-223a88fd508f", // 15: Ryan P. vs Jaxson N.
  "f28e0d9a-2f0f-46a4-93ca-87d9d8e457b6", // 16: Daniel V. vs Kaden N.
  "76b24a93-6c58-4160-ae80-54f656b8ebf6", // 17: Joseph G. vs Bradley A.
  "f7ff2d66-65b1-4027-98e3-6fa587550b41", // 18: Treyvon A. vs Mario C.
  "477bddc5-9cfc-4b9b-871d-b19f92659cff", // 19: Josiah S. vs Xavier M.
  "e6219367-c4e4-4eee-86b0-5b0e8adcc084", // 20: Jack C. vs Jared H.
  "ea7e9aaa-a12e-42cb-b927-5e11b0fd9fab", // 21: Christopher C. vs Kelly I.
  "df6711bb-69c8-4b53-b3a7-f4e562049567", // 22: Travis S. vs Taylor B.
  "362a03e9-2729-4ee1-af18-b3f374e3b379", // 23: Victor S. vs Ryan M.
  "67f6bfca-fb87-43b3-900c-fd40c35ac96b", // 24: Angel O. vs Jaraad G.
  "0b1aea03-e473-4470-b0f2-ba13e24ea154", // 25: Andre K. vs Toby F.
  "dfdc02db-9b72-4b2f-97e3-105ff474bbe0", // 26: Maurice W. vs Wei-Sean C.
  "314b1cb4-5972-4584-90a4-5ca331fcb97c", // 27: Ahmed W. sweeps vs Opponents vs Ahmed W.
  "113c499d-de10-4e95-a0a3-ad28d51ab950", // 28: Richie S. vs Christopher V.
  "ea969b37-1b1d-4889-8a81-df0abce7ebac", // 29: Brian W. vs Evan B.
  "2cdc3fa5-17dd-4e16-9133-ecc2577445fb", // 30: Ty C. vs Hurricane
];
const schedulePosition = new Map(scheduledMatchIds.map((id, index) => [id, index]));

export function boardMatches(eventId, matches) {
  if (eventId !== mainEvent.eventId) return [...matches];
  const position = match => schedulePosition.get(match.id) ?? Infinity;
  return [...matches].sort((a, b) => position(a) - position(b));
}

export function scheduledMatchNumber(eventId, match) {
  const index = eventId === mainEvent.eventId ? schedulePosition.get(match.id) : undefined;
  return index === undefined ? null : index + 1;
}
