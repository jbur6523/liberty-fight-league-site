import { access, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const roots = ["api", "src"];

async function javascriptFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await javascriptFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(entryPath);
    }
  }

  return files;
}

const files = (await Promise.all(roots.map(javascriptFiles))).flat().sort();
for (const file of files) {
  await import(pathToFileURL(path.resolve(file)));
}

const syntaxOnlyFiles = [
  "admin-superfights.js",
  "confirm.js",
  "scripts/preview-server.mjs",
  "status.js",
  "superfight.js",
];
let syntaxOnlyCount = 0;
for (const file of syntaxOnlyFiles) {
  try {
    await access(file);
  } catch {
    continue;
  }
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
  syntaxOnlyCount += 1;
}

console.log(`Checked ${files.length + syntaxOnlyCount} application modules successfully.`);
