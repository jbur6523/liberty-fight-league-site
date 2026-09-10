import { US_STATES } from "/src/superfight/us-states.js";

for (const [code, name] of Object.entries(US_STATES)) {
  document.querySelector("#add-state").add(new Option(name, code));
}

const state = {
  events: [],
  eventId: null,
  competitors: [],
  matches: [],
  offers: [],
  offerId: null,
  sort: "suggested",
  tab: "unmatched",
  selected: null,
  pairing: null,
  matchAgreement: null,
};

const elements = {
  loginPanel: document.querySelector("#login-panel"),
  workspace: document.querySelector("#workspace"),
  account: document.querySelector("#admin-account"),
  email: document.querySelector("#admin-email"),
  eventSelect: document.querySelector("#event-select"),
  unmatched: document.querySelector("#unmatched-content"),
  matched: document.querySelector("#matched-content"),
  matchbar: document.querySelector("#matchbar"),
  toast: document.querySelector("#admin-toast"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function label(value) {
  if (!value) return "—";
  const labels = {
    mens: "Men's",
    womens: "Women's",
    gi: "Gi",
    no_gi: "No-Gi",
    john_wick: "John Wick",
  };
  if (labels[value]) return labels[value];
  return `${value[0].toUpperCase()}${value.slice(1).replaceAll("_", " ")}`;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2200);
}

function showLogin() {
  elements.loginPanel.hidden = false;
  elements.workspace.hidden = true;
  elements.account.hidden = true;
}

function showWorkspace(email) {
  elements.loginPanel.hidden = true;
  elements.workspace.hidden = false;
  elements.account.hidden = false;
  elements.email.textContent = email;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  let payload = {};
  try { payload = await response.json(); } catch { /* empty response */ }
  if (!response.ok) {
    if (response.status === 401) showLogin();
    throw new Error(payload.message || "The request could not be completed.");
  }
  return payload;
}

async function copyText(value, message = "Copied") {
  await navigator.clipboard.writeText(new URL(value, window.location.origin).toString());
  showToast(message);
}

function currentEvent() {
  return state.events.find((event) => event.id === state.eventId) ?? null;
}

function activeWeightOptions() {
  return (currentEvent()?.weightOptions ?? []).filter((option) => option.active !== false);
}

function shortWeightLabel(option) {
  return String(option.label).split(" — ")[0];
}

function weightSummary(competitor, showLimits = false) {
  const options = competitor.weightOptions ?? [];
  if (options.length === 0) return '<span class="admin-muted">—</span>';
  const display = options.map((option) => showLimits
    ? String(option.label).replace(/^(.+?) — (.+)$/, "$1 ($2)")
    : shortWeightLabel(option)).join(", ");
  const full = options.map((option) => option.label).join("; ");
  return `<span class="admin-weight-summary" title="${escapeHtml(full)}">${escapeHtml(display)}</span>`;
}

function weightChecklist(options, selectedIds = [], name = "weightOptionIds") {
  const selected = new Set(selectedIds);
  if (options.length === 0) return '<span class="admin-muted">No event weight classes configured.</span>';
  return options.map((option) => `
    <label class="admin-check-choice">
      <input type="checkbox" name="${name}" value="${option.id}"${selected.has(option.id) ? " checked" : ""}>
      <span>${escapeHtml(option.label)}</span>
    </label>`).join("");
}

function formatPreferencesConflict(leftPreference, rightPreference) {
  return Boolean(
    leftPreference
    && rightPreference
    && leftPreference !== "both"
    && rightPreference !== "both"
    && leftPreference !== rightPreference
  );
}

function updateMatchSubmitAvailability() {
  if (!state.matchAgreement) return;
  const weightReady = state.matchAgreement.hasSharedWeight
    ? Boolean(document.querySelector("#match-weight-option").value)
    : Number(document.querySelector("#match-agreed-weight").value) > 0;
  const boutTypeReady = Boolean(document.querySelector("#match-bout-type").value);
  const formatConfirmed = !state.matchAgreement.formatConflict
    || document.querySelector("#match-format-confirmed").checked;
  document.querySelector("#match-submit").disabled = !(weightReady && boutTypeReady && formatConfirmed);
}

function eventOptions() {
  if (state.events.length === 0) {
    elements.eventSelect.innerHTML = '<option value="">No events configured</option>';
    elements.eventSelect.disabled = true;
    document.querySelector("#quick-add").disabled = true;
    return;
  }

  elements.eventSelect.disabled = false;
  document.querySelector("#quick-add").disabled = false;
  elements.eventSelect.innerHTML = state.events
    .map((event) => `<option value="${event.id}"${event.id === state.eventId ? " selected" : ""}>${escapeHtml(event.name)}</option>`)
    .join("");
}

async function loadEvents(preferredEventId = state.eventId) {
  const payload = await api("/api/superfight-admin-events");
  state.events = payload.events;
  state.eventId = state.events.some((event) => event.id === preferredEventId)
    ? preferredEventId
    : state.events[0]?.id ?? null;
  eventOptions();
  await loadActiveView();
}

function emptyState(title, copy, action = "") {
  return `<div class="admin-empty"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(copy)}</p>${action}</div>`;
}

function socialCell(competitor) {
  if (!competitor.instagramHandle) return '<span class="admin-muted">—</span>';
  return `<div class="admin-social"><a href="${escapeHtml(competitor.instagramUrl)}" target="_blank" rel="noopener">@${escapeHtml(competitor.instagramHandle)}</a><button class="admin-button ghost" type="button" data-copy="${escapeHtml(competitor.instagramHandle)}" data-raw-copy aria-label="Copy Instagram">Copy</button></div>`;
}

function unmatchedTableName(competitor) {
  const parts = competitor.name.trim().split(/\s+/);
  const shortenedName = `${Array.from(parts[0])[0]}. ${parts.at(-1)}`;
  return `${escapeHtml(shortenedName)}${competitor.genderDivision === "womens" ? " 💕" : ""} (${competitor.age ?? "—"})`;
}

function unmatchedBeltClass(belt) {
  return new Set(["blue", "purple", "brown", "black"]).has(belt) ? ` belt-${belt}` : "";
}

async function deleteUnmatchedCompetitor(competitorId, button) {
  const competitor = state.competitors.find((item) => item.id === competitorId);
  if (!competitor) return;
  const confirmed = window.confirm(
    `Delete ${competitor.name} from matchmaking?\n\nThey will disappear from this event's fighter list.`,
  );
  if (!confirmed) return;

  button.disabled = true;
  try {
    await api("/api/superfight-admin-competitor", {
      method: "POST",
      body: JSON.stringify({ action: "withdraw", competitorId }),
    });
    if (state.selected?.id === competitorId) clearSelection();
    showToast(`${competitor.name} deleted`);
    await loadUnmatched();
  } catch (error) {
    button.disabled = false;
    showToast(error.message);
  }
}

function bindUnmatchedNameActions() {
  elements.unmatched.querySelectorAll("[data-unmatched-name]").forEach((button) => {
    let detailTimer;
    let lastTouchAt = 0;

    button.addEventListener("click", (event) => {
      if (event.detail > 1) return;
      detailTimer = window.setTimeout(() => openDetail(button.dataset.unmatchedName), 400);
    });
    button.addEventListener("dblclick", (event) => {
      event.preventDefault();
      window.clearTimeout(detailTimer);
      selectCompetitor(button.dataset.unmatchedName);
    });
    button.addEventListener("touchend", (event) => {
      const touchedAt = Date.now();
      if (touchedAt - lastTouchAt < 350) {
        event.preventDefault();
        window.clearTimeout(detailTimer);
        lastTouchAt = 0;
        selectCompetitor(button.dataset.unmatchedName);
        return;
      }
      lastTouchAt = touchedAt;
    }, { passive: false });
  });
}

const poolLabels = { standard: "Unmatched", john_wick: "John Wick", gauntlet: "Gauntlet" };

function competitorActions(competitor) {
  const pool = competitor.matchmakingPool ?? "standard";
  return `<button class="admin-overflow-button" type="button" popovertarget="actions-${competitor.id}" aria-label="Actions for ${escapeHtml(competitor.name)}" title="Competitor actions">⋮</button>
    <div class="admin-competitor-menu" id="actions-${competitor.id}" popover>
      <button class="admin-button ghost" type="button" data-share-profile="${competitor.id}">Share Profile</button>
      <hr>
      <strong>Move to…</strong>
      ${Object.entries(poolLabels).filter(([key]) => key !== pool).map(([key, name]) => `<button class="admin-button ghost" type="button" data-move-competitor="${competitor.id}" data-pool="${key}">${name}</button>`).join("")}
      <hr>
      <button class="admin-button danger" type="button" data-delete-competitor="${competitor.id}">Delete competitor</button>
    </div>`;
}

async function moveCompetitor(competitorId, pool, button) {
  const competitor = state.competitors.find((item) => item.id === competitorId);
  if (!competitor) return;
  const menu = button.closest("[popover]");
  menu.querySelectorAll("button").forEach((item) => { item.disabled = true; });
  try {
    await api("/api/superfight-admin-competitor", {
      method: "POST",
      body: JSON.stringify({ action: "move_pool", competitorId, pool }),
    });
    competitor.matchmakingPool = pool;
    menu.hidePopover();
    clearSelection();
    showToast(`${competitor.name} moved to ${poolLabels[pool]}`);
    await loadActiveView();
  } catch (error) {
    menu.querySelectorAll("button").forEach((item) => { item.disabled = false; });
    showToast(error.message);
  }
}

function renderUnmatched() {
  for (const pool of Object.keys(poolLabels)) {
    const count = state.competitors.filter((item) => (item.matchmakingPool ?? "standard") === pool).length;
    document.querySelector(`#${pool === "standard" ? "unmatched" : pool}-count`).textContent = `(${count})`;
  }
  const pool = state.tab === "john_wick" || state.tab === "gauntlet" ? state.tab : "standard";
  const competitors = state.competitors.filter((item) => (item.matchmakingPool ?? "standard") === pool);
  if (!state.eventId) {
    elements.unmatched.innerHTML = emptyState(
      "Create the first event",
      "Event details and weight choices stay configurable.",
      '<button class="admin-button" type="button" data-open-event>Create event</button>',
    );
    elements.unmatched.querySelector("[data-open-event]")?.addEventListener("click", () => openEventDialog(true));
    return;
  }
  if (competitors.length === 0) {
    elements.unmatched.innerHTML = pool === "standard"
      ? emptyState("No unmatched competitors", "Quick-add a competitor or share the public application link.")
      : emptyState(`No competitors in ${poolLabels[pool]}`, "Use a competitor’s three-dot menu to move them into this pool.");
    return;
  }

  elements.unmatched.innerHTML = `
    <div class="admin-table-wrap"><table class="admin-table admin-unmatched-table">
      <thead><tr><th>Name</th><th>Gi / No-Gi / Both</th><th>Weight</th><th>Instagram</th></tr></thead>
      <tbody>${competitors.map((competitor) => `
        <tr class="${state.selected?.id === competitor.id ? "is-selected" : ""}">
          <td><div class="admin-name-actions"><button class="admin-name-button${unmatchedBeltClass(competitor.belt)}" type="button" data-unmatched-name="${competitor.id}" title="Open details; double-click or double-tap to select">${unmatchedTableName(competitor)}</button>${competitorActions(competitor)}</div><div class="admin-muted">${gymWithDistance(competitor)}</div><button class="admin-button admin-inline-select ${state.selected?.id === competitor.id ? "secondary" : ""}" type="button" data-select="${competitor.id}" aria-pressed="${state.selected?.id === competitor.id}">${state.selected?.id === competitor.id ? "Selected" : state.selected ? "Match with" : "Select"}</button></td>
          <td>${label(competitor.grapplingPreference)}</td>
          <td>${weightSummary(competitor, true)}</td>
          <td>${socialCell(competitor)}</td>
        </tr>`).join("")}</tbody>
    </table></div>`;

  bindTableActions(elements.unmatched);
  bindUnmatchedNameActions();
  elements.unmatched.querySelectorAll("[data-share-profile]").forEach((button) => {
    button.addEventListener("click", async () => {
      const competitor = state.competitors.find(item => item.id === button.dataset.shareProfile);
      if (!competitor) return;
      button.closest("[popover]").hidePopover();
      const linkInput = document.querySelector("#share-profile-link");
      const copyButton = document.querySelector("#share-profile-copy");
      const preview = document.querySelector("#share-profile-preview");
      linkInput.value = "";
      copyButton.disabled = true;
      preview.hidden = true;
      preview.removeAttribute("href");
      const message = document.querySelector("#share-profile-message");
      const dialog = document.querySelector("#share-profile-dialog");
      const requestId = dialog.shareRequestId = Symbol();
      message.textContent = "Creating a short profile link…";
      dialog.showModal();
      try {
        const result = await api("/api/superfight-profile", {
          method: "POST", body: JSON.stringify({ competitorId: competitor.id }),
        });
        if (dialog.shareRequestId !== requestId || !dialog.open) return;
        linkInput.value = new URL(result.path, window.location.origin).href;
        preview.href = linkInput.value;
        preview.hidden = false;
        copyButton.disabled = false;
        message.textContent = "Your short link is ready. Tap Copy to share it.";
        copyButton.focus();
      } catch (error) {
        if (dialog.shareRequestId === requestId && dialog.open) message.textContent = error.message + " Close and try again.";
      }
    });
  });
  elements.unmatched.querySelectorAll("[data-move-competitor]").forEach((button) => {
    button.addEventListener("click", () => moveCompetitor(button.dataset.moveCompetitor, button.dataset.pool, button));
  });
  elements.unmatched.querySelectorAll("[data-select]").forEach((button) => {
    button.addEventListener("click", () => selectCompetitor(button.dataset.select));
  });
  elements.unmatched.querySelectorAll("[data-delete-competitor]").forEach((button) => {
    button.addEventListener("click", () => deleteUnmatchedCompetitor(button.dataset.deleteCompetitor, button));
  });
}

function gymWithDistance(competitor) {
  const gym = escapeHtml(competitor.gym || "No gym");
  if (!Number.isFinite(competitor.distanceFromSfMiles)) return gym;
  const location = [competitor.city, competitor.state].filter(Boolean).join(", ");
  return `${gym} - <span title="${escapeHtml(`Approximate straight-line distance from ${location || "submitted city"} to San Francisco`)}">${Math.round(competitor.distanceFromSfMiles)}mi</span>`;
}

document.querySelector("#share-profile-copy").addEventListener("click", async () => {
  const linkInput = document.querySelector("#share-profile-link");
  const message = document.querySelector("#share-profile-message");
  if (!linkInput.value) return;
  try {
    await copyText(linkInput.value, "Profile link copied");
    message.textContent = "Link copied. It’s ready to paste and share.";
  } catch {
    linkInput.focus();
    linkInput.select();
    message.textContent = "Select and copy the link below to share this profile.";
  }
});

function confirmationBadge(summary) {
  const details = {
    awaiting_confirmation: ["Awaiting confirmation", ""],
    fighter_a_accepted: ["Fighter A accepted", "good"],
    fighter_b_accepted: ["Fighter B accepted", "good"],
    both_accepted: ["Both accepted", "good"],
    all_accepted: ["All accepted", "good"],
    partially_accepted: ["Partially accepted", "good"],
    declined: ["Declined", "bad"],
  }[summary] ?? ["Awaiting confirmation", ""];
  return `<span class="admin-badge ${details[1]}">${details[0]}</span>`;
}

function matchFighterCell(fighter) {
  return `<button class="admin-name-button" type="button" data-detail="${fighter.id}">${escapeHtml(fighter.name)}</button><div class="admin-muted">${label(fighter.belt)} · ${gymWithDistance(fighter)}</div>`;
}

function matchLinks(fighter) {
  return `<div class="admin-controls"><button class="admin-button ghost" type="button" data-copy-path="${fighter.confirmationPath}">Copy confirmation</button>${fighter.instagramHandle ? `<button class="admin-button ghost" type="button" data-copy="${escapeHtml(fighter.instagramHandle)}" data-raw-copy>Copy @${escapeHtml(fighter.instagramHandle)}</button>` : ""}</div>`;
}

function renderMatched() {
  document.querySelector("#matched-count").textContent = `(${state.matches.length})`;
  if (state.matches.length === 0) {
    elements.matched.innerHTML = emptyState("No active matchups", "Create a matchup from the Unmatched workspace.");
    return;
  }

  elements.matched.innerHTML = `
    <div class="admin-table-wrap"><table class="admin-table">
      <thead><tr><th>Fighter A</th><th>Other competitors</th><th>Bout type</th><th>Match weight</th><th>Confirmation</th><th>Quick actions</th></tr></thead>
      <tbody>${state.matches.map((match) => `
        <tr>
          <td>${matchFighterCell(match.fighterA)}${matchLinks(match.fighterA)}</td>
          <td>${[match.fighterB, ...(match.extraFighters ?? [])].map(fighter => `<div class="admin-match-participant">${matchFighterCell(fighter)}${matchLinks(fighter)}</div>`).join("")}</td>
          <td>${label(match.boutType)}</td>
          <td>${escapeHtml(match.weightOption?.label ?? (match.weightLbs === null ? "—" : `${match.weightLbs} lb`))}</td>
          <td>${confirmationBadge(match.confirmation.summary)}</td>
          <td><button class="admin-button danger" type="button" data-unmatch="${match.id}">Unmatch</button></td>
        </tr>`).join("")}</tbody>
    </table></div>`;

  bindTableActions(elements.matched);
  elements.matched.querySelectorAll("[data-unmatch]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm("Unmatch these competitors? Their records and response history will be preserved.")) return;
      button.disabled = true;
      try {
        await api("/api/superfight-admin-matches", {
          method: "POST",
          body: JSON.stringify({ action: "unmatch", matchId: button.dataset.unmatch }),
        });
        showToast("Competitors returned to their matchmaking pools");
        await loadActiveView();
      } catch (error) {
        showToast(error.message);
        button.disabled = false;
      }
    });
  });
}

