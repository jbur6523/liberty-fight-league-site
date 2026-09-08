const content = document.querySelector("#confirm-content");
const loading = document.querySelector("#confirm-loading");
const toast = document.querySelector("#confirm-toast");
const token = window.location.pathname.split("/").filter(Boolean).at(-1);

function element(tagName, options = {}) {
  const node = document.createElement(tagName);
  if (options.className) node.className = options.className;
  if (options.text) node.textContent = options.text;
  return node;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove("is-visible"), 2400);
}

function fieldRow(label, value) {
  if (!value) return null;
  const row = element("div", { className: "sf-status-row" });
  row.append(element("dt", { text: label }), element("dd", { text: value }));
  return row;
}

function beltLabel(value) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : null;
}

function boutTypeLabel(value) {
  return { gi: "Gi", no_gi: "No-Gi", john_wick: "John Wick", gauntlet: "Gauntlet" }[value] ?? null;
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

function render(payload) {
  content.replaceChildren();

  const response = payload.confirmation.response;
  const copy = {
    accepted: {
      title: "Match Confirmed",
      lead: "Thank you for accepting your matchup. You're officially set for Roll With It 3.",
      note: "Liberty Fight League will contact you if anything changes.",
    },
    declined: {
      title: "Matchup Declined",
      lead: "Your response has been recorded. You declined this matchup.",
      note: "Liberty Fight League will contact you if a new matchup becomes available.",
    },
    awaiting: {
      title: "Confirm your matchup.",
      lead: "Review the agreed match details, then accept or decline.",
    },
  }[response] ?? {
    title: "Confirmation unavailable",
    lead: "We couldn't determine the status of this matchup.",
  };

  content.append(
    element("p", { className: "sf-kicker", text: payload.event.name }),
    element("h1", { text: copy.title }),
    element("p", { className: "sf-lead", text: copy.lead }),
  );

  const details = element("dl", { className: "sf-status-grid" });
  [
    fieldRow("Date & time", formattedDateTime(payload.event.startsAt)),
    fieldRow("Venue", payload.event.venue),
    fieldRow("Fighter", payload.fighter.name),
    ...((payload.opponents ?? [payload.opponent]).flatMap(opponent => [fieldRow("Opponent", opponent.name), fieldRow("Opponent belt", beltLabel(opponent.belt)), fieldRow("Opponent gym", opponent.gym)])),
    fieldRow("Your belt", beltLabel(payload.fighter.belt)),
    fieldRow("Bout type", boutTypeLabel(payload.match.boutType)),
    fieldRow("Agreed match weight", payload.match.weightOption?.label ?? (payload.match.weightLbs === null ? null : `${payload.match.weightLbs} lb`)),
    fieldRow("Your gym", payload.fighter.gym || "Not listed"),
  ].filter(Boolean).forEach((row) => details.append(row));
  content.append(details);

  if (copy.note) {
    content.append(element("p", { className: "sf-response-note", text: copy.note }));
  }

  if (response !== "awaiting") return;

  if (!payload.match.active) {
    content.append(element("p", { className: "sf-error", text: "This matchup is no longer active." }));
    return;
  }

  const actions = element("div", { className: "sf-confirm-actions" });
  const accept = element("button", { className: "sf-button", text: "ACCEPT" });
  const decline = element("button", { className: "sf-button danger", text: "DECLINE" });
  accept.type = decline.type = "button";
  accept.addEventListener("click", () => submitResponse("accepted", accept, decline));
  decline.addEventListener("click", () => submitResponse("declined", accept, decline));
  actions.append(accept, decline);
  content.append(actions);
}

async function request(method, body) {
  const response = await fetch(`/api/superfight-confirm?token=${encodeURIComponent(token ?? "")}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || "The request could not be completed.");
  return payload;
}

async function submitResponse(response, ...buttons) {
  buttons.forEach((button) => { button.disabled = true; });
  try {
    render(await request("POST", { response }));
  } catch (error) {
    showToast(error.message);
    buttons.forEach((button) => { button.disabled = false; });
  }
}

async function loadConfirmation() {
  try {
    render(await request("GET"));
  } catch (error) {
    content.append(
      element("p", { className: "sf-kicker", text: "Confirmation unavailable" }),
      element("h1", { text: "We couldn’t open this matchup." }),
      element("p", { className: "sf-lead", text: error.message }),
    );
  } finally {
    loading.hidden = true;
    content.hidden = false;
  }
}

loadConfirmation();
