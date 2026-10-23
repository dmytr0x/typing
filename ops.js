import { COURSE, BY_ID, POOLS, available, fingerInstruction, fingerTitle, nextLesson, taught } from "./course-runtime.js";
import { Conflict, Unchanged } from "./errors.js";
import { emptyLearner, now, uid, validateSettings, validateLearning, validatePending } from "./validate.js";
import {
  familiarText,
  fingerReport,
  fingerText,
  finish,
  proficiency,
  recommendation,
  reviewText,
  score,
} from "./scoring.js";
import { normalizeText, repeatText, shorterLessonText } from "./text.js";

const ASCII_UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const PLACEMENT_SAMPLES = [
  "fj dk sl a; gh ru ei wo qp ty vm c, x. z/ bn",
  ASCII_UPPERCASE + "\nThe Quiet Fox Jumps Over A Blue Log.\n",
  'Who said: "It is fine!"? I did; don\'t rush. ',
  "0123456789 !@#$%^&*() _+=[]{}\\|`~<> /-",
];

export function learner(state, profileId) {
  if (!(profileId in state.profiles)) throw new Error("Learner not found");
  return state.profiles[profileId];
}

export function createProfile(state, settings) {
  const profile = emptyLearner({ settings: validateSettings(settings) });
  state.profiles[profile.id] = profile;
}

export function updateProfile(state, profileId, settings) {
  learner(state, profileId).settings = validateSettings(settings);
}

export function updateLearning(state, id, patch) {
  const p = learner(state, id);
  p.learning = validateLearning({ ...p.learning, ...patch });
}

export function restorePending(state, raw) {
  const pending = validatePending(raw), incoming = pending.attempt;
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

export function manageProfile(state, profileId, action) {
  const profile = learner(state, profileId);
  if (action === "reset") {
    state.profiles[profileId] = emptyLearner({
      id: profileId,
      settings: profile.settings,
      learning: profile.learning,
    });
  } else {
    delete state.profiles[profileId];
  }
}

export function recommendationPayload(profile) {
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

export function applyPlacement(state, profileId) {
  const profile = learner(state, profileId);
  if (profile.active_session) throw new Conflict("Finish or abandon placement first");
  const limit = [0, 80, 105, 115, 140][profile.placement_stage];
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

export function skipLesson(state, profileId, lessonId) {
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

export function selfCheck(state, profileId, lessonId, note) {
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

export function startAttempt(
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
    if (!text || !printableCustom(text)) {
      throw new Error("Use printable US keyboard characters and newlines");
    }
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
    attempt.text = PLACEMENT_SAMPLES[profile.placement_stage];
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
  profile.active_session = attempt;
}

export function active(profile, attemptId) {
  const attempt = profile.active_session;
  if (!attempt || attempt.id !== attemptId || attempt.owner !== profile.id) {
    throw new Conflict("This attempt is no longer active for this learner");
  }
  return attempt;
}

export function alreadyFinished(state, profileId, attemptId) {
  const profile = learner(state, profileId);
  return profile.attempts.concat(profile.assessment_history).some((result) => result.id === attemptId);
}

function eventsPrefixMatch(saved, incoming) {
  if (incoming.length < saved.length) return false;
  for (let i = 0; i < saved.length; i++) {
    if (saved[i].key !== incoming[i].key || saved[i].ms !== incoming[i].ms) return false;
  }
  return true;
}

export function applyCheckpoint(attempt, body) {
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

export function checkpointAttempt(state, profileId, attemptId, body) {
  applyCheckpoint(active(learner(state, profileId), attemptId), body);
}

export function finishAttempt(state, profileId, attemptId, body) {
  if (alreadyFinished(state, profileId, attemptId)) throw new Unchanged();
  const profile = learner(state, profileId);
  const attempt = active(profile, attemptId);
  applyCheckpoint(attempt, body);
  finish(profile, attempt);
}

export function abandonAttempt(state, profileId, attemptId) {
  const profile = learner(state, profileId);
  active(profile, attemptId);
  profile.active_session = null;
}

export function exportState(state, profileId = null) {
  if (!profileId) return state;
  return {
    schema_version: state.schema_version,
    revision: state.revision,
    updated_at: state.updated_at,
    profiles: { [profileId]: learner(state, profileId) },
  };
}

export function importPreview(incoming, mode, target) {
  if (mode !== "household" && Object.keys(incoming.profiles).length !== 1) {
    throw new Error("Choose a single-learner export for this import mode");
  }
  return {
    profiles: Object.values(incoming.profiles).map((item) => item.settings.name),
    mode,
    replaces: mode === "replace" ? target : mode === "household" ? "entire household" : "nothing",
  };
}

export function importInto(state, incoming, mode, target) {
  if (mode !== "household" && Object.keys(incoming.profiles).length !== 1) {
    throw new Error("Choose a single-learner export for this import mode");
  }
  if (mode === "household") {
    state.profiles = incoming.profiles;
    return;
  }
  const profile = Object.values(incoming.profiles)[0];
  if (mode === "replace") {
    if (target == null) throw new Error("Choose a learner to replace");
    learner(state, target);
    profile.id = target;
  } else {
    profile.id = uid();
  }
  if (profile.active_session) {
    profile.active_session.owner = profile.id;
    profile.active_session.id = uid();
    profile.active_session.paused = true;
    profile.active_session.status = "paused";
  }
  state.profiles[profile.id] = profile;
}
