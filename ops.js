import { defaultRuntime } from "./course-runtime.js";
import { getCourse } from "./course-registry.js";
import { validateTarget } from "./input-policy.js";
import { Conflict, Unchanged } from "./errors.js";
import { emptyLearner, emptyCourse, courseView, now, uid, validateSettings, validateLearning, validatePending } from "./validate.js";
import { createScoring } from "./scoring.js";
import { normalizeText, repeatText, shorterLessonText } from "./text.js";


export function createOperations(runtime) {
const courseId = runtime.data.id;
const { COURSE, BY_ID, POOLS, available, fingerInstruction, fingerTitle, nextLesson, taught } = runtime;
const { familiarText, fingerReport, fingerText, finish, proficiency, recommendation, reviewText, score } = createScoring(runtime);
function learner(state, profileId) {
  if (!(profileId in state.profiles)) throw new Error("Learner not found");
  const view = courseView(state.profiles[profileId], courseId);
  if (view.curriculum_version !== runtime.data.version) throw new Error("Course curriculum mismatch");
  return view;
}

function createProfile(state, settings) {
  const profile = emptyLearner({ settings: validateSettings(settings) });
  state.profiles[profile.id] = profile;
}

function updateProfile(state, profileId, settings) {
  if (!state.profiles[profileId]) throw new Error("Learner not found");
  state.profiles[profileId].settings = validateSettings(settings);
}

function updateLearning(state, id, patch) {
  const p = learner(state, id);
  p.learning = validateLearning({ ...p.learning, ...patch });
}

function restorePending(state, raw) {
  const pending = validatePending(raw), incoming = pending.attempt;
  if (incoming.course_id !== courseId) throw new Conflict("Pending course mismatch");
  if (pending.format === "hearth-pending-v1") {
    const savedAttempt = state.profiles[incoming.owner]?.courses["en-qwerty"]?.active_session;
    if (savedAttempt?.id === incoming.id) incoming.curriculum_version = savedAttempt.curriculum_version;
  }
  if (alreadyFinished(state, incoming.owner, incoming.id)) throw new Unchanged();
  const saved = active(learner(state, incoming.owner), incoming.id);
  for (const key of Object.keys(saved)) {
    if (["events", "elapsed_ms", "status", "paused"].includes(key)) continue;
    if (JSON.stringify(saved[key]) !== JSON.stringify(incoming[key]))
      throw new Conflict("Pending exercise identity does not match saved practice");
  }
  if (pending.finish) finishAttempt(state, incoming.owner, incoming.id, pending.checkpoint);
  else checkpointAttempt(state, incoming.owner, incoming.id, pending.checkpoint);
}

function manageProfile(state, profileId, action) {
  const profile = state.profiles[profileId];
  if (!profile) throw new Error("Learner not found");
  if (action === "reset") {
    state.profiles[profileId] = emptyLearner({ id: profileId, settings: profile.settings, courses: Object.fromEntries(Object.entries(profile.courses).map(([key, value]) => [key, { ...emptyCourse(value.curriculum_version), learning: value.learning }])) });
  } else {
    delete state.profiles[profileId];
  }
}

function recommendationPayload(profile) {
  const [keys, explanation] = recommendation(profile);
  const following = nextLesson(profile);
  const fingers = fingerReport(profile);
  return {
    keys,
    explanation,
    next: following ? following.id : null,
    taught: taught(profile),
    proficient: proficiency(profile),
    fingers,
    weak_fingers: fingers.filter((item) => item.weak),
  };
}

function applyPlacement(state, profileId) {
  const profile = learner(state, profileId);
  if (profile.active_session) throw new Conflict("Finish or abandon placement first");
  const limit = runtime.data.placement_limits[profile.placement_stage];
  for (const lesson of COURSE.slice(0, limit)) {
    if (!(lesson.id in profile.lesson_progress)) {
      profile.lesson_progress[lesson.id] = {
        status: "skipped",
        best_accuracy: 0,
        best_wpm: null,
      };
    }
  }
}

function skipLesson(state, profileId, lessonId) {
  const profile = learner(state, profileId);
  if (!(lessonId in BY_ID) || !available(profile, BY_ID[lessonId])) {
    throw new Error("Skip prerequisites in order");
  }
  if (!(lessonId in profile.lesson_progress)) {
    profile.lesson_progress[lessonId] = {
      status: "skipped",
      best_accuracy: 0,
      best_wpm: null,
    };
  }
}

function selfCheck(state, profileId, lessonId, note) {
  const profile = learner(state, profileId);
  if (!(lessonId in BY_ID)) throw new Error("Unknown lesson");
  profile.self_checks[lessonId] = note;
  for (let i = profile.attempts.length - 1; i >= 0; i--) {
    if (profile.attempts[i].lesson_id === lessonId) {
      profile.attempts[i].self_check = note;
      break;
    }
  }
}

function printableCustom(text) {
  for (const character of text) {
    const code = character.codePointAt(0);
    if (character !== "\n" && !(code >= 32 && code <= 126)) return false;
  }
  return true;
}

function startAttempt(
  state,
  profileId,
  {
    kind = "lesson",
    lesson_id: lessonId = null,
    keys = "",
    text = "",
    shorter = false,
    finger = "",
    phase = 0,
  } = {},
) {
  const profile = learner(state, profileId);
  if (profile.active_session) {
    throw new Conflict("Resume or abandon the active exercise first");
  }
  const attempt = {
    id: uid(),
    owner: profileId,
    course_id: courseId,
    curriculum_version: runtime.data.version,
    lesson_id: null,
    kind,
    text: "f",
    version: 1,
    mode: "guided",
    status: "ready",
    events: [],
    elapsed_ms: 0,
    paused: false,
    duration: null,
    started_at: now(),
    placement_stage: 0,
    finger: null,
    phase: 0,
    instruction: null,
    title: null,
  };
  if (kind === "lesson") {
    if (!(lessonId in BY_ID)) throw new Error("Unknown lesson");
    const lesson = BY_ID[lessonId];
    if (!available(profile, lesson)) {
      throw new Error("Complete or explicitly skip prerequisites first");
    }
    attempt.lesson_id = lesson.id;
    attempt.text = profile.settings.band === "adult" ? lesson.adult_text : lesson.text;
    if (shorter) {
      attempt.text = shorterLessonText(attempt.text);
      attempt.mode = "guided";
    } else {
      if (!profile.settings.short_exercises) attempt.text = repeatText(attempt.text, 2);
      attempt.mode = lesson.mode;
    }
  } else if (kind === "custom") {
    validateTarget(text, runtime.data.allowed_characters);
    attempt.text = text;
    attempt.mode = "fluent";
  } else if (kind === "assessment" || kind === "challenge") {
    if (kind === "challenge" && Object.keys(profile.lesson_progress).length !== COURSE.length) {
      throw new Error("The calm challenge opens after the course");
    }
    const pool =
      profile.settings.band === "adult" ? POOLS.assessment_adult : POOLS.assessment_child;
    const index = profile.assessment_history.length % pool.length;
    attempt.text = (pool[index] + "\n" + pool[(index + 1) % pool.length] + "\n").repeat(30).slice(0, 30000);
    attempt.mode = "fluent";
    attempt.duration = profile.settings.assessment_seconds;
  } else if (kind === "placement") {
    if (profile.placement_done) {
      throw new Error(
        "Placement is complete; follow the recommendation or start at the beginning",
      );
    }
    attempt.text = runtime.data.placement_samples[profile.placement_stage];
    attempt.placement_stage = profile.placement_stage;
    attempt.mode = "fluent";
  } else if (kind === "familiar") {
    attempt.text = familiarText(profile, attempt.id);
    attempt.mode = "fluent";
  } else if (kind === "finger") {
    attempt.finger = finger;
    attempt.phase = phase;
    attempt.title = fingerTitle(finger, phase);
    attempt.instruction = fingerInstruction(finger);
    attempt.text = fingerText(profile, finger, attempt.id, phase);
    attempt.mode = "guided";
  } else {
    const chosen = keys || recommendation(profile)[0];
    attempt.text = reviewText(profile, chosen, attempt.id);
  }
  attempt.text = normalizeText(attempt.text);
  if (!attempt.text) throw new Error("Add some words or letters to practice");
  validateTarget(attempt.text, runtime.data.allowed_characters);
  profile.active_session = attempt;
}

function active(profile, attemptId) {
  const attempt = profile.active_session;
  if (!attempt || attempt.id !== attemptId || attempt.owner !== profile.id) {
    throw new Conflict("This attempt is no longer active for this learner");
  }
  if (attempt.course_id !== courseId || attempt.curriculum_version !== runtime.data.version) throw new Conflict("Attempt course or curriculum mismatch");
  return attempt;
}

function alreadyFinished(state, profileId, attemptId) {
  const profile = learner(state, profileId);
  return profile.attempts.concat(profile.assessment_history).some((result) => result.id === attemptId);
}

function eventsPrefixMatch(saved, incoming) {
  if (incoming.length < saved.length) return false;
  for (let i = 0; i < saved.length; i++) {
    if (saved[i].key !== incoming[i].key || saved[i].ms !== incoming[i].ms || (saved[i].code ?? null) !== (incoming[i].code ?? null)) return false;
  }
  return true;
}

function applyCheckpoint(attempt, body) {
  if (!eventsPrefixMatch(attempt.events, body.events)) {
    throw new Conflict("Checkpoint history does not match. Reload the saved attempt.");
  }
  if (body.elapsed_ms < attempt.elapsed_ms) {
    throw new Error("Elapsed time cannot go backwards");
  }
  attempt.events = body.events;
  attempt.elapsed_ms = body.elapsed_ms;
  attempt.status = body.status;
  attempt.paused = attempt.paused || body.paused;
  score(attempt);
}

function checkpointAttempt(state, profileId, attemptId, body) {
  applyCheckpoint(active(learner(state, profileId), attemptId), body);
}

function finishAttempt(state, profileId, attemptId, body) {
  if (alreadyFinished(state, profileId, attemptId)) throw new Unchanged();
  const profile = learner(state, profileId);
  const attempt = active(profile, attemptId);
  applyCheckpoint(attempt, body);
  if (attempt.lesson_id && !BY_ID[attempt.lesson_id]) throw new Error("Historical lesson unavailable; export this exercise for recovery");
  finish(profile, attempt);
}

function abandonAttempt(state, profileId, attemptId) {
  const profile = learner(state, profileId);
  active(profile, attemptId);
  profile.active_session = null;
}

function exportState(state, profileId = null) {
  if (!profileId) return state;
  if (!state.profiles[profileId]) throw new Error("Learner not found");
  return {
    schema_version: state.schema_version,
    revision: state.revision,
    updated_at: state.updated_at,
    profiles: { [profileId]: state.profiles[profileId] },
  };
}

function importPreview(incoming, mode, target) {
  if (mode !== "household" && Object.keys(incoming.profiles).length !== 1) {
    throw new Error("Choose a single-learner for this import mode");
  }
  return {
    profiles: Object.values(incoming.profiles).map((item) => item.settings.name),
    courses: Object.values(incoming.profiles).flatMap(p => Object.entries(p.courses).map(([id,c]) => ({learner:p.settings.name,id,curriculum_version:c.curriculum_version,attempts:c.attempts.length,assessments:c.assessment_history.length,passages:c.learning.passages.length,active:c.active_session != null}))),
    mode,
    replaces: mode === "replace" ? target : mode === "household" ? "entire household" : "nothing",
  };
}

function importInto(state, incoming, mode, target) {
  if (mode !== "household" && Object.keys(incoming.profiles).length !== 1) {
    throw new Error("Choose a single-learner for this import mode");
  }
  if (mode === "household") {
    state.profiles = structuredClone(incoming.profiles);
    return;
  }
  const profile = structuredClone(Object.values(incoming.profiles)[0]);
  if (mode === "replace") {
    if (target == null) throw new Error("Choose a learner to replace");
    if (!state.profiles[target]) throw new Error("Learner not found");
    profile.id = target;
  } else {
    profile.id = uid();
  }
  for (const progress of Object.values(profile.courses)) {
    if (progress.active_session) {
      progress.active_session.owner = profile.id;
      progress.active_session.id = uid();
      progress.active_session.paused = true;
      progress.active_session.status = "paused";
    }
  }
  state.profiles[profile.id] = profile;
}

return { learner, createProfile, updateProfile, updateLearning, restorePending, manageProfile, recommendationPayload, applyPlacement, skipLesson, selfCheck, startAttempt, active, alreadyFinished, applyCheckpoint, checkpointAttempt, finishAttempt, abandonAttempt, exportState, importPreview, importInto };
}

