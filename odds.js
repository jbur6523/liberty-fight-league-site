import { FanParlay, combinedFanOdds, parlayShareText, shareParlay } from "/src/superfight/parlay.js";

const parlay = new FanParlay();
const container = document.querySelector("#matchups");
const message = document.querySelector("#page-message");
const retry = document.querySelector("#retry");
let snapshot = { event: null, matches: [], summary: {} };
let busy = false;
const number = value => new Intl.NumberFormat("en-US").format(value);
const escapeHtml = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const signed = value => `${value > 0 ? "+" : ""}${value}`;
const icons = {
  picks: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M15 3.1a4 4 0 0 1 0 7.8"/><circle cx="9" cy="7" r="4"/>',
  favorite: '<path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3-5.7-3-5.7 3 1.1-6.3L3.2 9.7l6.4-.9Z"/>',
  close: '<path d="M4 7h16M12 3v18M7 21h10M5 7l-3 7h6L5 7Zm14 0-3 7h6l-3-7Z"/>',
  mover: '<path d="M3 20V14h4v6m3 0V9h4v11m3 0V3h4v17"/>',
};

async function request(options) {
  const response = await fetch("/api/fan-picks", { credentials: "same-origin", cache: "no-store", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Couldn't save your pick. Please try again.");
  document.querySelector("#refresh-status").textContent = "Updated just now · 30s refresh";
  return data;
}

function renderSummary() {
  const { mostPicked, biggestFavorite, closestLine, biggestMover } = snapshot.summary || {};
  const items = [
    { label: "MOST PICKED", icon: "picks", data: mostPicked, name: mostPicked?.name, value: mostPicked ? `${number(mostPicked.percentage)}%` : "—", note: mostPicked ? `${number(mostPicked.picks)} real ${mostPicked.picks === 1 ? "pick" : "picks"}` : "Waiting for picks" },
    { label: "BIGGEST FAVORITE", icon: "favorite", data: biggestFavorite, name: biggestFavorite?.name, value: biggestFavorite?.fanOdds || "PK", note: "Live Fan Line" },
    { label: "CLOSEST LINE", icon: "close", data: closestLine, name: closestLine?.names.join(" vs "), value: closestLine?.odds.join(" / ") || "—", note: "Smallest support gap" },
    { label: "BIGGEST MOVER", icon: "mover", data: biggestMover, name: biggestMover?.name, value: biggestMover ? `${signed(biggestMover.movement)} pts` : "—", note: "Support since opening" },
  ];
  const summary = document.querySelector("#summary");
  summary.hidden = !snapshot.matches.length;
  summary.innerHTML = items.map(item => {
    const tag = item.data ? "a" : "div";
    return `<${tag} class="summary-card" ${item.data ? `href="#match-${item.data.matchId}"` : ""}>
      <svg viewBox="0 0 24 24" aria-hidden="true">${icons[item.icon]}</svg>
      <div><span class="summary-label">${item.label}</span><span class="summary-name">${escapeHtml(item.name || "No leader yet")}</span><strong class="summary-value${item.icon === "mover" ? " movement-up" : ""}">${escapeHtml(item.value)}</strong><span class="summary-note">${escapeHtml(item.note)}</span></div>
    </${tag}>`;
  }).join("");
}

function render() {
  const focused = document.activeElement?.closest("[data-fighter]");
  const focusedId = focused?.dataset.fighter;
  const focusedMatch = focused?.closest("[data-match]")?.dataset.match;
  const event = snapshot.event;
  const previousLegs = parlay.picks.size;
  parlay.sync(snapshot);
  renderParlay();
  if (parlay.active && parlay.picks.size < previousLegs) document.querySelector("#parlay-progress").textContent += " Unavailable picks were removed.";
  document.querySelector("#event-name").textContent = event?.name || "Event matchups";
  const status = document.querySelector("#voting-status");
  status.hidden = !event;
  status.textContent = event?.votingOpen ? "VOTING OPEN" : "VOTING CLOSED";
  status.classList.toggle("is-closed", !event?.votingOpen);
  document.querySelector(".board-heading p").textContent = parlay.active ? "Tap lines to build your parlay. No votes are cast." : event?.votingOpen ? "Tap a line to pick your fighter." : "Explore the community's picks.";
  message.hidden = Boolean(snapshot.matches.length);
  message.textContent = event ? "Matchups are on the way. Check back when the card is ready." : "Fan Picks will open when the next event is ready.";
  retry.hidden = true;
  renderSummary();
  container.innerHTML = snapshot.matches.map((match, index) => {
    const trend = match.fighters.find(f => f.id === match.trendFighterId);
    const currentLine = trend?.fanOdds || "PK";
    return `<article class="match-card" id="match-${match.id}" data-match="${match.id}" aria-label="${escapeHtml(match.fighters.map(f => f.name).join(" versus "))}">
      <div class="card-header"><h2>${escapeHtml({ gi: "GI", no_gi: "NO-GI", john_wick: "JOHN WICK", gauntlet: "GAUNTLET" }[match.boutType] || match.boutType || "MATCHUP")} <span>${match.weightLbs == null ? "Weight TBA" : `${escapeHtml(match.weightLbs)} LBS`}</span></h2><span class="market-label">FAN ODDS</span></div>
      <div class="line-ticker"><span>Open <b>${match.openingLine}</b></span><span>Now <b>${currentLine}</b></span><span class="trend" title="Support change since the 50/50 opening">${trend ? `▲ ${escapeHtml(trend.firstName)} <b>+${trend.movement} pts</b>` : "— Even support"}</span></div>
      <div class="fighters"><span class="vs" aria-hidden="true">VS</span>${match.fighters.map(fighter => {
        const fanSelected = match.selectedFighterId === fighter.id;
        const selected = parlay.active ? parlay.picks.get(match.id) === fighter.id : fanSelected;
        return `<div class="fighter${selected ? " is-picked" : ""}">
          <div class="photo-wrap"><img class="portrait${fighter.photoUrl ? "" : " is-placeholder"}" src="${escapeHtml(fighter.photoUrl || "/fighter-silhouette.svg")}" alt="${fighter.photoUrl ? escapeHtml(fighter.name) : "Photo not yet available"}" width="500" height="500" ${index > 2 ? 'loading="lazy"' : ""}></div>
          <div class="fighter-identity"><h3>${escapeHtml(fighter.name)}</h3><p class="academy">${escapeHtml(fighter.academy)}</p></div>
          <button class="pick-button" type="button" data-fighter="${fighter.id}" aria-pressed="${selected}" aria-label="${parlay.active ? `${selected ? "Remove" : "Add"} ${escapeHtml(fighter.name)} ${selected ? "from" : "to"} parlay` : `Pick ${escapeHtml(fighter.name)}`}, Fan Odds ${fighter.fanOdds}" ${busy || (!parlay.active && !event.votingOpen) ? "disabled" : ""}><span>${escapeHtml(fighter.name)}</span><strong>${fighter.fanOdds}</strong></button>
          <div class="fighter-stats"><div class="stat-row"><strong>${fighter.percentage}%</strong><span>${number(fighter.picks)} ${fighter.picks === 1 ? "pick" : "picks"}</span></div><div class="bar" aria-hidden="true"><span style="width:${fighter.percentage}%"></span></div><div class="pick-state">${selected ? `<b class="your-pick">✓ ${parlay.active ? "PARLAY PICK" : "YOUR PICK"}</b>` : parlay.active && fanSelected ? '<span class="fighter-movement">✓ Your Fan Pick vote</span>' : `<span class="fighter-movement">${fighter.movement === 0 ? "Opened PK" : `${fighter.movement > 0 ? "▲" : "▼"} ${signed(fighter.movement)} pts since open`}</span>`}</div></div>
        </div>`;
      }).join("")}</div>
      <p class="card-error" role="alert" hidden></p>
      <div class="card-total"><span><strong>${number(match.totalPicks)}</strong> Fan ${match.totalPicks === 1 ? "Pick" : "Picks"}</span><span>${event.votingOpen ? "Pick a side. Change your mind anytime." : "Voting closed · Results remain visible"}</span></div>
    </article>`;
  }).join("");
  container.querySelectorAll("img").forEach(img => img.addEventListener("error", () => { img.classList.add("is-placeholder"); img.alt = "Photo not yet available"; img.src = "/fighter-silhouette.svg"; }, { once: true }));
  if (focusedId && focusedMatch) container.querySelector(`[data-match="${focusedMatch}"] [data-fighter="${focusedId}"]`)?.focus({ preventScroll: true });
}

async function load({ quiet = false } = {}) {
  if (busy) return;
  busy = true;
  try { snapshot = await request(); busy = false; render(); }
  catch (error) {
    message.hidden = false;
    message.textContent = quiet ? "Couldn't refresh the lines. Showing the last loaded results." : `Couldn't load Fan Picks. ${error.message}`;
    document.querySelector("#refresh-status").textContent = "Refresh paused · Try again";
    retry.hidden = false;
  } finally { busy = false; }
}

container.addEventListener("click", async event => {
  const button = event.target.closest("[data-fighter]");
  if (!button || busy) return;
  const card = button.closest("[data-match]");
  const matchId = card.dataset.match;
  const match = snapshot.matches.find(item => item.id === matchId);
  if (parlay.active) {
    parlay.toggle(matchId, button.dataset.fighter, snapshot);
    render();
    return;
  }
  if (!snapshot.event?.votingOpen) return;
  if (match.selectedFighterId === button.dataset.fighter) return;
  busy = true;
  container.querySelectorAll("button").forEach(item => { item.disabled = true; });
  button.setAttribute("aria-busy", "true");
  card.querySelector(".card-error").hidden = true;
  try {
    snapshot = await request({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: snapshot.event.id, matchId, fighterId: button.dataset.fighter }) });
    busy = false;
    render();
    container.querySelector(`[data-match="${matchId}"] [data-fighter="${button.dataset.fighter}"]`)?.focus({ preventScroll: true });
  } catch (error) {
    const errorMessage = card.querySelector(".card-error");
    errorMessage.textContent = error.message;
    errorMessage.hidden = false;
    button.removeAttribute("aria-busy");
    container.querySelectorAll("button").forEach(item => { item.disabled = !snapshot.event?.votingOpen; });
  } finally { busy = false; }
});

