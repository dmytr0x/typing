import { PythonRandom } from "./random.js";
import {
  BY_ID,
  FINGER_HOME,
  FINGER_ORDER,
  POOLS,
  fingerFor,
  fingerLabel,
  focusedPracticeText,
  keysForFinger,
  taught,
} from "./course-runtime.js";
import { emptySkill, now } from "./validate.js";
import { MIN_LESSON_LENGTH, ensureLength, normalizeText, repeatText } from "./text.js";

export const MIN_FINGER_SAMPLES = 12;
export const WEAK_ERROR_RATE = 0.05;
export const SLOW_LATENCY_RATIO = 1.35;

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
  0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
  0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
  0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
  0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
];

function rotr(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}

export function sha256Hex(text) {
  const encoded = new TextEncoder().encode(text);
  const withOne = encoded.length + 1;
  const paddedLen = Math.ceil((withOne + 8) / 64) * 64;
  const bytes = new Uint8Array(paddedLen);
  bytes.set(encoded);
  bytes[encoded.length] = 0x80;
  const view = new DataView(bytes.buffer);
  const bitLen = encoded.length * 8;
  view.setUint32(paddedLen - 4, bitLen, false);
  let h0 = 0x6a09e667,
    h1 = 0xbb67ae85,
    h2 = 0x3c6ef372,
    h3 = 0xa54ff53a,
    h4 = 0x510e527f,
    h5 = 0x9b05688c,
    h6 = 0x1f83d9ab,
    h7 = 0x5be0cd19;
  for (let offset = 0; offset < paddedLen; offset += 64) {
    const w = new Uint32Array(64);
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4,
      f = h5,
      g = h6,
      h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, "0"))
    .join("");
}

