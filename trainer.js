import { createHttpTrainer } from "./http.js";
import { createLocalTrainer } from "./local.js";
import { allCourses } from "./course-registry.js";
import { canonical } from "./migrate.js";
import { sha256Hex } from "./scoring.js";
import { storageKind } from "./deployment.js";

export let trainer = null;

export async function detectKind() {
  return storageKind;
}

export function storageLocation() {
  return storageKind === "http"
    ? "Household file on this computer (local Python server)"
    : "This browser on this computer (IndexedDB)";
}

let rootTrainer;
export function selectTrainer(courseId) { trainer = rootTrainer.forCourse(courseId); }

export async function prepareRelease() {
  const response = await fetch(new URL("./release.json", import.meta.url), {cache: "no-store"});
  if (!response.ok) throw new Error("Release manifest unavailable. Retry without clearing storage.");
  const manifest = await response.json();
  if (manifest.protocol !== 2 || !manifest.household_schemas?.includes(2)) throw new Error("Mixed application assets. Reload this release; household data is untouched.");
  if (typeof manifest.migration_enabled !== "boolean" || typeof manifest.ukrainian_enabled !== "boolean" || !Array.isArray(manifest.definitions) || !Array.isArray(manifest.catalog)) throw new Error("Incomplete release manifest. Retry without clearing storage.");
  const definitions = allCourses();
  if (manifest.definitions.length !== definitions.length) throw new Error("Incomplete course catalog. Retry without clearing storage.");
  for (const runtime of definitions) {
    const {content_digest, ...content} = runtime.data;
    const entry = manifest.definitions.find(d => d.id === content.id && d.curriculum_version === content.version);
    if (!entry || entry.content_digest !== content_digest || sha256Hex(canonical(content)) !== content_digest) throw new Error("Course assets do not match this release. Retry without clearing storage.");
  }
  const latest = new Map();
  for(const runtime of definitions) {
    const data=runtime.data, previous=latest.get(data.id);
    if(!previous || previous.version<data.version) latest.set(data.id,data);
  }
  const catalog=[...latest.values()].filter(c=>c.id !== "uk-ua" || manifest.ukrainian_enabled).map(c=>({id:c.id,title:c.title,language:c.language,layout_id:c.layout_id,curriculum_version:c.version,content_digest:c.content_digest,asset:`courses/${c.id}-v${c.version}.json`}));
  if(canonical(catalog) !== canonical(manifest.catalog)) throw new Error("Course catalog does not match this release. Retry without clearing storage.");
  return manifest;
}
export async function bindTrainer() {
  const manifest = await prepareRelease();
  const kind = await detectKind();
  if (kind === "http") {
    rootTrainer = createHttpTrainer();
    const catalog = await rootTrainer.getCatalog();
    if (canonical(catalog) !== canonical(manifest.catalog)) throw new Error("The server and page belong to different releases. Reload before saving.");
  } else {
    const { openIdbStore } = await import("./idb.js");
    const store = await openIdbStore({migrationEnabled: manifest.migration_enabled, releaseId: manifest.release});
    rootTrainer = createLocalTrainer(store, null, "en-qwerty", manifest.ukrainian_enabled);
  }
  trainer = rootTrainer;
  return trainer;
}