function renderParlay() {
  const legs = parlay.legs(snapshot);
  const start = document.querySelector("#parlay-start");
  start.disabled = !snapshot.matches.length;
  start.textContent = parlay.active ? `PARLAY · ${legs.length} PICKS` : legs.length ? `BUILD A FAN PARLAY (${legs.length})` : "+ BUILD A FAN PARLAY";
  start.setAttribute("aria-pressed", String(parlay.active));
  document.querySelector("#parlay-mode").hidden = !parlay.active;
  const progress = `${legs.length} ${legs.length === 1 ? "pick" : "picks"} selected. ${legs.length < 2 ? "Select at least 2 to see combined odds." : `Combined Fan Odds: ${combinedFanOdds(legs)}.`}`;
  if (document.querySelector("#parlay-progress").textContent !== progress) document.querySelector("#parlay-progress").textContent = progress;
  const slip = document.querySelector("#parlay-slip");
  slip.hidden = !parlay.active || legs.length < 2;
  document.querySelector("#parlay-count").textContent = `${legs.length}-LEG PARLAY`;
  document.querySelector("#parlay-odds").textContent = combinedFanOdds(legs) || "—";
  slip.classList.toggle("many-legs", legs.length >= 5);
  document.querySelector("#parlay-expand").setAttribute("aria-expanded", String(parlay.expanded));
  document.querySelector("#parlay-chevron").textContent = parlay.expanded ? "⌄" : "⌃";
  document.querySelector("#parlay-details").hidden = !parlay.expanded;
  const focusedRemove = document.activeElement?.dataset.removeLeg;
  document.querySelector("#parlay-legs").innerHTML = legs.map(leg => `<li><span>${escapeHtml(leg.name)} <small>${escapeHtml(leg.academy)}</small></span><strong>${escapeHtml(leg.fanOdds)}</strong><button type="button" data-remove-leg="${leg.matchId}" aria-label="Remove ${escapeHtml(leg.name)} from parlay">×</button></li>`).join("");
  if (focusedRemove) (document.querySelector(`[data-remove-leg="${focusedRemove}"]`) || document.querySelector(legs.length >= 2 ? "#parlay-expand" : "#parlay-exit")).focus({ preventScroll: true });
  if (!document.querySelector("#parlay-share-fallback").hidden) document.querySelector("#parlay-share-text").value = parlayShareText(snapshot.event?.name, legs);
  document.documentElement.style.setProperty("--parlay-space", slip.hidden ? "0px" : `${slip.offsetHeight + 16}px`);
}

