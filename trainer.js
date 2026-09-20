import { createHttpTrainer } from "./http.js";
import { createLocalTrainer } from "./local.js";
import { loadCourse } from "./course-runtime.js";

export let trainer = null;

export async function detectKind() {
  const requested = new URLSearchParams(location.search).get("storage");
  if (requested === "http" || requested === "idb") return requested;
  if (location.protocol === "file:") return "idb";
  try {
    const response = await fetch(new URL("api/state", location.href), {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (response.ok) return "http";
  } catch {
    /* static host or file */
  }
  return "idb";
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
