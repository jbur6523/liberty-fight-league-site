const key = eventId => `lfl:fan-parlay:v1:${eventId}`;

export function restoreParlay(storage, snapshot) {
  if (!storage || !snapshot.event?.id) return [];
  try {
    const raw = storage.getItem(key(snapshot.event.id));
    if (!raw || raw.length > 200_000) return [];
    const saved = JSON.parse(raw);
    if (saved.version !== 1 || saved.eventId !== snapshot.event.id || !Array.isArray(saved.picks)) return [];
    const valid = new Map();
    for (const pick of saved.picks) {
      if (!Array.isArray(pick) || pick.length !== 2) continue;
      const [matchId, fighterId] = pick;
      if (typeof matchId !== "string" || typeof fighterId !== "string") continue;
      if (snapshot.matches.some(m => m.id === matchId && m.fighters.some(f => f.id === fighterId))) valid.set(matchId, fighterId);
    }
    return [...valid];
  } catch { return []; }
}

export function rememberParlay(storage, eventId, picks) {
  if (!storage || !eventId) return false;
  try {
    if (picks.size) storage.setItem(key(eventId), JSON.stringify({ version: 1, eventId, picks: [...picks] }));
    else storage.removeItem(key(eventId));
    return true;
  } catch { return false; }
}
