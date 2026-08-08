const state = {
  events: [],
  eventId: null,
  competitors: [],
  matches: [],
  sort: "suggested",
  tab: "unmatched",
  selected: null,
  pairing: null,
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

function renderUnmatched() {
  document.querySelector("#unmatched-count").textContent = `(${state.competitors.length})`;
  if (!state.eventId) {
    elements.unmatched.innerHTML = emptyState(
      "Create the first event",
      "Event details and weight choices stay configurable.",
      '<button class="admin-button" type="button" data-open-event>Create event</button>',
    );
    elements.unmatched.querySelector("[data-open-event]")?.addEventListener("click", () => openEventDialog(true));
    return;
  }
  if (state.competitors.length === 0) {
    elements.unmatched.innerHTML = emptyState("No unmatched competitors", "Quick-add a competitor or share the public application link.");
    return;
  }

  elements.unmatched.innerHTML = `
    <div class="admin-table-wrap"><table class="admin-table">
      <thead><tr><th>Name</th><th>Belt</th><th>Weight</th><th>Gym</th><th>Instagram</th><th>Match action</th></tr></thead>
      <tbody>${state.competitors.map((competitor) => `
        <tr class="${state.selected?.id === competitor.id ? "is-selected" : ""}">
          <td><button class="admin-name-button" type="button" data-detail="${competitor.id}">${escapeHtml(competitor.name)}</button></td>
          <td>${label(competitor.belt)}</td>
          <td>${competitor.weightLbs === null ? "—" : `${competitor.weightLbs} lb`}</td>
          <td>${escapeHtml(competitor.gym || "—")}</td>
          <td>${socialCell(competitor)}</td>
          <td><button class="admin-button ${state.selected?.id === competitor.id ? "secondary" : ""}" type="button" data-select="${competitor.id}">${state.selected?.id === competitor.id ? "Selected" : state.selected ? "Match with" : "Select"}</button></td>
        </tr>`).join("")}</tbody>
    </table></div>`;

  bindTableActions(elements.unmatched);
  elements.unmatched.querySelectorAll("[data-select]").forEach((button) => {
    button.addEventListener("click", () => selectCompetitor(button.dataset.select));
  });
}

function confirmationBadge(summary) {
  const details = {
    awaiting_confirmation: ["Awaiting confirmation", ""],
    fighter_a_accepted: ["Fighter A accepted", "good"],
    fighter_b_accepted: ["Fighter B accepted", "good"],
    both_accepted: ["Both accepted", "good"],
    declined: ["Declined", "bad"],
  }[summary] ?? ["Awaiting confirmation", ""];
  return `<span class="admin-badge ${details[1]}">${details[0]}</span>`;
}

function matchFighterCell(fighter) {
  return `<button class="admin-name-button" type="button" data-detail="${fighter.id}">${escapeHtml(fighter.name)}</button><div class="admin-muted">${label(fighter.belt)} · ${escapeHtml(fighter.gym || "No gym")}</div>`;
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
      <thead><tr><th>Fighter A</th><th>Fighter B</th><th>Match weight</th><th>Confirmation</th><th>Quick actions</th></tr></thead>
      <tbody>${state.matches.map((match) => `
        <tr>
          <td>${matchFighterCell(match.fighterA)}${matchLinks(match.fighterA)}</td>
          <td>${matchFighterCell(match.fighterB)}${matchLinks(match.fighterB)}</td>
          <td>${match.weightLbs === null ? "—" : `${match.weightLbs} lb`}</td>
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
        showToast("Competitors returned to unmatched");
        await loadMatches();
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
  if (!state.eventId) {
    state.competitors = [];
    renderUnmatched();
    return;
  }
  const payload = await api(`/api/superfight-admin-competitors?eventId=${state.eventId}&sort=${state.sort}`);
  state.competitors = payload.competitors;
  renderUnmatched();
}

async function loadMatches() {
  if (!state.eventId) {
    state.matches = [];
    renderMatched();
    return;
  }
  const payload = await api(`/api/superfight-admin-matches?eventId=${state.eventId}`);
  state.matches = payload.matches;
  renderMatched();
}

async function loadActiveView() {
  if (state.tab === "matched") await loadMatches();
  else await loadUnmatched();
}

function clearSelection() {
  state.selected = null;
  state.pairing = null;
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

  state.pairing = [state.selected, competitor];
  document.querySelector("#match-pair").innerHTML = state.pairing.map((fighter, index) => `
    <div class="admin-detail"><strong>Fighter ${index === 0 ? "A" : "B"}</strong>${escapeHtml(fighter.name)}<br><span class="admin-muted">${label(fighter.belt)} · ${fighter.weightLbs === null ? "No weight" : `${fighter.weightLbs} lb`}</span></div>
  `).join("");
  const weights = state.pairing.map((fighter) => fighter.weightLbs).filter((value) => value !== null);
  document.querySelector("#match-weight").value = weights.length ? Math.max(...weights) : "";
  document.querySelector("#match-error").textContent = "";
  document.querySelector("#match-dialog").showModal();
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
        <div class="admin-detail"><strong>Match status</strong>${competitor.match ? `Matched with ${escapeHtml(competitor.match.opponent.full_name)}` : "Unmatched"}</div>
        ${competitor.match ? `<div class="admin-detail"><strong>Fighter confirmation</strong>${label(fighterResponse || "awaiting")}</div><div class="admin-detail"><strong>Opponent confirmation</strong>${label(opponentResponse || "awaiting")}</div>` : ""}
      </div>
      <form id="detail-form" style="margin-top:20px">
        <div class="admin-form-grid">
          <div class="admin-field full"><label>Name</label><input class="admin-input" name="fullName" value="${escapeHtml(competitor.name)}" required></div>
          <div class="admin-field"><label>Phone</label><input class="admin-input" name="phone" value="${escapeHtml(competitor.phone)}"></div>
          <div class="admin-field"><label>Email</label><input class="admin-input" name="email" type="email" value="${escapeHtml(competitor.email)}"></div>
          <div class="admin-field"><label>Belt</label><select class="admin-select" name="belt"><option value="">Not entered</option>${["blue","purple","brown","black"].map((beltValue) => `<option value="${beltValue}"${competitor.belt === beltValue ? " selected" : ""}>${label(beltValue)}</option>`).join("")}</select></div>
          <div class="admin-field"><label>Weight (lb)</label><input class="admin-input" name="weightLbs" type="number" min="1" step=".01" value="${competitor.weightLbs ?? ""}"></div>
          <div class="admin-field"><label>Gym</label><input class="admin-input" name="gym" value="${escapeHtml(competitor.gym)}"></div>
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
      const data = Object.fromEntries(new FormData(submitEvent.currentTarget));
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
    if (state.tab === "matched") {
      state.selected = null;
      state.pairing = null;
      elements.matchbar.hidden = true;
    }
    document.querySelectorAll("[data-tab]").forEach((item) => item.classList.toggle("is-active", item === tab));
    document.querySelector("#unmatched-panel").hidden = state.tab !== "unmatched";
    document.querySelector("#matched-panel").hidden = state.tab !== "matched";
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
document.querySelector("#quick-add").addEventListener("click", () => document.querySelector("#quick-add-dialog").showModal());
document.querySelector("#event-settings").addEventListener("click", () => openEventDialog(!currentEvent()));

document.querySelectorAll("dialog [data-close]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});

document.querySelector("#quick-add-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  document.querySelector("#add-error").textContent = "";
  try {
    await api("/api/superfight-admin-competitors", {
      method: "POST",
      body: JSON.stringify({
        eventId: state.eventId,
        fullName: document.querySelector("#add-name").value,
        belt: document.querySelector("#add-belt").value,
        weightLbs: document.querySelector("#add-weight").value,
        gym: document.querySelector("#add-gym").value,
        instagram: document.querySelector("#add-instagram").value,
        phone: document.querySelector("#add-phone").value,
        email: document.querySelector("#add-email").value,
        notes: document.querySelector("#add-notes").value,
      }),
    });
    event.currentTarget.reset();
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
        eventId: state.eventId,
        fighterAId: state.pairing[0].id,
        fighterBId: state.pairing[1].id,
        matchWeightLbs: document.querySelector("#match-weight").value,
      }),
    });
    document.querySelector("#match-dialog").close();
    showToast("Match created");
    clearSelection();
    await loadUnmatched();
  } catch (error) {
    document.querySelector("#match-error").textContent = error.message;
  } finally { button.disabled = false; }
});

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
    event.currentTarget.reset();
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