function bindTableActions(container) {
  container.querySelectorAll("[data-detail]").forEach((button) => {
    button.addEventListener("click", () => openDetail(button.dataset.detail));
  });
  container.querySelectorAll("[data-raw-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      await navigator.clipboard.writeText(`@${button.dataset.copy}`);
      showToast("Instagram copied");
    });
  });
  container.querySelectorAll("[data-copy-path]").forEach((button) => {
    button.addEventListener("click", () => copyText(button.dataset.copyPath, "Confirmation link copied"));
  });
}

async function loadUnmatched() {
  const requestId = loadUnmatched.requestId = (loadUnmatched.requestId ?? 0) + 1;
  if (!state.eventId) {
    state.competitors = [];
    renderUnmatched();
    return;
  }
  const payload = await api(`/api/superfight-admin-competitors?eventId=${state.eventId}&sort=${state.sort}`);
  if (requestId !== loadUnmatched.requestId) return;
  state.competitors = payload.competitors;
  renderUnmatched();
}

async function loadMatches() {
  const requestId = loadMatches.requestId = (loadMatches.requestId ?? 0) + 1;
  if (!state.eventId) {
    state.matches = [];
    renderMatched();
    return;
  }
  const payload = await api(`/api/superfight-admin-matches?eventId=${state.eventId}`);
  if (requestId !== loadMatches.requestId) return;
  state.matches = payload.matches;
  renderMatched();
}

