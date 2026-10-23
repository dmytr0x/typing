import { sha256Hex } from "./scoring.js";
import { canonical } from "./migrate.js";
import * as legacy from "./legacy-validate.js";
import { upgradeState } from "./migrate.js";

export const { clock, now, uid, validateSettings, emptySkill, validateLearning } = legacy;
export const COURSE_FIELDS = ["curriculum_version", "lesson_progress", "skill_stats", "pair_stats", "attempts", "assessment_history", "active_session", "daily_summary", "achievements", "placement_stage", "placement_done", "self_checks", "learning"];
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
}
function fields(value, allowed, label) {
  object(value, label);
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error(`Unknown field on ${label}`);
}
function version(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid curriculum version");
  return value;
}
function identity(raw) {
  if (typeof raw.course_id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(raw.course_id)) throw new Error("Missing or invalid course identity");
  return { course_id: raw.course_id, curriculum_version: version(raw.curriculum_version) };
}
function stripIdentity(raw) {
  const { course_id, curriculum_version, ...rest } = raw;
  return rest;
}
export function validateEvent(raw) {
  const { code, ...rest } = raw;
  const event = legacy.validateEvent(rest);
  if (code !== undefined) {
    if (typeof code !== "string" || code.length > 32) throw new Error("Invalid physical key code");
    event.code = code;
  }
  return event;
}
export function validateAttempt(raw) {
  const metadata = identity(raw);
  const copy = stripIdentity(raw);
  // Physical position is optional and never changes produced-character scoring.
  const events = (copy.events ?? []).map(validateEvent);
  copy.events = events.map(({ key, ms }) => ({ key, ms }));
  const attempt = legacy.validateAttempt(copy);
  return { ...attempt, events, ...metadata };
}
export function validateResult(raw) {
  return { ...legacy.validateResult(stripIdentity(raw)), ...identity(raw) };
}
export function validateCourseProgress(raw, courseId, owner) {
  fields(raw, COURSE_FIELDS, "Course progress");
  const curriculumVersion = version(raw.curriculum_version ?? 2);
  const copy = structuredClone(raw);
  const records = [...(copy.attempts ?? []), ...(copy.assessment_history ?? [])];
  if (copy.active_session) records.push(copy.active_session);
  for (const record of records) {
    identity(record);
    if (record.course_id !== courseId) throw new Error("Course identity mismatch");
  }
  if (copy.active_session && (copy.active_session.owner !== owner || copy.active_session.curriculum_version !== curriculumVersion)) throw new Error("Active attempt owner or curriculum mismatch");
  const attempts = (copy.attempts ?? []).map(validateResult);
  const history = (copy.assessment_history ?? []).map(validateResult);
  const active = copy.active_session == null ? null : validateAttempt(copy.active_session);
  copy.attempts = attempts.map(stripIdentity);
  copy.assessment_history = history.map(stripIdentity);
  copy.active_session = active ? stripIdentity({ ...active, events: active.events.map(({key, ms}) => ({key, ms})) }) : null;
  copy.curriculum_version = 2;
  const checked = legacy.validateLearner({ ...copy, id: owner, settings: { name: "validation" } });
  delete checked.id; delete checked.settings;
  return { ...checked, curriculum_version: curriculumVersion, attempts, assessment_history: history, active_session: active };
}
export function courseView(profile, courseId = "en-qwerty") {
  const progress = profile.courses[courseId];
  if (!progress) throw new Error("Start this course before practicing");
  const view = { id: profile.id, courses: profile.courses };
  Object.defineProperty(view, "settings", { enumerable: true, get: () => profile.settings, set: (value) => { profile.settings = value; } });
  for (const key of COURSE_FIELDS) Object.defineProperty(view, key, { enumerable: true, get: () => progress[key], set: (value) => { progress[key] = value; } });
  return view;
}
// Explicit English-only in-process aliases; never serialized or dual-written.
function englishAliases(profile) {
  for (const key of COURSE_FIELDS) Object.defineProperty(profile, key, { configurable: true, get: () => profile.courses["en-qwerty"]?.[key], set: (value) => { profile.courses["en-qwerty"][key] = value; } });
  return profile;
}
export function validateLearner(raw) {
  fields(raw, ["id", "settings", "courses"], "Learner");
  if (typeof raw.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(raw.id)) throw new Error("Invalid profile ID");
  object(raw.courses, "Courses");
  const courses = {};
  for (const [courseId, progress] of Object.entries(raw.courses)) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(courseId)) throw new Error("Invalid course ID");
    Object.defineProperty(courses, courseId, { enumerable: true, writable: true, configurable: true, value: validateCourseProgress(progress, courseId, raw.id) });
  }
  return englishAliases({ id: raw.id, settings: validateSettings(raw.settings), courses });
}
export function emptyCourse(curriculumVersion = 2) {
  const raw = legacy.emptyLearner({ id: "new", settings: {name: "new"} });
  delete raw.id; delete raw.settings;
  return { ...raw, curriculum_version: curriculumVersion };
}
export function emptyLearner(partial = {}) {
  if (partial.courses) return validateLearner({ id: partial.id ?? uid(), settings: partial.settings, courses: partial.courses });
  const old = legacy.emptyLearner(partial), { id, settings, ...progress } = old;
  const v = progress.curriculum_version;
  for (const record of [...progress.attempts, ...progress.assessment_history, ...(progress.active_session ? [progress.active_session] : [])]) Object.assign(record, { course_id: "en-qwerty", curriculum_version: v });
  return validateLearner({ id, settings, courses: { "en-qwerty": progress } });
}
export function emptyState() { return { schema_version: 2, revision: 0, updated_at: now(), profiles: {} }; }
export function validateState(raw) {
  fields(raw, ["schema_version", "revision", "updated_at", "profiles"], "State");
  if (raw.schema_version !== 2) throw new Error("Unsupported household schema; reload a compatible release");
  object(raw.profiles, "Profiles");
  const shell = legacy.validateState({ schema_version: 1, revision: raw.revision, updated_at: raw.updated_at, profiles: {} });
  if (Object.keys(raw.profiles).length > 50) throw new Error("profiles cannot exceed 50");
  const profiles = {};
  for (const [id, value] of Object.entries(raw.profiles)) {
    const profile = validateLearner(value);
    if (profile.id !== id) throw new Error("Profile ID mismatch");
    Object.defineProperty(profiles, id, { enumerable: true, writable: true, configurable: true, value: profile });
  }
  return { ...shell, schema_version: 2, profiles };
}
export function validatePending(raw) {
  fields(raw, ["format", "attempt", "checkpoint", "finish"], "Pending attempt");
  if ((raw.format ?? "hearth-pending-v1") === "hearth-pending-v1") {
    if (raw.attempt?.course_id && raw.attempt.course_id !== "en-qwerty") throw new Error("Legacy pending work belongs only to English");
    // Version is assigned from matching saved attempt by the operation, never selection.
    const checked = legacy.validatePending({ ...raw, attempt: stripIdentity(raw.attempt) });
    return { ...checked, attempt: { ...checked.attempt, course_id: "en-qwerty", curriculum_version: raw.attempt.curriculum_version ?? 2 } };
  }
  if (raw.format !== "hearth-pending-v2") throw new Error("Unsupported pending-attempt format");
  const attempt = validateAttempt(raw.attempt);
  const checked = legacy.validatePending({ ...raw, format: "hearth-pending-v1", attempt: stripIdentity({ ...attempt, events: attempt.events.map(({key, ms}) => ({key, ms})) }), checkpoint: { ...raw.checkpoint, events: raw.checkpoint.events.map(({key, ms}) => ({key, ms})) } });
  return { ...checked, format: "hearth-pending-v2", attempt, checkpoint: { ...checked.checkpoint, events: raw.checkpoint.events.map(validateEvent) } };
}
export function parseImport(raw) {
  if (typeof raw !== "string") throw new Error("Import must be text");
  let payload = JSON.parse(raw);
  if (["hearth-pre-courses-v1", "hearth-pre-courses-import-v1"].includes(payload?.format)) {
    const source=payload.raw ?? payload.source_json;
    if(typeof source !== "string" || sha256Hex(source) !== payload.checksum) throw new Error("Snapshot verification failed");
    if(payload.format === "hearth-pre-courses-v1") {
      const originals=JSON.parse(source);
      if(canonical(originals) !== canonical(payload.originals)) throw new Error("Snapshot verification failed");
      payload=originals.current;
    } else payload=JSON.parse(source);
  }
  return upgradeState(payload);
}
