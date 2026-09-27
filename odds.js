const container = document.querySelector("#matchups");
const message = document.querySelector("#page-message");
const retry = document.querySelector("#retry");
let snapshot = { event: null, matches: [] };
let busy = false;

const escapeHtml = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

async function request(options) {
  const response = await fetch("/api/fan-picks", { credentials: "same-origin", cache: "no-store", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Couldn't save your pick. Please try again.");
  return data;
}

function render() {
  const event = snapshot.event;
  document.querySelector("#event-name").textContent = event?.name || "";
  const status = document.querySelector("#voting-status");
  status.hidden = !event;
  status.textContent = event?.votingOpen ? "VOTING OPEN" : "VOTING CLOSED";
  message.hidden = Boolean(snapshot.matches.length);
  message.textContent = event ? "Matchups are on the way. Check back when the card is ready." : "Fan Picks will open when the next event is ready.";
  retry.hidden = true;
  container.innerHTML = snapshot.matches.map((match, index) => `
    <article class="match-card" data-match="${match.id}" aria-label="${escapeHtml(match.fighters.map(f => f.name).join(" versus "))}">
      <h2 class="card-header">MATCH ${index + 1}${match.boutType ? `<span class="card-detail">${escapeHtml({ gi: "Gi", no_gi: "No-Gi", john_wick: "John Wick", gauntlet: "Gauntlet" }[match.boutType] || match.boutType)}</span>` : ""}${match.weightLbs ? `<span class="card-detail">${escapeHtml(match.weightLbs)} lbs</span>` : ""}</h2>
      <div class="fighters">${match.fighters.map((fighter, side) => {
        const selected = match.selectedFighterId === fighter.id;
        return `${side ? '<span class="vs" aria-hidden="true">VS</span>' : ""}<div class="fighter${side ? " fighter-b" : ""}${selected ? " is-picked" : ""}">
          <img class="portrait${fighter.photoUrl ? "" : " is-placeholder"}" src="${escapeHtml(fighter.photoUrl || "/fighter-silhouette.svg")}" alt="${fighter.photoUrl ? escapeHtml(fighter.name) : "Photo not yet available"}" width="500" height="500" ${index > 1 ? 'loading="lazy"' : ""}>
          <h3>${escapeHtml(fighter.name)}</h3><p class="academy">${escapeHtml(fighter.academy)}</p>
          <div class="percentage">${fighter.percentage}%</div>
          <div class="bar" aria-hidden="true"><span style="width:${fighter.percentage}%"></span></div>
          <button class="pick-button" type="button" data-fighter="${fighter.id}" aria-pressed="${selected}" aria-label="Pick ${escapeHtml(fighter.name)}" ${!event.votingOpen || busy ? "disabled" : ""}>${selected ? "✓ YOUR PICK" : `Pick ${escapeHtml(fighter.firstName)}`}</button>
        </div>`;
      }).join("")}</div>
      <p class="card-error" role="alert" hidden></p>
      <p class="card-total"><strong>${match.totalPicks}</strong> fan ${match.totalPicks === 1 ? "pick" : "picks"}</p>
    </article>`).join("");
  container.querySelectorAll("img").forEach(img => img.addEventListener("error", () => { img.classList.add("is-placeholder"); img.src = "/fighter-silhouette.svg"; }, { once: true }));
}

async function load({ quiet = false } = {}) {
  if (busy) return;
  busy = true;
  try { snapshot = await request(); busy = false; render(); }
  catch (error) {
    message.hidden = false;
    message.textContent = quiet ? "Couldn't refresh the card. Showing the last loaded results." : `Couldn't load Fan Picks. ${error.message}`;
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
    container.querySelectorAll("button").forEach(item => { item.disabled = !snapshot.event?.votingOpen; });
  } finally { busy = false; }
});

retry.addEventListener("click", () => load());
document.addEventListener("visibilitychange", () => { if (!document.hidden) load({ quiet: true }); });
window.setInterval(() => { if (!document.hidden) load({ quiet: true }); }, 30_000);
load();
