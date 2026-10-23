import { createHttpTrainer } from "./http.js";
import { createLocalTrainer } from "./local.js";
import { loadCourse } from "./course-runtime.js";
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

async function loadCourseDocument() {
  const module = await import("./course.json", { with: { type: "json" } });
  return module.default;
}

export async function bindTrainer() {
  const kind = await detectKind();
  if (kind === "http") {
    trainer = createHttpTrainer();
    return trainer;
  }
  const course = await loadCourseDocument();
  loadCourse(course);
  const { openIdbStore } = await import("./idb.js");
  const store = await openIdbStore();
  trainer = createLocalTrainer(store, course);
  return trainer;
}
