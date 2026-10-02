export function impliedProbability(line) {
  if (line === "PK") return 0.5;
  const odds = Number(line);
  if (!Number.isFinite(odds) || odds === 0) throw new Error("Invalid fan line");
  return odds < 0 ? Math.abs(odds) / (Math.abs(odds) + 100) : 100 / (odds + 100);
}

export function combinedFanOdds(legs) {
  if (legs.length < 2) return null;
  const logProbability = legs.reduce((sum, leg) => sum + Math.log(impliedProbability(leg.fanOdds)), 0);
  const probability = Math.exp(logProbability);
  // Work in log space for exceptionally large combinations, without imposing a cap.
  const logMagnitude = -logProbability + Math.log(100);
  if (logMagnitude > Math.log(Number.MAX_VALUE)) {
    let exponent = Math.floor(logMagnitude / Math.LN10);
    let mantissa = Number(Math.exp(logMagnitude - exponent * Math.LN10).toFixed(2));
    if (mantissa >= 10) { mantissa /= 10; exponent++; }
    return `+${mantissa.toFixed(2)} × 10^${exponent}`;
  }
  const odds = probability <= 0.5 ? Math.expm1(-logProbability) * 100 : -100 * probability / (1 - probability);
  const magnitude = Math.abs(Math.round(odds));
  const formatted = magnitude >= 1e12 ? magnitude.toExponential(2) : new Intl.NumberFormat("en-US").format(magnitude);
  return `${odds >= 0 ? "+" : "-"}${formatted}`;
}

export class FanParlay {
  active = false;
  expanded = false;
  eventId = null;
  picks = new Map();
  sync(snapshot) {
    if (this.eventId !== snapshot.event?.id) {
      this.picks.clear();
      this.expanded = false;
    }
    this.eventId = snapshot.event?.id ?? null;
    for (const [matchId, fighterId] of this.picks) {
      if (!snapshot.matches.some(m => m.id === matchId && m.fighters.some(f => f.id === fighterId))) this.picks.delete(matchId);
    }
    if (this.picks.size < 2) this.expanded = false;
  }
  toggle(matchId, fighterId, snapshot) {
    if (!this.active || !snapshot.matches.some(m => m.id === matchId && !m.winnerFighterId && m.fighters.some(f => f.id === fighterId))) return;
    if (this.picks.get(matchId) === fighterId) this.picks.delete(matchId);
    else this.picks.set(matchId, fighterId);
    if (this.picks.size < 2) this.expanded = false;
  }
  legs(snapshot) {
    return [...this.picks].flatMap(([matchId, fighterId]) => {
      const match = snapshot.matches.find(m => m.id === matchId);
      const fighter = match?.fighters.find(f => f.id === fighterId);
      return fighter ? [{ matchId, ...fighter }] : [];
    });
  }
  clear() { this.picks.clear(); this.expanded = false; }
}

export function parlayShareText(eventName, legs) {
  return `MY ${(eventName || "Liberty Fight League").toUpperCase()} FAN PARLAY\n\n${legs.map(f => `${f.name} ✓ (${f.fanOdds})`).join("\n")}\n\n${legs.length}-Leg Parlay\nCombined Fan Odds: ${combinedFanOdds(legs)}\n\nhttps://libertyfightleague.com/odds\n\nFan Picks only — no real-money betting.`;
}

export async function shareParlay(text, platform) {
  if (platform.share) {
    try { await platform.share({ text }); return "shared"; }
    catch (error) { if (error.name === "AbortError") return "cancelled"; }
  }
  if (platform.clipboard?.writeText) {
    try { await platform.clipboard.writeText(text); return "copied"; } catch { /* Offer selectable text. */ }
  }
  return "manual";
}
