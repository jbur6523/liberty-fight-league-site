const screens = [...document.querySelectorAll(".sf-screen")];
const questionScreens = ["name", "contact", "age", "division", "grappling", "belt", "weight", "gym", "instagram"];
const fieldsByScreen = {
  name: ["fullName"],
  contact: ["phone", "email"],
  age: ["age"],
  division: ["genderDivision"],
  grappling: ["grapplingPreference"],
  belt: ["belt"],
  weight: ["weightOptionIds"],
  gym: ["gym"],
  instagram: [],
};

let currentScreen = "intro";
let event;
let moving = false;

const application = document.querySelector("#application");
const loading = document.querySelector("#loading");
const form = document.querySelector("#superfight-form");
const progressWrap = document.querySelector("#progress-wrap");
const progressBar = document.querySelector("#progress-bar");
const progressLabel = document.querySelector("#progress-label");
const toast = document.querySelector("#toast");

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

function formattedEventDate(value) {
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

function eventMeta(label, value) {
  if (!value) return "";
  const escaped = String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  return `<div><strong>${label}</strong><span>${escaped}</span></div>`;
}

function updateProgress(screenName) {
  const index = questionScreens.indexOf(screenName);
  const visible = index >= 0;
  progressWrap.hidden = !visible;
  if (!visible) return;
  progressBar.style.width = `${((index + 1) / questionScreens.length) * 100}%`;
  progressLabel.textContent = `${index + 1} / ${questionScreens.length}`;
}

function screenElement(name) {
  return screens.find((screen) => screen.dataset.screen === name);
}

async function moveTo(nextScreen, direction = "forward") {
  if (moving || nextScreen === currentScreen) return;
  moving = true;
  const outgoing = screenElement(currentScreen);
  const incoming = screenElement(nextScreen);
  const forward = direction === "forward";

  outgoing.style.position = "absolute";
  incoming.inert = false;
  incoming.setAttribute("aria-hidden", "false");
  incoming.classList.add(forward ? "enter-from-right" : "enter-from-left");
  incoming.classList.add("is-active");
  incoming.getBoundingClientRect();
  outgoing.classList.add(forward ? "is-leaving-left" : "is-leaving-right");
  incoming.classList.remove("enter-from-right", "enter-from-left");

  await new Promise((resolve) => window.setTimeout(resolve, 330));
  outgoing.classList.remove("is-active", "is-leaving-left", "is-leaving-right");
  outgoing.style.position = "";
  outgoing.inert = true;
  outgoing.setAttribute("aria-hidden", "true");
  currentScreen = nextScreen;
  updateProgress(nextScreen);
  window.scrollTo({ top: 0, behavior: "smooth" });
  incoming.querySelector("input:not([type=hidden]), select")?.focus({ preventScroll: true });
  moving = false;
}

function clearErrors(screenName) {
  for (const field of fieldsByScreen[screenName] ?? []) {
    const error = document.querySelector(`[data-error="${field}"]`);
    if (error) error.textContent = "";
  }
}

function validateScreen(screenName) {
  clearErrors(screenName);
  const data = new FormData(form);
  const errors = {};

  if (screenName === "name" && !String(data.get("fullName") ?? "").trim()) {
    errors.fullName = "Enter your full name.";
  }
  if (screenName === "contact") {
    if (!String(data.get("phone") ?? "").trim()) errors.phone = "Enter your phone number.";
    const email = String(data.get("email") ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email address.";
  }
  if (screenName === "age") {
    const age = Number(data.get("age"));
    if (!Number.isInteger(age) || age < 1 || age > 120) {
      errors.age = "Enter your age in completed years.";
    }
  }
  if (screenName === "division" && !data.get("genderDivision")) {
    errors.genderDivision = "Select your competition division.";
  }
  if (screenName === "grappling" && !data.get("grapplingPreference")) {
    errors.grapplingPreference = "Select Gi, No-Gi, or Both.";
  }
  if (screenName === "belt" && !data.get("belt")) errors.belt = "Select your belt.";
  if (screenName === "weight" && data.getAll("weightOptionIds").length === 0) {
    errors.weightOptionIds = "Select at least one acceptable weight class.";
  }
  if (screenName === "gym" && !String(data.get("gym") ?? "").trim()) {
    errors.gym = "Enter your gym or academy.";
  }

  for (const [field, message] of Object.entries(errors)) {
    document.querySelector(`[data-error="${field}"]`).textContent = message;
  }
  return Object.keys(errors).length === 0;
}

async function loadEvent() {
  const requestedEvent = new URLSearchParams(window.location.search).get("event");
  const endpoint = requestedEvent
    ? `/api/superfight-event?event=${encodeURIComponent(requestedEvent)}`
    : "/api/superfight-event";

  try {
    const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "Event unavailable.");
    event = payload.event;
    document.querySelector("#event-name").textContent = event.name;
    document.querySelector("#event-info").textContent = event.applicationInfo || "Apply to compete in a Liberty Fight League Jiu-Jitsu superfight.";
    document.querySelector("#event-meta").innerHTML = [
      eventMeta("Date & time", formattedEventDate(event.startsAt)),
      eventMeta("Venue", event.venue),
    ].join("");

    const weightOptions = document.querySelector("#weight-options");
    for (const option of event.weightOptions) {
      const choice = document.createElement("label");
      choice.className = "sf-check-choice";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "weightOptionIds";
      input.value = option.id;
      input.addEventListener("change", () => {
        choice.classList.toggle("is-selected", input.checked);
        document.querySelector('[data-error="weightOptionIds"]').textContent = "";
      });
      const text = document.createElement("span");
      text.textContent = option.label;
      choice.append(input, text);
      weightOptions.append(choice);
    }

    const configuredInstagram = event.instagramUrl || "https://instagram.com/libertyfightleague";
    document.querySelector("#instagram-link").href = configuredInstagram;
    const canApply = event.applicationsOpen && event.weightOptions.length > 0;
    document.querySelector("#start-button").disabled = !canApply;
    if (!event.applicationsOpen) {
      document.querySelector("#intro-error").textContent = "Applications are currently closed.";
    } else if (event.weightOptions.length === 0) {
      document.querySelector("#intro-error").textContent = "Competition weights have not been configured yet.";
    }
  } catch (error) {
    document.querySelector("#event-name").textContent = "Superfight applications";
    document.querySelector("#event-info").textContent = "Event information is not available right now.";
    document.querySelector("#intro-error").textContent = error.message;
    document.querySelector("#start-button").disabled = true;
  } finally {
    loading.hidden = true;
    application.hidden = false;
  }
}

document.querySelector("#start-button").addEventListener("click", () => moveTo("name"));

screens.forEach((screen) => {
  const active = screen.dataset.screen === currentScreen;
  screen.inert = !active;
  screen.setAttribute("aria-hidden", String(!active));
});

document.querySelectorAll("[data-next]").forEach((button) => {
  button.addEventListener("click", () => {
    if (!validateScreen(currentScreen)) return;
    const index = questionScreens.indexOf(currentScreen);
    moveTo(questionScreens[index + 1]);
  });
});

document.querySelectorAll("[data-back]").forEach((button) => {
  button.addEventListener("click", () => {
    const index = questionScreens.indexOf(currentScreen);
    moveTo(index === 0 ? "intro" : questionScreens[index - 1], "back");
  });
});

document.querySelectorAll("[data-belt]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector("#belt").value = button.dataset.belt;
    document.querySelectorAll("[data-belt]").forEach((choice) => {
      choice.classList.toggle("is-selected", choice === button);
    });
    document.querySelector('[data-error="belt"]').textContent = "";
  });
});

