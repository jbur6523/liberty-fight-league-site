import { readProfileSnapshot } from "/src/superfight/share-profile.js";

function renderProfile() {
  const profile = readProfileSnapshot(window.location.hash);
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

renderProfile();
window.addEventListener("hashchange", renderProfile);