function localDay(iso, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function characterLabel(key) {
  if (key === " ") return "Space";
  if (key === "\n") return "Enter";
  return key.toUpperCase();
}

export function holdingError(text, mode, buffer) {
  return Boolean(mode === "guided" && buffer.length && buffer.at(-1) !== text[buffer.length - 1]);
}

export function score(attempt) {
  const buffer = [];
  const first = new Map();
  let wrong = 0;
  let corrections = 0;
  let previousMs = 0;
  for (const event of attempt.events) {
    if (event.ms < previousMs || event.ms > attempt.elapsed_ms) {
      throw new Error("Invalid event clock");
    }
    if (attempt.duration && event.ms > attempt.duration * 1000) {
      throw new Error("Input after assessment deadline");
    }
    previousMs = event.ms;
    if (event.key === "Backspace") {
      if (buffer.length) {
        buffer.pop();
        corrections += 1;
      }
      continue;
    }
    const code = event.key.codePointAt(0);
    if (
      event.key.length !== 1 ||
      (event.key !== "\n" && !(code >= 32 && code <= 126))
    ) {
      throw new Error("Unsupported input");
    }
    if (holdingError(attempt.text, attempt.mode, buffer)) continue;
    const position = buffer.length;
    if (position >= attempt.text.length) throw new Error("Input beyond exercise");
    const correct = event.key === attempt.text[position];
    if (!first.has(position)) first.set(position, correct);
    wrong += Number(!correct);
    buffer.push(event.key);
  }
  let correctCount = 0;
  for (let i = 0; i < buffer.length && i < attempt.text.length; i++) {
    if (buffer[i] === attempt.text[i]) correctCount += 1;
  }
  const elapsed = attempt.elapsed_ms;
  if (attempt.duration && elapsed > attempt.duration * 1000) {
    throw new Error("Assessment clock exceeds deadline");
  }
  let firstCorrect = 0;
  for (const value of first.values()) firstCorrect += Number(value);
  return {
    accuracy: first.size ? (100 * firstCorrect) / first.size : 0,
    wpm:
      elapsed >= 5000 && correctCount >= 10 ? (correctCount * 12000) / elapsed : null,
    first_attempted: first.size,
    first_correct: firstCorrect,
    wrong,
    corrections,
    correct_characters: correctCount,
    complete: buffer.join("") === attempt.text,
    elapsed_ms: elapsed,
    buffer: buffer.join(""),
  };
}

export function evidence(attempt) {
  const buffer = [];
  const observations = [];
  let last = 0;
  for (const event of attempt.events) {
    if (event.key === "Backspace") {
      if (buffer.length) buffer.pop();
      last = event.ms;
      continue;
    }
    if (holdingError(attempt.text, attempt.mode, buffer)) continue;
    if (buffer.length >= attempt.text.length) throw new Error("Input beyond exercise");
    const expected = attempt.text[buffer.length];
    const correct = expected === event.key;
    const latency = event.ms - last;
    observations.push([
      expected,
      event.key,
      correct,
      0 < latency && latency < 2000 && !attempt.paused ? latency : 0,
    ]);
    last = event.ms;
    buffer.push(event.key);
  }
  return observations;
}

export function finish(learner, attempt) {
  const resultScore = score(attempt);
  const timedEnd =
    attempt.duration != null && attempt.elapsed_ms === attempt.duration * 1000;
  if (!resultScore.complete && !timedEnd && attempt.kind !== "placement") {
    throw new Error("Finish the text or assessment time before submitting");
  }
  const threshold = attempt.lesson_id ? BY_ID[attempt.lesson_id].threshold : 95;
  const passed = resultScore.complete && resultScore.accuracy >= threshold;
  const result = {
    id: attempt.id,
    lesson_id: attempt.lesson_id ?? null,
    kind: attempt.kind,
    score: resultScore,
    passed,
    date: now(),
    duration: attempt.duration ?? null,
    paused: Boolean(attempt.paused),
    text_digest: sha256Hex(attempt.text),
    self_check: null,
    finger: attempt.finger ?? null,
    title: attempt.title ?? null,
  };
  if (attempt.lesson_id && passed) {
    const previous = learner.lesson_progress[attempt.lesson_id];
    learner.lesson_progress[attempt.lesson_id] = {
      status: "completed",
      best_accuracy: Math.max(resultScore.accuracy, previous ? previous.best_accuracy : 0),
      best_wpm:
        Math.max(
          !attempt.paused ? resultScore.wpm || 0 : 0,
          previous ? previous.best_wpm || 0 : 0,
        ) || null,
    };
  }
  const current = new Date(result.date);
  if (attempt.kind !== "custom") {
    const observations = evidence(attempt);
    const allowed = attempt.lesson_id ? BY_ID[attempt.lesson_id].allowed : taught(learner);
    observations.forEach(([expected, actual, correct, latency], index) => {
      if (!allowed.includes(expected)) return;
      const keys = [[learner.skill_stats, expected]];
      if (index && allowed.includes(observations[index - 1][0])) {
        keys.push([learner.pair_stats, observations[index - 1][0] + expected]);
      }
      for (const [mapping, key] of keys) {
        if (!mapping[key]) mapping[key] = emptySkill();
        const skill = mapping[key];
        skill.samples += 1;
        skill.errors += Number(!correct);
        if (!correct) {
          skill.substitutions[actual] = (skill.substitutions[actual] || 0) + 1;
        }
        if (latency) {
          skill.latency_samples += 1;
          skill.latency_total += latency;
        }
      }
    });
    const practiced = [];
    const seen = new Set();
    for (const [expected] of observations) {
      if (!allowed.includes(expected) || seen.has(expected)) continue;
      seen.add(expected);
      practiced.push(expected);
    }
    for (const key of practiced) {
      const skill = learner.skill_stats[key];
      const keyEvents = observations.filter((item) => item[0] === key);
      const success = keyEvents.reduce((sum, item) => sum + Number(item[2]), 0) / keyEvents.length >= 0.95;
      if (success) {
        const priorExercises = skill.exercises.length;
        if (!skill.exercises.includes(result.text_digest)) {
          skill.exercises = skill.exercises.concat(result.text_digest).slice(-20);
        }
        if (skill.first_success == null) skill.first_success = result.date;
        const later = current - new Date(skill.first_success) >= 86400000;
        if (attempt.kind === "review" && later && priorExercises >= 2) skill.secure = true;
        skill.interval = Math.min(skill.interval + 1, 4);
        const days = [1, 3, 7, 14][skill.interval - 1];
        skill.due = new Date(current.getTime() + days * 86400000)
          .toISOString()
          .replace("Z", "+00:00");
      } else {
        skill.interval = 0;
        skill.due = new Date(current.getTime() + 86400000).toISOString().replace("Z", "+00:00");
      }
    }
  }
  const day = localDay(result.date, learner.settings.timezone);
  if (!learner.daily_summary[day]) {
    learner.daily_summary[day] = { milliseconds: 0, attempts: 0 };
  }
  learner.daily_summary[day].milliseconds += resultScore.elapsed_ms;
  learner.daily_summary[day].attempts += 1;
  result.score.buffer = "";
  learner.attempts = learner.attempts.concat(result).slice(-1000);
  if (attempt.kind === "assessment") learner.assessment_history.push(result);
  if (attempt.kind === "placement") {
    if (resultScore.complete && resultScore.accuracy >= 95) learner.placement_stage += 1;
    else learner.placement_done = true;
    if (learner.placement_stage >= 4) learner.placement_done = true;
  }
  if (passed && !learner.achievements.includes("First steps")) {
    learner.achievements.push("First steps");
  }
  if (
    resultScore.accuracy >= 97 &&
    resultScore.first_attempted >= 20 &&
    !learner.achievements.includes("Careful hands")
  ) {
    learner.achievements.push("Careful hands");
  }
  if (proficiency(learner) && !learner.achievements.includes("Steady typist")) {
    learner.achievements.push("Steady typist");
  }
  learner.active_session = null;
  return result;
}

export function proficiency(learner) {
  const qualifying = learner.assessment_history.filter(
    (result) =>
      result.duration === 180 &&
      result.score.elapsed_ms === 180000 &&
      !result.paused &&
      result.score.accuracy >= 97 &&
      (result.score.wpm || 0) >= 40,
  );
  const digests = new Set(qualifying.map((result) => result.text_digest));
  const days = new Set(qualifying.map((result) => localDay(result.date, learner.settings.timezone)));
  return digests.size >= 3 && days.size >= 2;
}

export function fingerReport(learner) {
  const allowed = taught(learner);
  const reports = [];
  for (const name of FINGER_ORDER) {
    const taughtKeys = keysForFinger(name, allowed);
    const skills = [...taughtKeys]
      .filter((key) => key in learner.skill_stats)
      .map((key) => [key, learner.skill_stats[key]]);
    const samples = skills.reduce((sum, [, skill]) => sum + skill.samples, 0);
    const errors = skills.reduce((sum, [, skill]) => sum + skill.errors, 0);
    const latencyTotal = skills.reduce((sum, [, skill]) => sum + skill.latency_total, 0);
    const latencySamples = skills.reduce((sum, [, skill]) => sum + skill.latency_samples, 0);
    let weakest = "";
    if (skills.length) {
      weakest = skills.reduce((best, item) => {
        const scoreOf = ([, skill]) => [
          skill.samples ? skill.errors / skill.samples : 0,
          skill.errors,
          -skill.samples,
        ];
        const left = scoreOf(item);
        const right = scoreOf(best);
        if (left[0] > right[0] || (left[0] === right[0] && left[1] > right[1]) || (left[0] === right[0] && left[1] === right[1] && left[2] > right[2])) {
          return item;
        }
        return best;
      })[0];
    }
    const errorRate = samples ? errors / samples : 0;
    const weak = samples >= MIN_FINGER_SAMPLES && errorRate >= WEAK_ERROR_RATE;
    let status;
    if (samples < MIN_FINGER_SAMPLES) status = "gathering";
    else if (weak) status = "needs practice";
    else if (errorRate < 0.03) status = "strong";
    else status = "developing";
    reports.push({
      id: name,
      label: fingerLabel(name),
      home: FINGER_HOME[name],
      samples,
      errors,
      accuracy: samples ? 100 * (1 - errorRate) : null,
      latency_ms: latencySamples ? latencyTotal / latencySamples : null,
      weak,
      slow: false,
      status,
      taught_keys: taughtKeys,
      weakest,
    });
  }
  const timed = reports
    .filter((item) => item.latency_ms != null && item.samples >= MIN_FINGER_SAMPLES)
    .map((item) => item.latency_ms);
  if (timed.length >= 3) {
    const median = [...timed].sort((a, b) => a - b)[Math.floor(timed.length / 2)];
    for (const item of reports) {
      if (
        item.latency_ms != null &&
        item.samples >= MIN_FINGER_SAMPLES &&
        item.latency_ms >= median * SLOW_LATENCY_RATIO
      ) {
        item.slow = true;
        if (item.status === "strong") item.status = "developing";
      }
    }
  }
  return reports;
}

export function fingerText(learner, finger, seed, phase = 0) {
  if (!(finger in FINGER_HOME)) throw new Error("Unknown finger");
  const allowed = taught(learner);
  const focus = keysForFinger(finger, allowed);
  if (!focus) throw new Error("This finger has no introduced keys yet");
  if (finger === "thumbs") {
    const letters = [...allowed].filter((character) => !" \n".includes(character));
    const pool = letters.length ? letters : ["f"];
    const generator = new PythonRandom(seed);
    const count = learner.settings.short_exercises ? 16 : 28;
    const tokens = Array.from({ length: count }, (_, index) =>
      Array.from({ length: 1 + (index % 2) }, () => generator.choice(pool)).join(""),
    );
    const text = normalizeText(tokens.join(" "));
    const extra = normalizeText([...tokens].reverse().join(" "));
    return ensureLength(text, extra);
  }
  const body = focusedPracticeText(focus, allowed, {
    band: learner.settings.band,
    phase,
  });
  const filler = focusedPracticeText(focus, allowed, {
    band: learner.settings.band,
    phase: phase + 1,
  });
  const text = ensureLength(body, filler);
  if (!text) {
    const pool = [...focus].filter((character) => character !== "\n").join("") || "fj";
    return reviewText(learner, pool, seed);
  }
  return normalizeText(text);
}

export function recommendation(learner) {
  const allowed = taught(learner);
  const weak = Object.entries(learner.skill_stats)
    .filter(
      ([key, skill]) =>
        allowed.includes(key) && skill.samples >= 5 && skill.errors / skill.samples >= 0.05,
    )
    .sort((a, b) => b[1].errors / b[1].samples - a[1].errors / a[1].samples);
  if (weak.length) {
    const keys = weak.slice(0, 4).map(([key]) => key).join("");
    const finger = fingerFor(weak[0][0]);
    const extra = finger ? ` That is your ${finger} finger.` : "";
    return [
      keys,
      `Practice '${keys.toUpperCase()}'; these caused the most mistakes recently.${extra}`,
    ];
  }
  const weakFingers = fingerReport(learner)
    .filter((item) => item.weak)
    .sort((a, b) => {
      const left = a.samples ? a.errors / a.samples : 0;
      const right = b.samples ? b.errors / b.samples : 0;
      return right - left || b.errors - a.errors;
    });
  if (weakFingers.length) {
    const weakestFinger = weakFingers[0];
    const keys =
      [...weakestFinger.taught_keys].filter((character) => character !== "\n").join("").slice(0, 8) ||
      allowed.slice(0, 8);
    const focus = weakestFinger.weakest
      ? characterLabel(weakestFinger.weakest)
      : weakestFinger.label;
    return [keys, `Train your ${weakestFinger.label} finger; ${focus} needs extra care.`];
  }
  const overdue = Object.entries(learner.skill_stats)
    .filter(
      ([key, skill]) => allowed.includes(key) && Date.parse(skill.due) <= Date.parse(now()),
    )
    .map(([key]) => key);
  if (overdue.length) {
    return [
      overdue.slice(0, 6).join(""),
      "A short review will refresh skills you have not practiced lately.",
    ];
  }
  const slow = Object.entries(learner.pair_stats)
    .filter(
      ([pair, skill]) =>
        [...pair].every((character) => allowed.includes(character)) && skill.latency_samples >= 5,
    )
    .sort(
      (a, b) =>
        b[1].latency_total / b[1].latency_samples - a[1].latency_total / a[1].latency_samples,
    );
  if (slow.length) {
    return [slow[0][0], `Build a smoother rhythm with '${slow[0][0]}'.`];
  }
  return [allowed.slice(0, 8), "Warm up with familiar keys before your next lesson."];
}

export function reviewText(learner, keys, seed) {
  const allowed = taught(learner);
  if (!keys || ![...keys].every((character) => allowed.includes(character))) {
    throw new Error("Choose keys already introduced in the course");
  }
  const generator = new PythonRandom(seed);
  const pool = (keys + keys + keys + allowed).replaceAll("\n", " ");
  const count = learner.settings.short_exercises ? 12 : 24;
  return normalizeText(
    Array.from({ length: count }, () => {
      const token = Array.from({ length: 3 }, () => generator.choice(pool)).join("").trim();
      return token || "f";
    }).join(" "),
  );
}

export function familiarText(learner, seed) {
  const allowed = taught(learner);
  const secureKeys = Object.entries(learner.skill_stats)
    .filter(([key, skill]) => skill.secure && allowed.includes(key))
    .map(([key]) => key)
    .join("");
  const poolKeys = secureKeys || allowed;
  const words = learner.settings.band === "adult" ? POOLS.adult_words : POOLS.child_words;
  const allowedSet = new Set(poolKeys);
  const usable = words.filter(
    (word) => word.length >= 2 && [...word].every((character) => allowedSet.has(character)),
  );
  const generator = new PythonRandom(seed);
  if (usable.length) {
    const count = learner.settings.short_exercises ? 10 : 18;
    const tokens = [];
    while (tokens.join(" ").length < MIN_LESSON_LENGTH || tokens.length < count) {
      const word = generator.choice(usable);
      if (tokens.length && word === tokens.at(-1)) continue;
      tokens.push(word);
      if (tokens.length > 40) break;
    }
    return ensureLength(tokens.join(" "), usable.slice(0, 12).reverse().join(" "));
  }
  const first = reviewText(learner, poolKeys.slice(0, 8) || "fj", seed);
  return repeatText(first, 1, { minimum_length: MIN_LESSON_LENGTH });
}

export function typingNotes(attempt) {
  const observations = evidence(attempt);
  const errors = {};
  const swaps = new Map();
  for (const [expected, actual, correct] of observations) {
    if (correct) continue;
    errors[expected] = (errors[expected] || 0) + 1;
    if (actual !== expected) {
      const pair = `${expected}\0${actual}`;
      swaps.set(pair, (swaps.get(pair) || 0) + 1);
    }
  }
  const notes = [];
  const worst = Object.keys(errors)
    .sort((a, b) => errors[b] - errors[a])
    .slice(0, 3);
  if (worst.length) {
    const labels = worst.map(characterLabel);
    notes.push("Most missed: " + labels.join(", ") + ".");
    const finger = fingerFor(worst[0]);
    if (finger) notes.push(`That is mostly your ${finger} finger.`);
  }
  if (swaps.size) {
    let best = null;
    let bestCount = -1;
    for (const [pair, count] of swaps) {
      if (count > bestCount) {
        best = pair;
        bestCount = count;
      }
    }
    const [expected, actual] = best.split("\0");
    notes.push(`You typed ${characterLabel(actual)} for ${characterLabel(expected)}.`);
  }
  return notes;
}
