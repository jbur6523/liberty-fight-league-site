const content = document.querySelector("#confirm-content");
const loading = document.querySelector("#confirm-loading");
const toast = document.querySelector("#confirm-toast");
const token = window.location.pathname.split("/").filter(Boolean).at(-1);
let currentPayload;

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
  return { gi: "Gi", no_gi: "No-Gi" }[value] ?? null;
}

function responseMessage(value) {
  if (value === "accepted") return "You accepted this matchup.";
  if (value === "declined") return "You declined this matchup.";
  return "Review the details, then accept or decline.";
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
  currentPayload = payload;
  content.replaceChildren();
  content.append(
    element("p", { className: "sf-kicker", text: payload.event.name }),
    element("h1", { text: "Confirm your matchup." }),
    element("p", { className: "sf-lead", text: responseMessage(payload.confirmation.response) }),
  );

  const details = element("dl", { className: "sf-status-grid" });
  [
    fieldRow("Date & time", formattedDateTime(payload.event.startsAt)),
    fieldRow("Venue", payload.event.venue),
    fieldRow("Fighter", payload.fighter.name),
    fieldRow("Opponent", payload.opponent.name),
    fieldRow("Your belt", beltLabel(payload.fighter.belt)),
    fieldRow("Opponent belt", beltLabel(payload.opponent.belt)),
    fieldRow("Bout type", boutTypeLabel(payload.match.boutType)),
    fieldRow("Final weight class", payload.match.weightOption?.label ?? (payload.match.weightLbs === null ? null : `${payload.match.weightLbs} lb`)),
    fieldRow("Your gym", payload.fighter.gym || "Not listed"),
    fieldRow("Opponent gym", payload.opponent.gym || "Not listed"),
  ].filter(Boolean).forEach((row) => details.append(row));
  content.append(details);

  const gymField = element("div", { className: "sf-field" });
  const gymLabel = element("label", { text: "Update only your gym / academy" });
  gymLabel.htmlFor = "confirmation-gym";
  const gymInput = element("input", { className: "sf-input" });
  gymInput.id = "confirmation-gym";
  gymInput.value = payload.fighter.gym ?? "";
  gymInput.maxLength = 160;
  gymInput.autocomplete = "organization";
  const saveGym = element("button", { className: "sf-button secondary", text: "Save academy" });
  saveGym.type = "button";
  saveGym.addEventListener("click", () => updateGym(gymInput.value, saveGym));
  const gymActions = element("div", { className: "sf-actions" });
  gymActions.append(saveGym);
  gymField.append(gymLabel, gymInput, gymActions);
  content.append(gymField);

  if (!payload.match.active) {
    content.append(element("p", { className: "sf-error", text: "This matchup is no longer active." }));
    return;
  }

  const actions = element("div", { className: "sf-confirm-actions" });
  const accept = element("button", { className: "sf-button", text: "Accept" });
  const decline = element("button", { className: "sf-button danger", text: "Decline" });
  accept.type = decline.type = "button";
  accept.addEventListener("click", () => submitResponse("accepted", gymInput.value, accept, decline));
  decline.addEventListener("click", () => submitResponse("declined", gymInput.value, accept, decline));
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

async function updateGym(gym, button) {
  button.disabled = true;
  try {
    render(await request("PATCH", { gym }));
    showToast("Academy updated");
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function submitResponse(response, gym, ...buttons) {
  buttons.forEach((button) => { button.disabled = true; });
  try {
    render(await request("POST", { response, gym }));
    showToast(response === "accepted" ? "Matchup accepted" : "Response recorded");
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