async function loadActiveView() {
  await Promise.all([loadUnmatched(), loadMatches(), loadOffers()]);
}

async function loadOffers() {
  const requestId = loadOffers.requestId = (loadOffers.requestId ?? 0) + 1;
  const payload = state.eventId ? await api(`/api/superfight-admin-offers?eventId=${state.eventId}`) : { offers: [] };
  if (requestId !== loadOffers.requestId) return;
  state.offers = payload.offers;
  document.querySelector("#offers-count").textContent = `(${state.offers.length})`;
  const container = document.querySelector("#offers-content");
  if (!state.offers.length) {
    container.innerHTML = emptyState("No pending offers", "New offers from Available Matches will appear here.");
    return;
  }
  const targets = [...new Set(state.offers.map((offer) => offer.target.id))];
  container.innerHTML = targets.map((targetId) => {
    const offers = state.offers.filter((offer) => offer.target.id === targetId);
    const target = offers[0].target;
    return `<section class="admin-offer-group"><h2>Offers for <button class="admin-name-button${unmatchedBeltClass(target.belt)}" type="button" data-detail="${target.id}">${escapeHtml(target.name)}</button></h2>
      <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Offering competitor</th><th>Belt / weight / gym</th><th>Match type</th><th>Actions</th></tr></thead><tbody>
      ${offers.map((offer) => `<tr><td><button class="admin-name-button${unmatchedBeltClass(offer.offering.belt)}" type="button" data-detail="${offer.offering.id}">${escapeHtml(offer.offering.name)}</button><div class="admin-muted">@${escapeHtml(offer.offering.instagramHandle || "Not entered")}</div></td>
        <td>${escapeHtml(label(offer.offering.belt))} · ${escapeHtml(offer.weightLbs ?? offer.offering.weightLbs ?? "—")} lb<div class="admin-muted">${gymWithDistance(offer.offering)}</div></td>
        <td>${label(offer.boutType)}${!offer.canMatch ? '<div class="admin-muted">Competitor no longer available</div>' : ""}</td>
        <td><button class="admin-overflow-button" type="button" popovertarget="offer-${offer.id}" aria-label="Offer actions for ${escapeHtml(offer.offering.name)}">⋮</button>
          <div class="admin-competitor-menu" id="offer-${offer.id}" popover><button class="admin-button" type="button" data-make-offer="${offer.id}"${offer.canMatch ? "" : " disabled"}>Make Match</button><hr><button class="admin-button danger" type="button" data-deny-offer="${offer.id}">Deny Offer</button></div>
          ${offer.notificationState !== "sent" ? `<div><button class="admin-button ghost" type="button" data-retry-offer="${offer.id}">Retry email notification</button></div>` : ""}</td></tr>`).join("")}
      </tbody></table></div></section>`;
  }).join("");
  bindTableActions(container);
  container.querySelectorAll("[data-make-offer]").forEach((button) => button.addEventListener("click", () => {
    const offer = state.offers.find((item) => item.id === button.dataset.makeOffer);
    button.closest("[popover]").hidePopover();
    openMatchDialog(offer.target, offer.offering, offer.id);
    document.querySelector("#match-bout-type").value = offer.boutType;
    updateMatchSubmitAvailability();
  }));
  for (const [attribute, action] of [["data-deny-offer", "deny"], ["data-retry-offer", "retry_notification"]]) {
    container.querySelectorAll(`[${attribute}]`).forEach((button) => button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await api("/api/superfight-admin-offers", { method: "POST", body: JSON.stringify({ action, offerId: button.getAttribute(attribute) }) });
        showToast(action === "deny" ? "Offer denied. Competitor registrations are preserved." : "Email notification sent");
        await loadActiveView();
      } catch (error) { button.disabled = false; showToast(error.message); }
    }));
  }
}

