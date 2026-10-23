

const AVATARS = new Set(["🌿", "🦊", "🐳", "🌙", "🌻", "🐢"]);
const BANDS = new Set(["child", "adult"]);
const THEMES = new Set(["system", "light", "dark"]);
const FONTS = new Set(["default", "readable"]);
const KINDS = new Set([
  "lesson",
  "review",
  "custom",
  "assessment",
  "placement",
  "challenge",
  "familiar",
  "finger",
]);
const MODES = new Set(["guided", "fluent"]);
const STATUSES = new Set(["ready", "running", "paused", "completed", "abandoned"]);
const PROGRESS_STATUSES = new Set(["completed", "skipped"]);
const PROFILE_ID = /^[A-Za-z0-9_-]+$/;
const TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const STATE_FIELDS = ["schema_version", "revision", "updated_at", "profiles"];
const SETTINGS_FIELDS = [
  "name",
  "avatar",
  "band",
  "daily_minutes",
  "speed_goal",
  "assessment_seconds",
  "timezone",
  "layout",
  "theme",
  "hints",
  "sound",
  "reduced_motion",
  "font_size",
  "short_exercises",
  "font",
  "quiet_practice", "backup_reminder",
];
const EVENT_FIELDS = ["key", "ms"];
const ATTEMPT_FIELDS = [
  "id",
  "owner",
  "lesson_id",
  "kind",
  "text",
  "version",
  "mode",
  "status",
  "events",
  "elapsed_ms",
  "paused",
  "duration",
  "started_at",
  "placement_stage",
  "finger",
  "phase",
  "instruction",
  "title",
];
const SCORE_FIELDS = [
  "accuracy",
  "wpm",
  "first_attempted",
  "first_correct",
  "wrong",
  "corrections",
  "correct_characters",
  "complete",
  "elapsed_ms",
  "buffer",
];
const RESULT_FIELDS = [
  "id",
  "lesson_id",
  "kind",
  "score",
  "passed",
  "date",
  "duration",
  "paused",
  "text_digest",
  "self_check",
  "finger",
  "title",
];
const PROGRESS_FIELDS = ["status", "best_accuracy", "best_wpm"];
const SKILL_FIELDS = [
  "samples",
  "errors",
  "substitutions",
  "exercises",
  "first_success",
  "secure",
  "interval",
  "due",
  "latency_total",
  "latency_samples",
];
const DAILY_FIELDS = ["milliseconds", "attempts"];
const LEARNER_FIELDS = [
  "id",
  "settings",
  "curriculum_version",
  "lesson_progress",
  "skill_stats",
  "pair_stats",
  "attempts",
  "assessment_history",
  "active_session",
  "daily_summary",
  "achievements",
  "placement_stage",
  "placement_done",
  "self_checks",
  "learning",
];

export const clock = {
  now() {
    return new Date().toISOString().replace("Z", "+00:00");
  },
};

export function now() {
  return clock.now();
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  throw new Error("crypto.randomUUID is required");
}

function forbidExtra(obj, allowed, label) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new Error(`Unknown field '${key}' on ${label}`);
    }
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, name) {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value;
}

function optionalString(value, name) {
  if (value == null) return null;
  return requireString(value, name);
}

function requireBool(value, name, fallback) {
  if (value === undefined) {
    if (arguments.length < 3) throw new Error(`${name} must be a boolean`);
    return fallback;
  }
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`);
  return value;
}

function requireInt(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function optionalInt(value, min, max, name, fallback) {
  if (value === undefined) return fallback;
  if (value === null) return null;
  return requireInt(value, min, max, name);
}

function requireNumber(value, name) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`${name} must be a number`);
  }
  return value;
}

function timestamp(value, name) {
  if (typeof value !== "string" || !TIMESTAMP.test(value)) {
    throw new Error(`${name} must be a timezone-aware timestamp`);
  }
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${name} must be a timezone-aware timestamp`);
  }
  return value;
}

function optionalTimestamp(value, name) {
  if (value == null) return null;
  return timestamp(value, name);
}