export function operationsFor(state, owner, courseId = "en-qwerty") {
  const progress = state.profiles[owner]?.courses[courseId];
  return createOperations(getCourse(courseId, progress?.curriculum_version));
}
export const learner = (state, owner, ...args) => operationsFor(state, owner).learner(state, owner, ...args);
export const createProfile = (...args) => createOperations(defaultRuntime).createProfile(...args);
export const updateProfile = (...args) => createOperations(defaultRuntime).updateProfile(...args);
export const updateLearning = (state, owner, ...args) => operationsFor(state, owner).updateLearning(state, owner, ...args);
export const restorePending = (state, raw) => { const courseId = raw.format === "hearth-pending-v2" ? raw.attempt.course_id : "en-qwerty"; return operationsFor(state, raw.attempt.owner, courseId).restorePending(state, raw); };
export const manageProfile = (...args) => createOperations(defaultRuntime).manageProfile(...args);
export const recommendationPayload = (profile) => createOperations(getCourse("en-qwerty", profile.curriculum_version)).recommendationPayload(profile);
export const applyPlacement = (state, owner, ...args) => operationsFor(state, owner).applyPlacement(state, owner, ...args);
export const skipLesson = (state, owner, ...args) => operationsFor(state, owner).skipLesson(state, owner, ...args);
export const selfCheck = (state, owner, ...args) => operationsFor(state, owner).selfCheck(state, owner, ...args);
export const startAttempt = (state, owner, ...args) => operationsFor(state, owner).startAttempt(state, owner, ...args);
export const active = (...args) => createOperations(defaultRuntime).active(...args);
export const alreadyFinished = (state, owner, ...args) => operationsFor(state, owner).alreadyFinished(state, owner, ...args);
export const applyCheckpoint = (...args) => createOperations(defaultRuntime).applyCheckpoint(...args);
export const checkpointAttempt = (state, owner, ...args) => operationsFor(state, owner).checkpointAttempt(state, owner, ...args);
export const finishAttempt = (state, owner, ...args) => operationsFor(state, owner).finishAttempt(state, owner, ...args);
export const abandonAttempt = (state, owner, ...args) => operationsFor(state, owner).abandonAttempt(state, owner, ...args);
export const exportState = (...args) => createOperations(defaultRuntime).exportState(...args);
export const importPreview = (...args) => createOperations(defaultRuntime).importPreview(...args);
export const importInto = (...args) => createOperations(defaultRuntime).importInto(...args);
