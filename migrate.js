import { BY_ID } from "./course-runtime.js";

export const CURRICULUM_VERSION = 2;

export const OLD_GROUP_TO_NEW = {
  ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [i + 1, i + 1])),
  17: 17,
  18: 22,
  19: 24,
  20: 26,
  21: 28,
};

export function remapLessonId(lessonId) {
  if (!lessonId || !lessonId.includes("-")) return null;
  const dash = lessonId.indexOf("-");
  const prefix = lessonId.slice(0, dash);
  const phase = lessonId.slice(dash + 1);
  if (!prefix.startsWith("g") || !/^\d+$/.test(prefix.slice(1))) return null;
  const newGroup = OLD_GROUP_TO_NEW[Number(prefix.slice(1))];
  if (newGroup == null) return null;
  const remapped = `g${String(newGroup).padStart(2, "0")}-${phase}`;
  return remapped in BY_ID ? remapped : null;
}

export function migrateLearner(learner) {
  if (learner.curriculum_version >= CURRICULUM_VERSION) return false;
  const progress = {};
  for (const [lessonId, item] of Object.entries(learner.lesson_progress)) {
    const target = remapLessonId(lessonId);
    if (!target) continue;
    const existing = progress[target];
    if (existing && existing.status === "completed") continue;
    if (item.status === "skipped" && existing) continue;
    progress[target] = item;
  }
  learner.lesson_progress = progress;
  for (const result of learner.attempts) {
    if (result.lesson_id) {
      result.lesson_id = remapLessonId(result.lesson_id) || result.lesson_id;
    }
  }
  if (learner.active_session && learner.active_session.lesson_id) {
    learner.active_session.lesson_id = remapLessonId(learner.active_session.lesson_id);
  }
  learner.curriculum_version = CURRICULUM_VERSION;
  return true;
}

export function migrateState(state) {
  let changed = false;
  for (const learner of Object.values(state.profiles)) {
    changed = migrateLearner(learner) || changed;
  }
  return changed;
}

import { validateState as validateLegacyState } from "./legacy-validate.js";
import { COURSE_FIELDS, validateState } from "./validate.js";
export const MIGRATION_ID = "courses-schema-1-to-2";
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function legacyProjection(state) {
  const projected = structuredClone(state);
  projected.schema_version = 1;
  for (const profile of Object.values(projected.profiles)) {
    if (canonical(Object.keys(profile.courses)) !== '["en-qwerty"]') throw new Error("Migration created unexpected course");
    const progress = profile.courses["en-qwerty"];
    delete profile.courses;
    for (const record of [...progress.attempts, ...progress.assessment_history, ...(progress.active_session ? [progress.active_session] : [])]) {
      if (record.course_id !== "en-qwerty" || record.curriculum_version !== progress.curriculum_version) throw new Error("Migration identity mismatch");
      delete record.course_id; delete record.curriculum_version;
    }
    Object.assign(profile, progress);
  }
  return projected;
}
export function upgradeState(raw) {
  if (raw?.schema_version === 2) return validateState(raw);
  if (!raw || (raw.schema_version ?? 1) !== 1) throw new Error("Unsupported household schema; keep data and reload a compatible release");
  const original = validateLegacyState(raw);
  const candidate = structuredClone(original);
  candidate.schema_version = 2;
  for (const profile of Object.values(candidate.profiles)) {
    if (canonical(Object.keys(profile).sort()) !== canonical(["id", "settings", ...COURSE_FIELDS].sort())) throw new Error("Learner field needs a migration decision");
    const progress = {};
    for (const key of COURSE_FIELDS) { progress[key] = profile[key]; delete profile[key]; }
    for (const record of [...progress.attempts, ...progress.assessment_history, ...(progress.active_session ? [progress.active_session] : [])]) Object.assign(record, { course_id: "en-qwerty", curriculum_version: progress.curriculum_version });
    profile.courses = { "en-qwerty": progress };
  }
  const result = validateState(candidate);
  if (canonical(legacyProjection(result)) !== canonical(original)) throw new Error("Course migration preservation check failed; no data written");
  return result;
}
