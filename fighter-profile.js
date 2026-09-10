import { readProfileSnapshot } from "/src/superfight/share-profile.js";

function renderProfile(profile) {
  document.querySelector("#profile").hidden = !profile;
  document.querySelector("#profile-error").hidden = Boolean(profile);
  if (!profile) return;
  document.title = `${profile.name} | Fighter Profile`;
  document.querySelector("#profile-name").textContent = profile.name;
  const details = document.querySelector("#profile-details");
  details.replaceChildren();
  for (const [label, value] of [
    ["Age", profile.age],
    ["Belt", profile.belt ? profile.belt[0].toUpperCase() + profile.belt.slice(1) : ""],
    ["Selected weight class", profile.weightClasses.join(" · ")],
    ["Gym", profile.gym],
    ["Instagram", profile.instagramHandle ? `@${profile.instagramHandle}` : ""],
  ]) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value ?? "Not provided";
    if (value === "") description.textContent = "Not provided";
    if (label === "Instagram" && /^[A-Za-z0-9._]{1,30}$/.test(profile.instagramHandle)) {
      const link = document.createElement("a");
      link.href = `https://www.instagram.com/${profile.instagramHandle}/`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `@${profile.instagramHandle}`;
      description.replaceChildren(link);
    }
    details.append(term, description);
  }
}

async function loadProfile() {
  const loading = document.querySelector("#profile-loading");
  loading.hidden = false;
  let profile = null;
  try {
    const token = window.location.pathname.match(/^\/p\/([A-Za-z0-9_-]{16})\/?$/)?.[1];
    if (token) {
      const response = await fetch(`/api/superfight-profile?token=${encodeURIComponent(token)}`);
      if (!response.ok) throw new Error("Profile unavailable");
      const data = await response.json();
      profile = readProfileSnapshot(encodeURIComponent(JSON.stringify(data.profile)));
    } else {
      profile = readProfileSnapshot(window.location.hash);
    }
  } catch { /* Render the unavailable state for missing links or network errors. */ }
  loading.hidden = true;
  renderProfile(profile);
}

loadProfile();
window.addEventListener("hashchange", loadProfile);