function validTimezone(value) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function validateSettings(raw) {
  if (!isObject(raw)) throw new Error("Settings must be an object");
  forbidExtra(raw, SETTINGS_FIELDS, "Settings");
  const name = requireString(raw.name, "name");
  if (name.length < 1 || name.length > 32) {
    throw new Error("name must be 1-32 characters");
  }
  const avatar = raw.avatar ?? "🌿";
  if (!AVATARS.has(avatar)) throw new Error("Unknown avatar");
  const band = raw.band ?? "child";
  if (!BANDS.has(band)) throw new Error("band must be child or adult");
  const timezone = raw.timezone ?? "UTC";
  if (typeof timezone !== "string" || !validTimezone(timezone)) {
    throw new Error("Unknown timezone");
  }
  const layout = raw.layout ?? "US QWERTY";
  if (layout !== "US QWERTY") throw new Error('layout must be "US QWERTY"');
  const theme = raw.theme ?? "system";
  if (!THEMES.has(theme)) throw new Error("theme must be system, light, or dark");
  const font = raw.font ?? "default";
  if (!FONTS.has(font)) throw new Error("font must be default or readable");
  return {
    name,
    avatar,
    band,
    daily_minutes: requireInt(raw.daily_minutes ?? 5, 1, 60, "daily_minutes"),
    speed_goal: requireInt(raw.speed_goal ?? 40, 10, 120, "speed_goal"),
    assessment_seconds: requireInt(
      raw.assessment_seconds ?? 180,
      30,
      300,
      "assessment_seconds",
    ),
    timezone,
    layout,
    theme,
    hints: requireBool(raw.hints, "hints", true),
    sound: requireBool(raw.sound, "sound", false),
    reduced_motion: requireBool(raw.reduced_motion, "reduced_motion", false),
    font_size: requireInt(raw.font_size ?? 24, 18, 40, "font_size"),
    short_exercises: requireBool(raw.short_exercises, "short_exercises", true),
    font,
    quiet_practice: requireBool(raw.quiet_practice, "quiet_practice", false),
    backup_reminder: requireBool(raw.backup_reminder, "backup_reminder", false),
  };
}

export function validateEvent(raw) {
  if (!isObject(raw)) throw new Error("Event must be an object");
  forbidExtra(raw, EVENT_FIELDS, "Event");
  const key = requireString(raw.key, "key");
  if (key.length < 1 || key.length > 12) {
    throw new Error("key must be 1-12 characters");
  }
  return { key, ms: requireInt(raw.ms, 0, 3_600_000, "ms") };
}

function validateEvents(events) {
  if (!Array.isArray(events)) throw new Error("events must be a list");
  if (events.length > 50000) throw new Error("events cannot exceed 50000");
  return events.map(validateEvent);
}

export function validateAttempt(raw) {
  if (!isObject(raw)) throw new Error("Attempt must be an object");
  forbidExtra(raw, ATTEMPT_FIELDS, "Attempt");
  const owner = requireString(raw.owner, "owner");
  const text = requireString(raw.text, "text");
  if (text.length < 1 || text.length > 30000) {
    throw new Error("text must be 1-30000 characters");
  }
  const kind = raw.kind ?? "lesson";
  if (!KINDS.has(kind)) throw new Error("Unknown attempt kind");
  const mode = raw.mode ?? "guided";
  if (!MODES.has(mode)) throw new Error("mode must be guided or fluent");
  const status = raw.status ?? "ready";
  if (!STATUSES.has(status)) throw new Error("Unknown attempt status");
  const instruction = optionalString(raw.instruction, "instruction");
  if (instruction && instruction.length > 400) {
    throw new Error("instruction must be at most 400 characters");
  }
  const title = optionalString(raw.title, "title");
  if (title && title.length > 80) {
    throw new Error("title must be at most 80 characters");
  }
  return {
    id: raw.id === undefined ? uid() : requireString(raw.id, "id"),
    owner,
    lesson_id: optionalString(raw.lesson_id, "lesson_id"),
    kind,
    text,
    version: requireInt(raw.version ?? 1, 1, Number.MAX_SAFE_INTEGER, "version"),
    mode,
    status,
    events: validateEvents(raw.events ?? []),
    elapsed_ms: requireInt(raw.elapsed_ms ?? 0, 0, 3_600_000, "elapsed_ms"),
    paused: requireBool(raw.paused, "paused", false),
    duration: optionalInt(raw.duration, 30, 300, "duration", null),
    started_at: timestamp(raw.started_at ?? now(), "started_at"),
    placement_stage: requireInt(raw.placement_stage ?? 0, 0, 4, "placement_stage"),
    finger: optionalString(raw.finger, "finger"),
    phase: requireInt(raw.phase ?? 0, 0, 4, "phase"),
    instruction,
    title,
  };
}