function clearSelection() {
  state.offerId = null;
  state.selected = null;
  state.pairing = null;
  state.matchAgreement = null;
  elements.matchbar.hidden = true;
  renderUnmatched();
}

function selectCompetitor(competitorId) {
  const competitor = state.competitors.find((item) => item.id === competitorId);
  if (!state.selected) {
    state.selected = competitor;
    elements.matchbar.hidden = false;
    document.querySelector("#matchbar-name").textContent = competitor.name;
    renderUnmatched();
    return;
  }
  if (state.selected.id === competitorId) {
    clearSelection();
    return;
  }

  openMatchDialog(state.selected, competitor);
}

function openMatchDialog(first, second, offerId = null) {
  state.offerId = offerId;
  state.pairing = [first, second];
  document.querySelector("#match-bout-type").value = "";
  document.querySelector("#gauntlet-fields").hidden = true;
  for (const id of ["#match-fighter-c", "#match-fighter-d"]) document.querySelector(id).value = "";
  refreshMatchAgreement();
  document.querySelector("#match-dialog").showModal();
}

function refreshMatchAgreement() {
  document.querySelector("#match-pair").innerHTML = state.pairing.map((fighter, index) => `
    <div class="admin-detail"><strong>Fighter ${["A", "B", "C", "D"][index]}</strong>${escapeHtml(fighter.name)}<br><span class="admin-muted">${label(fighter.genderDivision)} · ${fighter.age ?? "No age"} · ${label(fighter.grapplingPreference)} · ${label(fighter.belt)}</span><br>${weightSummary(fighter)}</div>
  `).join("");
  const sharedWeights = activeWeightOptions().filter(option => state.pairing.every(fighter =>
    (fighter.weightOptions ?? []).some(weight => weight.id === option.id)));
  const hasSharedWeight = sharedWeights.length > 0;
  const formatConflict = state.pairing.some(left => state.pairing.some(right =>
    formatPreferencesConflict(left.grapplingPreference, right.grapplingPreference)));
  state.matchAgreement = { hasSharedWeight, formatConflict };
  document.querySelector("#match-weight-option").innerHTML = [
    '<option value="">Choose a shared weight class</option>',
    ...sharedWeights.map((option) => `<option value="${option.id}">${escapeHtml(option.label)}</option>`),
  ].join("");
  document.querySelector("#match-weight-class-field").hidden = !hasSharedWeight;
  document.querySelector("#match-weight-option").required = hasSharedWeight;
  document.querySelector("#match-manual-weight-field").hidden = hasSharedWeight;
  document.querySelector("#match-agreed-weight").required = !hasSharedWeight;
  document.querySelector("#match-agreed-weight").value = "";
  document.querySelector("#match-format-confirmation").hidden = !formatConflict;
  document.querySelector("#match-format-confirmed").checked = false;
  const warnings = [];
  if (!hasSharedWeight) {
    warnings.push("These competitors' application weight preferences do not overlap. Enter the agreed match weight.");
  }
  if (formatConflict) {
    warnings.push("These competitors selected different format preferences. Confirm the agreed bout type.");
  }
  const warning = document.querySelector("#match-warning");
  warning.hidden = warnings.length === 0;
  warning.innerHTML = warnings.map((message) => `<p>${escapeHtml(message)}</p>`).join("");
  document.querySelector("#match-error").textContent = "";
  updateMatchSubmitAvailability();
}

