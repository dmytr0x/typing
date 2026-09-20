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