function validateScore(raw) {
  if (!isObject(raw)) throw new Error("Score must be an object");
  forbidExtra(raw, SCORE_FIELDS, "Score");
  return {
    accuracy: requireNumber(raw.accuracy, "accuracy"),
    wpm: raw.wpm == null ? null : requireNumber(raw.wpm, "wpm"),
    first_attempted: requireInt(raw.first_attempted, 0, Number.MAX_SAFE_INTEGER, "first_attempted"),
    first_correct: requireInt(raw.first_correct, 0, Number.MAX_SAFE_INTEGER, "first_correct"),
    wrong: requireInt(raw.wrong, 0, Number.MAX_SAFE_INTEGER, "wrong"),
    corrections: requireInt(raw.corrections, 0, Number.MAX_SAFE_INTEGER, "corrections"),
    correct_characters: requireInt(
      raw.correct_characters,
      0,
      Number.MAX_SAFE_INTEGER,
      "correct_characters",
    ),
    complete: requireBool(raw.complete, "complete"),
    elapsed_ms: requireInt(raw.elapsed_ms, 0, Number.MAX_SAFE_INTEGER, "elapsed_ms"),
    buffer: requireString(raw.buffer, "buffer"),
  };
}

export function validateResult(raw) {
  if (!isObject(raw)) throw new Error("Result must be an object");
  forbidExtra(raw, RESULT_FIELDS, "Result");
  return {
    id: requireString(raw.id, "id"),
    lesson_id: optionalString(raw.lesson_id, "lesson_id"),
    kind: requireString(raw.kind, "kind"),
    score: validateScore(raw.score),
    passed: requireBool(raw.passed, "passed"),
    date: timestamp(raw.date ?? now(), "date"),
    duration: optionalInt(raw.duration, 30, 300, "duration", null),
    paused: requireBool(raw.paused, "paused", false),
    text_digest: requireString(raw.text_digest, "text_digest"),
    self_check: optionalString(raw.self_check, "self_check"),
    finger: optionalString(raw.finger, "finger"),
    title: optionalString(raw.title, "title"),
  };
}

function validateProgress(raw) {
  if (!isObject(raw)) throw new Error("LessonProgress must be an object");
  forbidExtra(raw, PROGRESS_FIELDS, "LessonProgress");
  if (!PROGRESS_STATUSES.has(raw.status)) {
    throw new Error("LessonProgress status must be completed or skipped");
  }
  return {
    status: raw.status,
    best_accuracy: requireNumber(raw.best_accuracy ?? 0, "best_accuracy"),
    best_wpm: raw.best_wpm == null ? null : requireNumber(raw.best_wpm, "best_wpm"),
  };
}

function validateSubstitutions(raw) {
  if (!isObject(raw)) throw new Error("substitutions must be an object");
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    Object.defineProperty(out, key, {enumerable:true, writable:true, configurable:true, value:requireInt(value, 0, Number.MAX_SAFE_INTEGER, "substitution count")});
  }
  return out;
}

export function emptySkill() {
  return {
    samples: 0,
    errors: 0,
    substitutions: {},
    exercises: [],
    first_success: null,
    secure: false,
    interval: 0,
    due: now(),
    latency_total: 0,
    latency_samples: 0,
  };
}

function validateSkill(raw) {
  if (!isObject(raw)) throw new Error("Skill must be an object");
  forbidExtra(raw, SKILL_FIELDS, "Skill");
  const exercises = raw.exercises ?? [];
  if (!Array.isArray(exercises) || exercises.some((item) => typeof item !== "string")) {
    throw new Error("exercises must be a list of strings");
  }
  return {
    samples: requireInt(raw.samples ?? 0, 0, Number.MAX_SAFE_INTEGER, "samples"),
    errors: requireInt(raw.errors ?? 0, 0, Number.MAX_SAFE_INTEGER, "errors"),
    substitutions: validateSubstitutions(raw.substitutions ?? {}),
    exercises: [...exercises],
    first_success: optionalTimestamp(raw.first_success, "first_success"),
    secure: requireBool(raw.secure, "secure", false),
    interval: requireInt(raw.interval ?? 0, 0, Number.MAX_SAFE_INTEGER, "interval"),
    due: timestamp(raw.due ?? now(), "due"),
    latency_total: requireInt(
      raw.latency_total ?? 0,
      0,
      Number.MAX_SAFE_INTEGER,
      "latency_total",
    ),
    latency_samples: requireInt(
      raw.latency_samples ?? 0,
      0,
      Number.MAX_SAFE_INTEGER,
      "latency_samples",
    ),
  };
}