function bindChoiceButtons(selector, inputSelector, dataKey, errorField) {
  document.querySelectorAll(selector).forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector(inputSelector).value = button.dataset[dataKey];
      document.querySelectorAll(selector).forEach((choice) => {
        choice.classList.toggle("is-selected", choice === button);
      });
      document.querySelector(`[data-error="${errorField}"]`).textContent = "";
    });
  });
}

bindChoiceButtons("[data-division]", "#gender-division", "division", "genderDivision");
bindChoiceButtons("[data-preference]", "#grappling-preference", "preference", "grapplingPreference");

form.addEventListener("keydown", (eventKey) => {
  if (eventKey.key === "Enter" && currentScreen !== "instagram" && eventKey.target.tagName !== "TEXTAREA") {
    eventKey.preventDefault();
    screenElement(currentScreen)?.querySelector("[data-next]")?.click();
  }
});

form.addEventListener("submit", async (submitEvent) => {
  submitEvent.preventDefault();
  const submitButton = document.querySelector("#submit-button");
  submitButton.disabled = true;
  submitButton.textContent = "Sending…";
  const formData = new FormData(form);
  const data = Object.fromEntries(formData);
  data.weightOptionIds = formData.getAll("weightOptionIds");

  try {
    const response = await fetch("/api/superfight-apply", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ...data, eventId: event.id }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "Application could not be sent.");
    if (!payload.statusPath) {
      await moveTo("success");
      document.querySelector("#status-url").value = "Application received";
      document.querySelector("#copy-status").hidden = true;
      document.querySelector("#open-status").hidden = true;
      return;
    }

    const statusUrl = new URL(payload.statusPath, window.location.origin).toString();
    document.querySelector("#status-url").value = statusUrl;
    document.querySelector("#open-status").href = payload.statusPath;
    await moveTo("success");
  } catch (error) {
    document.querySelector('[data-error="instagram"]').textContent = error.message;
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Send application";
  }
});

document.querySelector("#copy-status").addEventListener("click", async () => {
  await navigator.clipboard.writeText(document.querySelector("#status-url").value);
  showToast("Status link copied");
});

loadEvent();
