const content = document.querySelector("#status-content");
const loading = document.querySelector("#status-loading");

function textElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function definitionList(rows) {
  const list = document.createElement("dl");
  list.className = "sf-status-grid";

  for (const [label, value, link] of rows) {
    if (value === null || value === undefined || value === "") continue;
    const row = document.createElement("div");
    row.className = "sf-status-row";
    row.append(textElement("dt", "", label));
    const detail = document.createElement("dd");
    if (link) {
      const anchor = document.createElement("a");
      anchor.href = link;
      anchor.target = "_blank";
      anchor.rel = "noopener";
      anchor.textContent = value;
      detail.append(anchor);
    } else {
      detail.textContent = value;
    }
    row.append(detail);
    list.append(row);
  }

  return list;
}

function confirmationLabel(value) {
  return {
    awaiting_confirmation: "Awaiting confirmation",
    fighter_a_accepted: "One fighter accepted",
    fighter_b_accepted: "One fighter accepted",
    both_accepted: "Both fighters accepted",
    declined: "Declined",
  }[value] ?? "Awaiting confirmation";
}

function formattedDateTime(value) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

function renderUnmatched(payload) {
  content.append(
    textElement("p", "sf-kicker", payload.event.name),
    textElement("h1", "", "Application received."),
    textElement("p", "sf-lead", `${payload.fighter.name}, we’re still looking for the right opponent. Check this page again for updates.`),
    definitionList([
      ["Event date", formattedDateTime(payload.event.startsAt)],
      ["Venue", payload.event.venue],
    ]),
  );
}

function renderMatched(payload) {
  content.append(
    textElement("p", "sf-kicker", payload.event.name),
    textElement("h1", "", "You’ve been matched."),
    textElement("p", "sf-lead", `${payload.fighter.name}, here are your current matchup details.`),
    definitionList([
      ["Opponent", payload.opponent.name],
      ["Opponent belt", payload.opponent.belt ? `${payload.opponent.belt[0].toUpperCase()}${payload.opponent.belt.slice(1)}` : null],
      ["Opponent gym", payload.opponent.gym],
      ["Opponent Instagram", payload.opponent.instagramHandle ? `@${payload.opponent.instagramHandle}` : null, payload.opponent.instagramUrl],
      ["Final weight class", payload.match.weightOption?.label ?? (payload.match.weightLbs === null ? null : `${payload.match.weightLbs} lb`)],
      ["Bout type", { gi: "Gi", no_gi: "No-Gi" }[payload.match.boutType] ?? null],
      ["Event date", formattedDateTime(payload.event.startsAt)],
      ["Venue", payload.event.venue],
      ["Match status", confirmationLabel(payload.match.confirmation.summary)],
    ]),
  );
}

function renderError(message) {
  content.append(
    textElement("p", "sf-kicker", "Status unavailable"),
    textElement("h1", "", "We couldn’t open this status link."),
    textElement("p", "sf-lead", message),
  );
}

async function loadStatus() {
  const token = window.location.pathname.split("/").filter(Boolean).at(-1);
  try {
    const response = await fetch(`/api/superfight-status?token=${encodeURIComponent(token ?? "")}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "The link may be incomplete or expired.");
    if (payload.status === "matched") renderMatched(payload);
    else renderUnmatched(payload);
  } catch (error) {
    renderError(error.message);
  } finally {
    loading.hidden = true;
    content.hidden = false;
  }
}

loadStatus();