function validateSkillMap(raw, name) {
  if (!isObject(raw)) throw new Error(`${name} must be an object`);
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    Object.defineProperty(out, key, {enumerable:true, writable:true, configurable:true, value:validateSkill(value)});
  }
  return out;
}

function validateProgressMap(raw) {
  if (!isObject(raw)) throw new Error("lesson_progress must be an object");
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    Object.defineProperty(out, key, {enumerable:true, writable:true, configurable:true, value:validateProgress(value)});
  }
  return out;
}

function validateDaily(raw) {
  if (!isObject(raw)) throw new Error("Daily must be an object");
  forbidExtra(raw, DAILY_FIELDS, "Daily");
  return {
    milliseconds: requireInt(
      raw.milliseconds ?? 0,
      0,
      Number.MAX_SAFE_INTEGER,
      "milliseconds",
    ),
    attempts: requireInt(raw.attempts ?? 0, 0, Number.MAX_SAFE_INTEGER, "attempts"),
  };
}

function validateDailyMap(raw) {
  if (!isObject(raw)) throw new Error("daily_summary must be an object");
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    Object.defineProperty(out, key, {enumerable:true, writable:true, configurable:true, value:validateDaily(value)});
  }
  return out;
}

function validateSelfChecks(raw) {
  if (!isObject(raw)) throw new Error("self_checks must be an object");
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    Object.defineProperty(out, key, {enumerable:true, writable:true, configurable:true, value:requireString(value, "self-check note")});
  }
  return out;
}

export function validateLearning(raw = {}) {
  if (!isObject(raw)) throw new Error("Learning data must be an object");
  forbidExtra(raw, ["passages", "custom_draft", "onboarding_done", "correction_done"], "Learning data");
  const passages = raw.passages ?? [];
  if (!Array.isArray(passages) || passages.length > 20) throw new Error("Save at most 20 passages");
  const out = passages.map((p) => {
    if (!isObject(p)) throw new Error("Passage must be an object");
    forbidExtra(p, ["id", "title", "text", "favorite"], "Passage");
    const id = requireString(p.id ?? uid(), "Passage ID"), title = requireString(p.title, "Passage title"), text = requireString(p.text, "Passage text");
    if (!id.length || id.length > 80 || !title.length || title.length > 80 || !text.length || text.length > 10000)
      throw new Error("Use a title of 1–80 characters and a passage of 1–10,000 characters");
    return { id, title, text, favorite: requireBool(p.favorite, "favorite", false) };
  });
  if (new Set(out.map((p) => p.id)).size !== out.length) throw new Error("Duplicate passage ID");
  if (out.reduce((n, p) => n + p.text.length, 0) > 100000) throw new Error("Passage library exceeds 100,000 characters");
  const draft = requireString(raw.custom_draft ?? "", "Custom draft");
  if (draft.length > 10000) throw new Error("Draft exceeds 10,000 characters");
  return { passages: out, custom_draft: draft,
    onboarding_done: requireBool(raw.onboarding_done, "onboarding_done", false),
    correction_done: requireBool(raw.correction_done, "correction_done", false) };
}

export function validatePending(raw) {
  if (!isObject(raw)) throw new Error("Choose a pending-attempt export");
  forbidExtra(raw, ["format", "attempt", "checkpoint", "finish"], "Pending attempt");
  if (raw.format !== undefined && raw.format !== "hearth-pending-v1") throw new Error("Unsupported pending-attempt format");
  const attempt = validateAttempt(raw.attempt), cp = raw.checkpoint;
  if (!isObject(cp)) throw new Error("Missing checkpoint");
  forbidExtra(cp, ["events", "elapsed_ms", "status", "paused"], "Checkpoint");
  if (!["running", "paused"].includes(cp.status)) throw new Error("Invalid checkpoint status");
  return { format: "hearth-pending-v1", attempt, finish: requireBool(raw.finish, "finish", false),
    checkpoint: { events: validateEvents(cp.events), elapsed_ms: requireInt(cp.elapsed_ms, 0, 3600000, "elapsed_ms"), status: cp.status, paused: requireBool(cp.paused, "paused", false) } };
}

