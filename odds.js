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
  document.querySelector("#event-name").textContent = event?.name || "Event matchups";
  const status = document.querySelector("#voting-status");
  status.hidden = !event;
  status.textContent = event?.votingOpen ? "VOTING OPEN" : "VOTING CLOSED";
  status.classList.toggle("is-closed", !event?.votingOpen);
  document.querySelector(".board-heading p").textContent = event?.votingOpen ? "Tap a line to pick your fighter." : "Explore the community's picks.";
  document.querySelector("#refresh-status").textContent = "Updated just now · 30s refresh";
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
        const selected = match.selectedFighterId === fighter.id;
        return `<div class="fighter${selected ? " is-picked" : ""}">
          <div class="photo-wrap"><img class="portrait${fighter.photoUrl ? "" : " is-placeholder"}" src="${escapeHtml(fighter.photoUrl || "/fighter-silhouette.svg")}" alt="${fighter.photoUrl ? escapeHtml(fighter.name) : "Photo not yet available"}" width="500" height="500" ${index > 2 ? 'loading="lazy"' : ""}></div>
          <div class="fighter-identity"><h3>${escapeHtml(fighter.name)}</h3><p class="academy">${escapeHtml(fighter.academy)}</p></div>
          <button class="pick-button" type="button" data-fighter="${fighter.id}" aria-pressed="${selected}" aria-label="Pick ${escapeHtml(fighter.name)}, Fan Odds ${fighter.fanOdds}" ${!event.votingOpen || busy ? "disabled" : ""}><span>${escapeHtml(fighter.name)}</span><strong>${fighter.fanOdds}</strong></button>
          <div class="fighter-stats"><div class="stat-row"><strong>${fighter.percentage}%</strong><span>${number(fighter.picks)} ${fighter.picks === 1 ? "pick" : "picks"}</span></div><div class="bar" aria-hidden="true"><span style="width:${fighter.percentage}%"></span></div><div class="pick-state">${selected ? '<b class="your-pick">✓ YOUR PICK</b>' : `<span class="fighter-movement">${fighter.movement === 0 ? "Opened PK" : `${fighter.movement > 0 ? "▲" : "▼"} ${signed(fighter.movement)} pts since open`}</span>`}</div></div>
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
  if (!button || busy || !snapshot.event?.votingOpen) return;
  const card = button.closest("[data-match]");
  const matchId = card.dataset.match;
  const match = snapshot.matches.find(item => item.id === matchId);
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
retry.addEventListener("click", () => load());
document.addEventListener("visibilitychange", () => { if (!document.hidden) load({ quiet: true }); });
window.setInterval(() => { if (!document.hidden) load({ quiet: true }); }, 30_000);
load();
