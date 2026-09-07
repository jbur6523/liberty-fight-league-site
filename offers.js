const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const preference = (value) => ({ gi: "Gi", no_gi: "No-Gi", both: "Both" }[value] ?? "Not entered");
const beltLabel = (value) => value ? value[0].toUpperCase() + value.slice(1) : "Not entered";
const beltClass = (value) => ["blue", "purple", "brown", "black"].includes(value) ? ` belt-${value}` : "";
const weights = (fighter) => fighter.weightOptions.map((weight) => weight.label).join(" · ") || "Weight class to be agreed";
let target;
let instagram;
let requestKey;
let lookupVersion = 0;

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json" } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || "Please try again.");
  return payload;
}

async function loadAvailable() {
  try {
    const { competitors } = await api("/api/superfight-offers");
    $("#available-list").innerHTML = competitors.length ? competitors.map((fighter) => `<article class="offers-card">
      <h2 class="admin-name-button${beltClass(fighter.belt)}">${escapeHtml(fighter.firstName)}</h2>
      <p>${escapeHtml(beltLabel(fighter.belt))}</p><p>${escapeHtml(weights(fighter))}</p><p>${preference(fighter.grapplingPreference)}</p>
      <button class="admin-button" type="button" data-view="${fighter.id}">View Match</button></article>`).join("")
      : '<div class="admin-empty"><h2>No available matches right now</h2><p>Check back soon or apply to compete.</p><a class="admin-button" href="/superfight">Apply for a Superfight</a></div>';
    $("#offers-error").textContent = "";
    document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => viewMatch(button.dataset.view)));
  } catch (error) { $("#available-list").textContent = ""; $("#offers-error").textContent = error.message; }
}

async function viewMatch(id) {
  $("#profile-content").textContent = "Loading…";
  $("#profile-error").textContent = "";
  $("#offer-match").hidden = true;
  $("#public-profile").showModal();
  try {
    ({ competitor: target } = await api(`/api/superfight-offers?id=${encodeURIComponent(id)}`));
    $("#profile-content").innerHTML = `<h2 class="admin-name-button${beltClass(target.belt)}">${escapeHtml(target.firstName)}</h2>
      <div class="admin-detail-grid"><div class="admin-detail"><strong>Instagram</strong>${target.instagramHandle ? `<a href="https://instagram.com/${encodeURIComponent(target.instagramHandle)}" target="_blank" rel="noopener">@${escapeHtml(target.instagramHandle)}</a>` : "Not entered"}</div>
      <div class="admin-detail"><strong>Gym</strong>${escapeHtml(target.gym || "Not entered")}</div>
      <div class="admin-detail"><strong>Belt</strong>${escapeHtml(beltLabel(target.belt))}</div><div class="admin-detail"><strong>Match preference</strong>${preference(target.grapplingPreference)}</div>
      <div class="admin-detail"><strong>Interested weight classes</strong>${escapeHtml(weights(target))}</div></div>`;
    $("#offer-match").hidden = false;
  } catch (error) { $("#profile-content").textContent = ""; $("#profile-error").textContent = error.message; }
}

function resetLookup() {
  lookupVersion++;
  instagram = null;
  $("#instagram-form").hidden = false;
  $("#offer-form").hidden = true;
  $("#offer-success").hidden = true;
  $("#offer-error").textContent = "";
}

$("#offer-match").addEventListener("click", () => {
  $("#public-profile").close();
  $("#instagram-form").reset(); $("#offer-form").reset(); resetLookup();
  requestKey = crypto.randomUUID();
  $("#offer-target").textContent = `Offer a match against ${target.firstName}`;
  $("#offer-dialog").showModal();
});
$("#change-instagram").addEventListener("click", resetLookup);
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));

$("#instagram-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter; button.disabled = true;
  const version = ++lookupVersion;
  $("#offer-error").textContent = "";
  try {
    const result = await api("/api/superfight-offers", { method: "POST", body: JSON.stringify({ action: "lookup", targetId: target.id, instagram: $("#offer-instagram").value }) });
    if (version !== lookupVersion) return;
    instagram = result.instagramHandle;
    $("#offer-form").reset();
    for (const [id, key] of [["#offer-first-name", "firstName"], ["#offer-belt", "belt"], ["#offer-gym", "gym"]]) {
      $(id).value = result.profile?.[key] ?? "";
      $(id).disabled = result.existing;
    }
    $("#offer-bout").value = ["gi", "no_gi"].includes(result.profile?.grapplingPreference) ? result.profile.grapplingPreference : "";
    const selected = new Set(result.selectedWeightOptionIds);
    $("#offer-weight-options").innerHTML = result.weightOptions.map((option) => `<label class="offers-weight-choice"><input type="checkbox" name="weightOptionIds" value="${escapeHtml(option.id)}" ${selected.has(option.id) ? "checked" : ""}><span>${escapeHtml(option.label)}</span></label>`).join("");
    $("#existing-message").textContent = result.existing ? `Found your registration for @${instagram}. Your existing profile is preserved. Choose your acceptable weight classes and match type.` : `New competitor: @${instagram}. Tell us about yourself.`;
    $("#existing-weights").textContent = result.profile?.weightOptions.length ? `Registered weight classes: ${weights(result.profile)}` : "";
    $("#instagram-form").hidden = true; $("#offer-form").hidden = false;
  } catch (error) { $("#offer-error").textContent = error.message; }
  finally { button.disabled = false; }
});

$("#offer-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter; button.disabled = true;
  $("#offer-error").textContent = "";
  try {
    const weightOptionIds = [...document.querySelectorAll('[name="weightOptionIds"]:checked')].map((input) => input.value);
    if (!weightOptionIds.length) throw new Error("Select at least one acceptable weight class.");
    await api("/api/superfight-offers", { method: "POST", body: JSON.stringify({
      action: "submit", targetId: target.id, instagram, requestKey,
      firstName: $("#offer-first-name").value, belt: $("#offer-belt").value,
      weightOptionIds, gym: $("#offer-gym").value,
      boutType: $("#offer-bout").value, website: $("#offer-website").value,
    }) });
    $("#offer-form").hidden = true; $("#offer-success").hidden = false;
    await loadAvailable();
  } catch (error) { $("#offer-error").textContent = error.message; }
  finally { button.disabled = false; }
});
loadAvailable();