export function validateLearner(raw) {
  if (!isObject(raw)) throw new Error("Learner must be an object");
  forbidExtra(raw, LEARNER_FIELDS, "Learner");
  const attempts = raw.attempts ?? [];
  if (!Array.isArray(attempts)) throw new Error("attempts must be a list");
  if (attempts.length > 1000) throw new Error("attempts cannot exceed 1000");
  const history = raw.assessment_history ?? [];
  if (!Array.isArray(history)) throw new Error("assessment_history must be a list");
  const achievements = raw.achievements ?? [];
  if (!Array.isArray(achievements) || achievements.some((item) => typeof item !== "string")) {
    throw new Error("achievements must be a list of strings");
  }
  const id = raw.id === undefined ? uid() : requireString(raw.id, "id");
  if (!id || !PROFILE_ID.test(id)) throw new Error("Invalid profile ID");
  const active =
    raw.active_session == null ? null : validateAttempt(raw.active_session);
  return {
    id,
    settings: validateSettings(raw.settings),
    curriculum_version: requireInt(raw.curriculum_version ?? 2, 1, 2, "curriculum_version"),
    lesson_progress: validateProgressMap(raw.lesson_progress ?? {}),
    skill_stats: validateSkillMap(raw.skill_stats ?? {}, "skill_stats"),
    pair_stats: validateSkillMap(raw.pair_stats ?? {}, "pair_stats"),
    attempts: attempts.map(validateResult),
    assessment_history: history.map(validateResult),
    active_session: active,
    daily_summary: validateDailyMap(raw.daily_summary ?? {}),
    achievements: [...achievements],
    placement_stage: requireInt(raw.placement_stage ?? 0, 0, 4, "placement_stage"),
    placement_done: requireBool(raw.placement_done, "placement_done", false),
    self_checks: validateSelfChecks(raw.self_checks ?? {}),
    learning: validateLearning(raw.learning),
  };
}

export function emptyLearner(partial = {}) {
  return validateLearner({
    id: partial.id,
    settings: partial.settings,
    curriculum_version: partial.curriculum_version,
    lesson_progress: partial.lesson_progress,
    skill_stats: partial.skill_stats,
    pair_stats: partial.pair_stats,
    attempts: partial.attempts,
    assessment_history: partial.assessment_history,
    active_session: partial.active_session,
    daily_summary: partial.daily_summary,
    achievements: partial.achievements,
    placement_stage: partial.placement_stage,
    placement_done: partial.placement_done,
    self_checks: partial.self_checks,
    learning: partial.learning,
  });
}

export function emptyState() {
  return validateState({
    schema_version: 1,
    revision: 0,
    updated_at: now(),
    profiles: {},
  });
}

export function validateState(raw) {
  if (!isObject(raw)) throw new Error("State must be an object");
  forbidExtra(raw, STATE_FIELDS, "State");
  if ((raw.schema_version ?? 1) !== 1) {
    throw new Error("schema_version must be 1");
  }
  const profilesRaw = raw.profiles ?? {};
  if (!isObject(profilesRaw)) throw new Error("profiles must be an object");
  const keys = Object.keys(profilesRaw);
  if (keys.length > 50) throw new Error("profiles cannot exceed 50");
  const profiles = {};
  for (const key of keys) {
    if (!key || !PROFILE_ID.test(key)) throw new Error("Invalid profile ID");
    const learner = validateLearner(profilesRaw[key]);
    if (key !== learner.id) throw new Error("Profile ID mismatch");
    if (learner.active_session && learner.active_session.owner !== key) {
      throw new Error("Attempt owner mismatch");
    }
    Object.defineProperty(profiles, key, {enumerable:true, writable:true, configurable:true, value:learner});
  }
  return {
    schema_version: 1,
    revision: requireInt(raw.revision ?? 0, 0, Number.MAX_SAFE_INTEGER, "revision"),
    updated_at: timestamp(raw.updated_at ?? now(), "updated_at"),
    profiles,
  };
}

export function parseImport(raw) {
  if (typeof raw !== "string") throw new Error("Import must be text");
  if (new TextEncoder().encode(raw).length > 10_000_000) {
    throw new Error("Import exceeds 10 MB");
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    throw new Error(error.message || "Invalid JSON");
  }
  const state = validateState(payload);
  return state;
}