async function openDetail(competitorId) {
  const dialog = document.querySelector("#detail-dialog");
  const target = document.querySelector("#detail-content");
  target.innerHTML = '<p class="admin-muted">Loading competitor…</p>';
  dialog.showModal();
  try {
    const { competitor } = await api(`/api/superfight-admin-competitor?id=${competitorId}`);
    const mergeOptions = state.competitors
      .filter((item) => item.id !== competitor.id)
      .map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`)
      .join("");
    const fighterResponse = competitor.match?.confirmations
      .find((item) => item.competitor_id === competitor.id)?.response;
    const opponentResponse = competitor.match?.confirmations
      .find((item) => item.competitor_id !== competitor.id)?.response;
    target.innerHTML = `
      <div class="admin-detail-grid">
        <div class="admin-detail"><strong>Event</strong>${escapeHtml(currentEvent()?.name || "—")}</div>
        <div class="admin-detail"><strong>Source</strong>${label(competitor.source)}</div>
        <div class="admin-detail"><strong>Application date</strong>${competitor.applicationSubmittedAt ? new Date(competitor.applicationSubmittedAt).toLocaleString() : "Quick add"}</div>
        <div class="admin-detail"><strong>Match status</strong>${competitor.match ? `Matched with ${escapeHtml((competitor.match.opponents ?? [competitor.match.opponent]).map(opponent => opponent.full_name).join(", "))}` : "Unmatched"}</div>
        ${competitor.match ? `<div class="admin-detail"><strong>Final bout type</strong>${label(competitor.match.boutType)}</div>` : ""}
        ${competitor.match ? `<div class="admin-detail"><strong>Final match weight</strong>${escapeHtml(competitor.match.weightOption?.label ?? (competitor.match.weightLbs === null ? "—" : `${competitor.match.weightLbs} lb`))}</div>` : ""}
        ${competitor.match ? `<div class="admin-detail"><strong>Fighter confirmation</strong>${label(fighterResponse || "awaiting")}</div><div class="admin-detail"><strong>Opponent confirmation</strong>${label(opponentResponse || "awaiting")}</div>` : ""}
      </div>
      <form id="detail-form" style="margin-top:20px">
        <div class="admin-form-grid">
          <div class="admin-field full"><label>Name</label><input class="admin-input" name="fullName" value="${escapeHtml(competitor.name)}" required></div>
          <div class="admin-field"><label>Cell Phone</label><input class="admin-input" name="phone" value="${escapeHtml(competitor.phone)}"></div>
          <div class="admin-field"><label>Email</label><input class="admin-input" name="email" type="email" value="${escapeHtml(competitor.email)}"></div>
          <div class="admin-field"><label>Preferred Contact</label><select class="admin-select" name="preferredContactMethod"><option value="">None</option>${["instagram","cell_phone"].map((value) => `<option value="${value}"${competitor.preferredContactMethod === value ? " selected" : ""}>${label(value)}</option>`).join("")}</select></div>
          <div class="admin-field"><label>Gender / division</label><select class="admin-select" name="genderDivision"><option value="">Not entered</option>${["mens","womens"].map((value) => `<option value="${value}"${competitor.genderDivision === value ? " selected" : ""}>${label(value)} division</option>`).join("")}</select></div>
          <div class="admin-field"><label>Age</label><input class="admin-input" name="age" type="number" min="1" max="120" step="1" value="${competitor.age ?? ""}"></div>
          <div class="admin-field"><label>Gi / No-Gi preference</label><select class="admin-select" name="grapplingPreference"><option value="">Not entered</option>${["gi","no_gi","both"].map((value) => `<option value="${value}"${competitor.grapplingPreference === value ? " selected" : ""}>${label(value)}</option>`).join("")}</select></div>
          <div class="admin-field"><label>Belt</label><select class="admin-select" name="belt"><option value="">Not entered</option>${["blue","purple","brown","black"].map((beltValue) => `<option value="${beltValue}"${competitor.belt === beltValue ? " selected" : ""}>${label(beltValue)}</option>`).join("")}</select></div>
          <div class="admin-field full"><span class="admin-field-label">Acceptable weight classes</span><div class="admin-check-grid">${weightChecklist(activeWeightOptions(), competitor.weightOptions?.map((option) => option.id))}</div></div>
          <div class="admin-field"><label>Gym</label><input class="admin-input" name="gym" value="${escapeHtml(competitor.gym)}"></div>
          <div class="admin-field"><label for="detail-city">City</label><input class="admin-input" id="detail-city" name="city" maxlength="100" value="${escapeHtml(competitor.city)}"></div>
          <div class="admin-field"><label for="detail-state">State</label><select class="admin-select" id="detail-state" name="state"><option value="">Not entered</option>${Object.entries(US_STATES).map(([code, name]) => `<option value="${code}"${competitor.state === code ? " selected" : ""}>${name}</option>`).join("")}</select></div>
          <div class="admin-field"><label>Instagram</label><input class="admin-input" name="instagram" value="${escapeHtml(competitor.instagramHandle ? `@${competitor.instagramHandle}` : "")}"></div>
          <div class="admin-field full"><label>Admin notes</label><textarea class="admin-textarea" name="notes">${escapeHtml(competitor.notes)}</textarea></div>
        </div>
        <p class="admin-error" id="detail-error"></p>
        <div class="admin-dialog-actions"><button class="admin-button secondary" type="button" data-copy-status="${competitor.statusPath}">Copy status link</button><button class="admin-button" type="submit">Save details</button></div>
      </form>
      ${!competitor.match && mergeOptions ? `<hr style="border:0;border-top:1px solid var(--line);margin:24px 0"><div class="admin-field"><label>Merge this duplicate into</label><select class="admin-select" id="merge-target"><option value="">Select the record to keep</option>${mergeOptions}</select></div><div class="admin-dialog-actions"><button class="admin-button danger" id="merge-button" type="button">Merge duplicate</button></div>` : ""}
    `;

    target.querySelector("[data-copy-status]").addEventListener("click", (event) => copyText(event.currentTarget.dataset.copyStatus, "Status link copied"));
    target.querySelector("#detail-form").addEventListener("submit", async (submitEvent) => {
      submitEvent.preventDefault();
      const button = submitEvent.submitter;
      button.disabled = true;
      const formData = new FormData(submitEvent.currentTarget);
      const data = Object.fromEntries(formData);
      data.weightOptionIds = formData.getAll("weightOptionIds");
      try {
        await api("/api/superfight-admin-competitor", {
          method: "PATCH",
          body: JSON.stringify({ competitorId, ...data }),
        });
        showToast("Competitor updated");
        dialog.close();
        await loadActiveView();
      } catch (error) {
        target.querySelector("#detail-error").textContent = error.message;
        button.disabled = false;
      }
    });

    target.querySelector("#merge-button")?.addEventListener("click", async () => {
      const targetId = target.querySelector("#merge-target").value;
      if (!targetId || !window.confirm("Merge this record? The selected target will be kept and this source will leave the active pool.")) return;
      try {
        await api("/api/superfight-admin-competitor", {
          method: "POST",
          body: JSON.stringify({ action: "merge", competitorId, targetCompetitorId: targetId }),
        });
        showToast("Duplicate merged");
        dialog.close();
        await loadActiveView();
      } catch (error) { showToast(error.message); }
    });
  } catch (error) {
    target.innerHTML = `<p class="admin-error">${escapeHtml(error.message)}</p>`;
  }
}

function toLocalDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function openEventDialog(blank = false) {
  const event = blank ? null : currentEvent();
  document.querySelector("#event-form").reset();
  document.querySelector("#event-name").value = event?.name ?? "";
  document.querySelector("#event-slug").value = event?.slug ?? "";
  document.querySelector("#event-date").value = toLocalDateTime(event?.startsAt);
  document.querySelector("#event-venue").value = event?.venue ?? "";
  document.querySelector("#event-info").value = event?.applicationInfo ?? "";
  document.querySelector("#event-instagram").value = event?.instagramUrl ?? "https://instagram.com/libertyfightleague";
  document.querySelector("#event-open").checked = event?.applicationsOpen ?? false;
  document.querySelector("#event-error").textContent = "";
  document.querySelector("#weight-settings").hidden = !event;
  document.querySelector("#weight-list").innerHTML = event?.weightOptions.length
    ? event.weightOptions.map((weight) => `<li class="admin-badge">${escapeHtml(weight.label)} · ${weight.valueLbs} lb</li>`).join("")
    : '<li class="admin-muted">No weight choices configured.</li>';
  document.querySelector("#event-dialog").showModal();
}

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  document.querySelector("#login-error").textContent = "";
  try {
    const payload = await api("/api/superfight-admin-session", {
      method: "POST",
      body: JSON.stringify({
        email: document.querySelector("#login-email").value,
        password: document.querySelector("#login-password").value,
      }),
    });
    showWorkspace(payload.email);
    await loadEvents();
  } catch (error) {
    document.querySelector("#login-error").textContent = error.message;
  } finally { button.disabled = false; }
});

document.querySelector("#sign-out").addEventListener("click", async () => {
  await api("/api/superfight-admin-session", { method: "DELETE" });
  showLogin();
});

elements.eventSelect.addEventListener("change", async () => {
  state.eventId = elements.eventSelect.value || null;
  clearSelection();
  await loadActiveView();
});

document.querySelectorAll("[data-tab]").forEach((tab) => {
  tab.addEventListener("click", async () => {
    state.tab = tab.dataset.tab;
    clearSelection();
    document.querySelectorAll("[data-tab]").forEach((item) => item.classList.toggle("is-active", item === tab));
    document.querySelector("#unmatched-panel").hidden = ["matched", "offers"].includes(state.tab);
    document.querySelector("#matched-panel").hidden = state.tab !== "matched";
    document.querySelector("#offers-panel").hidden = state.tab !== "offers";
    await loadActiveView();
  });
});

document.querySelectorAll("[data-sort]").forEach((button) => {
  button.addEventListener("click", async () => {
    state.sort = button.dataset.sort;
    document.querySelectorAll("[data-sort]").forEach((item) => item.classList.toggle("is-active", item === button));
    await loadUnmatched();
  });
});

document.querySelector("#cancel-selection").addEventListener("click", clearSelection);
document.querySelector("#quick-add").addEventListener("click", () => {
  document.querySelector("#add-weight-options").innerHTML = weightChecklist(activeWeightOptions());
  document.querySelector("#quick-add-dialog").showModal();
});
document.querySelector("#event-settings").addEventListener("click", () => openEventDialog(!currentEvent()));

document.querySelectorAll("dialog [data-close]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});

document.querySelector("#quick-add-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = event.submitter;
  button.disabled = true;
  document.querySelector("#add-error").textContent = "";
  try {
    await api("/api/superfight-admin-competitors", {
      method: "POST",
      body: JSON.stringify({
        eventId: state.eventId,
        fullName: document.querySelector("#add-name").value,
        age: document.querySelector("#add-age").value,
        genderDivision: document.querySelector("#add-division").value,
        grapplingPreference: document.querySelector("#add-preference").value,
        belt: document.querySelector("#add-belt").value,
        weightOptionIds: [...form.querySelectorAll('[name="weightOptionIds"]:checked')].map((input) => input.value),
        gym: document.querySelector("#add-gym").value,
        city: document.querySelector("#add-city").value,
        state: document.querySelector("#add-state").value,
        instagram: document.querySelector("#add-instagram").value,
        phone: document.querySelector("#add-phone").value,
        preferredContactMethod: document.querySelector("#add-preferred-contact").value,
        email: document.querySelector("#add-email").value,
        notes: document.querySelector("#add-notes").value,
      }),
    });
    form.reset();
    document.querySelector("#quick-add-dialog").close();
    showToast("Competitor added to unmatched");
    await loadUnmatched();
  } catch (error) {
    document.querySelector("#add-error").textContent = error.message;
  } finally { button.disabled = false; }
});

document.querySelector("#match-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    await api("/api/superfight-admin-matches", {
      method: "POST",
      body: JSON.stringify({
        action: "match",
        offerId: state.offerId,
        eventId: state.eventId,
        fighterAId: state.pairing[0].id,
        fighterBId: state.pairing[1].id,
        extraCompetitorIds: state.pairing.slice(2).map(fighter => fighter.id),
        weightOptionId: document.querySelector("#match-weight-option").value,
        agreedWeightLbs: document.querySelector("#match-agreed-weight").value,
        boutType: document.querySelector("#match-bout-type").value,
        formatOverrideConfirmed: document.querySelector("#match-format-confirmed").checked,
      }),
    });
    document.querySelector("#match-dialog").close();
    showToast("Match created");
    clearSelection();
    await loadActiveView();
  } catch (error) {
    document.querySelector("#match-error").textContent = error.message;
  } finally { button.disabled = false; }
});

["#match-weight-option", "#match-agreed-weight", "#match-bout-type", "#match-format-confirmed"]
  .forEach((selector) => document.querySelector(selector).addEventListener("input", updateMatchSubmitAvailability));

document.querySelector("#event-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  const startsValue = document.querySelector("#event-date").value;
  const body = {
    name: document.querySelector("#event-name").value,
    slug: document.querySelector("#event-slug").value,
    startsAt: startsValue ? new Date(startsValue).toISOString() : null,
    venue: document.querySelector("#event-venue").value,
    applicationInfo: document.querySelector("#event-info").value,
    instagramUrl: document.querySelector("#event-instagram").value,
    applicationsOpen: document.querySelector("#event-open").checked,
  };
  const existing = currentEvent();
  if (existing) body.eventId = existing.id;

  try {
    const payload = await api("/api/superfight-admin-events", {
      method: existing ? "PATCH" : "POST",
      body: JSON.stringify(body),
    });
    state.events = payload.events;
    state.eventId = existing?.id ?? state.events.find((item) => item.slug === body.slug)?.id ?? state.events[0]?.id;
    eventOptions();
    document.querySelector("#event-dialog").close();
    openEventDialog(false);
    showToast("Event saved");
    await loadActiveView();
  } catch (error) {
    document.querySelector("#event-error").textContent = error.message;
  } finally { button.disabled = false; }
});

document.querySelector("#weight-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = event.submitter;
  button.disabled = true;
  try {
    const payload = await api("/api/superfight-admin-events", {
      method: "POST",
      body: JSON.stringify({
        resource: "weightOption",
        eventId: state.eventId,
        label: document.querySelector("#weight-label").value,
        valueLbs: document.querySelector("#weight-value").value,
      }),
    });
    state.events = payload.events;
    form.reset();
    document.querySelector("#event-dialog").close();
    openEventDialog(false);
    showToast("Weight choice added");
  } catch (error) { showToast(error.message); }
  finally { button.disabled = false; }
});

async function initialize() {
  try {
    const session = await api("/api/superfight-admin-session");
    showWorkspace(session.email);
    await loadEvents();
  } catch {
    showLogin();
  }
}

initialize();

let gauntletCandidates = [];
let gauntletLoadVersion = 0;
function updateGauntletSelection() {
  const third = document.querySelector("#match-fighter-c");
  const fourth = document.querySelector("#match-fighter-d");
  if (!third.value || fourth.value === third.value) fourth.value = "";
  fourth.disabled = !third.value;
  for (const option of fourth.options) option.disabled = Boolean(option.value && option.value === third.value);
  state.pairing = state.pairing.slice(0, 2).concat([third.value, fourth.value].filter(Boolean)
    .map(id => gauntletCandidates.find(fighter => fighter.id === id)).filter(Boolean));
  refreshMatchAgreement();
}
for (const id of ["#match-fighter-c", "#match-fighter-d"]) {
  document.querySelector(id).addEventListener("change", updateGauntletSelection);
}
document.querySelector("#match-bout-type").addEventListener("change", async () => {
  const version = ++gauntletLoadVersion;
  const isGauntlet = document.querySelector("#match-bout-type").value === "gauntlet";
  document.querySelector("#gauntlet-fields").hidden = !isGauntlet;
  for (const id of ["#match-fighter-c", "#match-fighter-d"]) {
    document.querySelector(id).innerHTML = '<option value="">None</option>';
    document.querySelector(id).disabled = true;
  }
  state.pairing = state.pairing.slice(0, 2);
  refreshMatchAgreement();
  if (!isGauntlet) return;
  const pairing = state.pairing;
  try {
    const payload = await api(`/api/superfight-admin-competitors?eventId=${state.eventId}&sort=weight`);
    if (version !== gauntletLoadVersion || state.pairing !== pairing) return;
    gauntletCandidates = payload.competitors.filter(fighter => !pairing.some(selected => selected.id === fighter.id));
    const options = '<option value="">None</option>' + gauntletCandidates.map(fighter =>
      `<option value="${fighter.id}">${escapeHtml(fighter.name)} &#183; ${label(fighter.belt)} &#183; ${escapeHtml((fighter.weightOptions ?? []).map(shortWeightLabel).join(", "))}</option>`).join("");
    document.querySelector("#match-fighter-c").innerHTML = options;
    document.querySelector("#match-fighter-d").innerHTML = options;
    document.querySelector("#match-fighter-c").disabled = false;
  } catch (error) { document.querySelector("#match-error").textContent = error.message; }
});