document.querySelector("#parlay-start").addEventListener("click", () => {
  if (busy) return;
  parlay.active = true;
  render();
  document.querySelector("#parlay-mode").scrollIntoView({ block: "start" });
  container.querySelector("button")?.focus({ preventScroll: true });
});
function exitParlay() {
  parlay.active = false;
  parlay.expanded = false;
  render();
  container.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
}
document.querySelector("#parlay-exit").addEventListener("click", exitParlay);
document.querySelector("#parlay-close").addEventListener("click", exitParlay);
document.querySelector("#parlay-expand").addEventListener("click", () => { parlay.expanded = !parlay.expanded; renderParlay(); });
document.querySelector("#parlay-legs").addEventListener("click", event => {
  const button = event.target.closest("[data-remove-leg]");
  if (!button) return;
  parlay.picks.delete(button.dataset.removeLeg);
  render();
  (parlay.picks.size >= 2 ? document.querySelector("#parlay-expand") : document.querySelector("#parlay-exit")).focus({ preventScroll: true });
});
document.querySelector("#parlay-clear").addEventListener("click", () => {
  parlay.clear();
  render();
  document.querySelector("#parlay-progress").textContent = "Parlay cleared. Select at least 2 picks to start again.";
  document.querySelector("#parlay-exit").focus({ preventScroll: true });
});
document.querySelector("#parlay-share").addEventListener("click", async () => {
  const button = document.querySelector("#parlay-share");
  const legs = parlay.legs(snapshot);
  if (legs.length < 2 || button.disabled) return;
  button.disabled = true;
  const text = parlayShareText(snapshot.event?.name, legs);
  const result = await shareParlay(text, navigator);
  button.disabled = false;
  document.querySelector("#parlay-share-status").textContent = { shared: "Parlay shared.", copied: "Parlay copied. Paste it into your message.", cancelled: "", manual: "Select and copy the text below to share your parlay." }[result];
  document.querySelector("#parlay-share-fallback").hidden = result !== "manual";
  if (result === "manual") {
    const field = document.querySelector("#parlay-share-text");
    field.value = text;
    field.focus();
    field.select();
  }
});
document.querySelector("#parlay-slip").addEventListener("keydown", event => {
  if (event.key === "Escape" && parlay.expanded) { parlay.expanded = false; renderParlay(); document.querySelector("#parlay-expand").focus(); }
});
new ResizeObserver(() => {
  const slip = document.querySelector("#parlay-slip");
  document.documentElement.style.setProperty("--parlay-space", slip.hidden ? "0px" : `${slip.offsetHeight + 16}px`);
}).observe(document.querySelector("#parlay-slip"));
retry.addEventListener("click", () => load());
document.addEventListener("visibilitychange", () => { if (!document.hidden) load({ quiet: true }); });
window.setInterval(() => { if (!document.hidden) load({ quiet: true }); }, 30_000);
load();
