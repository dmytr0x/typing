import { ukrainianPractice } from "./ukrainian-practice.js";
import { MIN_LESSON_LENGTH, joinPieces, normalizeText, ensureLength } from "./text.js";
import englishData from "./courses/en-qwerty-v2.json" with { type: "json" };
function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
function practiceBody(focus, allowed, words, sentences, phase) {
  const keys = [...new Set([...focus].filter(c => !" \n".includes(c)))];
  if (!keys.length) keys.push(...allowed.trim());
  const drill = Array.from({length:24}, (_,i) => keys[i % keys.length] + keys[(i+1) % keys.length]).join(" ");
  const usable = words.filter(word => [...word].every(c => allowed.includes(c)));
  const reading = sentences.filter(line => [...line].every(c => allowed.includes(c)));
  let body = drill;
  if (phase && usable.length) body = [...usable.slice(phase), ...usable.slice(0,phase)].join(" ");
  if (phase >= 2 && reading.length) body = reading.join(" ");
  const missing = keys.filter(c => !body.includes(c)).join(" ");
  if (missing) body += " " + missing;
  if (focus.includes("\n")) body += "\n" + drill;
  return ensureLength(body, drill);
}
export function createCourseRuntime(document) {
  const data = deepFreeze(structuredClone(document));


let CURRICULUM_VERSION = 2;
const FINGER_ORDER = [
  "left little",
  "left ring",
  "left middle",
  "left index",
  "right index",
  "right middle",
  "right ring",
  "right little",
  "thumbs",
];
let FINGER_HOME = {
  "left little": "a",
  "left ring": "s",
  "left middle": "d",
  "left index": "f",
  "right index": "j",
  "right middle": "k",
  "right ring": "l",
  "right little": ";",
  thumbs: " ",
};
let FINGER_REACHES = {
  "left little": "Q, Z, and 1",
  "left ring": "W, X, and 2",
  "left middle": "E, C, and 3",
  "left index": "R, T, G, V, B, 4, and 5",
  "right index": "Y, U, H, N, M, 6, and 7",
  "right middle": "I, comma, and 8",
  "right ring": "O, period, and 9",
  "right little": "P, apostrophe, slash, and 0",
  thumbs: "Space",
};
const FINGER_PHASES = ["Meet the keys", "Find a rhythm", "Use your skills"];

const LEFT_HAND = new Set(data.left_hand || "qwertasdfgzxcvbQWERTASDFGZXCVB");
const SYMBOL_CHARS = "'\"?!:-@#$%^&*()_+=[]{}\\|`~<>";

let COURSE = [];
const BY_ID = {};
let KEYBOARD = [];
let FINGERS = [];
let CHARACTER_FINGERS = new Map();
const POOLS = {
  child_words: [],
  adult_words: [],
  child_sentences: [],
  adult_sentences: [],
  assessment_child: [],
  assessment_adult: [],
};

function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

function uniqueJoin(value) {
  let out = "";
  for (const character of value) {
    if (!out.includes(character)) out += character;
  }
  return out;
}

function uniqueCharacters(value) {
  let out = "";
  for (const character of value) {
    if (" \n\t".includes(character) || out.includes(character)) continue;
    out += character;
  }
  return out;
}

function isAlpha(character) {
  return /\p{L}/u.test(character);
}

function isUpper(character) {
  return character !== character.toLowerCase() && character === character.toUpperCase();
}

function isDigit(character) {
  return character >= "0" && character <= "9";
}

function reverseString(value) {
  return [...value].reverse().join("");
}

function hand(character) {
  const lowered = character.toLowerCase();
  if (LEFT_HAND.has(lowered)) return "left";
  if (isAlpha(lowered)) return "right";
  return null;
}

function addUnique(tokens, token) {
  if (token && !tokens.includes(token)) tokens.push(token);
}

function patternTokens(focus, support, phase) {
  let focusChars = uniqueCharacters(focus);
  const supportChars = uniqueCharacters(support);
  if (!focusChars) focusChars = supportChars;
  if (!focusChars) return [];
  const tokens = [];
  for (let offset = 0; offset < Math.max(8, focusChars.length * 3); offset++) {
    const first = focusChars[offset % focusChars.length];
    const second = focusChars[(offset + 1) % focusChars.length];
    const opposite = [...supportChars].filter(
      (character) => hand(character) != null && hand(character) !== hand(first),
    );
    const thirdPool = opposite.length ? opposite.join("") : supportChars;
    const third = thirdPool[(offset * 2 + phase) % thirdPool.length];
    const candidates = [
      first,
      second,
      first + second,
      second + first,
      first + second + first,
      second + first + second,
      first + third + second,
      second + third + first,
    ];
    for (const candidate of candidates) addUnique(tokens, candidate);
  }
  return tokens;
}

function variedDrill(focus, support, phase, target = 42) {
  const tokens = patternTokens(focus, support, phase);
  if (!tokens.length) return "";
  let stride = tokens.length > 5 ? 5 : 1;
  while (tokens.length > 1 && gcd(stride, tokens.length) !== 1) stride += 1;
  const ordered = Array.from(
    { length: tokens.length },
    (_, index) => tokens[(index * stride + phase * 3) % tokens.length],
  );
  const sequence = [];
  let covered = "";
  const focusSet = new Set(uniqueCharacters(focus));
  for (const token of ordered) {
    sequence.push(token);
    covered += token;
    const coveredSet = new Set(covered);
    const focusCovered = [...focusSet].every((character) => coveredSet.has(character));
    if (sequence.join(" ").length >= target && focusCovered) break;
  }
  return sequence.join(" ");
}

function availableWords(words, allowed, phase) {
  const allowedSet = new Set(allowed);
  let usable = words.filter(
    (word) => word.length >= 2 && [...word].every((character) => allowedSet.has(character)),
  );
  if (!usable.length) return [];
  usable = [...new Set(usable)].sort(
    (a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0),
  );
  if (phase % 2) usable.reverse();
  return usable;
}

function passageFromWords(words, allowed, phase, target = 18, offset = 0) {
  const usable = availableWords(words, allowed, phase);
  if (!usable.length) return "";
  const tokens = [];
  const goal = Math.min(target, Math.max(8, usable.length * 2));
  let cycle = 0;
  while (tokens.length < goal) {
    const order = Array.from(
      { length: usable.length },
      (_, index) => usable[(index * 3 + phase + offset) % usable.length],
    );
    if (cycle % 2) order.reverse();
    for (const word of order) {
      if (tokens.length && word === tokens.at(-1)) continue;
      tokens.push(word);
      if (tokens.length >= goal) break;
    }
    cycle += 1;
    if (cycle > 8) break;
  }
  return tokens.join(" ");
}

function allowedSentences(sources, allowed) {
  const allowedSet = new Set(allowed);
  const fits = [];
  for (const source of sources) {
    if ([...source].every((character) => allowedSet.has(character))) {
      fits.push(normalizeText(source));
    }
  }
  return [...new Set(fits)];
}

function ensureFocus(text, focus) {
  const missing = [...uniqueCharacters(focus)].filter(
    (character) => !text.includes(character),
  );
  if (!missing.length) return text;
  let extra = missing.join(" ");
  if (missing.includes("\n")) {
    extra =
      extra.replaceAll("\n", "").trim() + "\n" + extra.replaceAll("\n", " ").trim();
  }
  return joinPieces(text, extra);
}

function readingText(sources, allowed, phase, focus = "") {
  let sentences = allowedSentences(sources, allowed);
  if (!sentences.length) return "";
  if (focus) {
    const wanted = [...uniqueCharacters(focus)];
    sentences = [...sentences].sort(
      (a, b) =>
        wanted.reduce((sum, character) => sum + (b.includes(character) ? 1 : 0), 0) -
        wanted.reduce((sum, character) => sum + (a.includes(character) ? 1 : 0), 0),
    );
  }
  const start = (phase * 2) % sentences.length;
  let ordered = sentences.slice(start).concat(sentences.slice(0, start));
  if (phase % 2 && !focus) ordered = [...ordered].reverse();
  const picked = [];
  let covered = "";
  for (const sentence of ordered) {
    if (picked.length && sentence === picked.at(-1)) continue;
    picked.push(sentence);
    covered += sentence;
    const joined = picked.join(" ");
    if (
      focus &&
      [...uniqueCharacters(focus)].every((character) => covered.includes(character)) &&
      joined.length >= MIN_LESSON_LENGTH
    ) {
      break;
    }
    if (joined.length >= MIN_LESSON_LENGTH) break;
    if (picked.length >= 4) break;
  }
  let text = picked.join(" ");
  if (allowed.includes("\n")) {
    const extra = ordered[picked.length % ordered.length];
    if (!picked.includes(extra)) text = `${text}\n${extra}`;
  }
  return ensureFocus(normalizeText(text), focus);
}

function capitalDrill(focus, phase) {
  const letters = [...uniqueCharacters(focus)].filter(isAlpha);
  let tokens = [];
  for (const letter of letters) {
    tokens.push(letter);
    tokens.push(letter + letter.toLowerCase());
  }
  letters.forEach((letter, index) => {
    const other = letters[(index + 1) % letters.length];
    tokens.push(letter + other);
    tokens.push(other + letter);
  });
  if (phase) tokens = tokens.reverse();
  return tokens.join(" ");
}

function symbolIntro(focus, allowed, words, phase) {
  const chars = uniqueCharacters(focus.replaceAll("\n", ""));
  if (!chars) return "";
  const usable = availableWords(words, allowed.replaceAll("\n", " "), phase).slice(
    0,
    10,
  );
  const tokens = [...chars];
  (usable.length ? usable : ["ok"]).forEach((word, index) => {
    const wrap = chars[index % chars.length];
    if ("'\"".includes(wrap)) tokens.push(`${wrap}${word}${wrap}`);
    else if (isDigit(wrap) || SYMBOL_CHARS.includes(wrap)) tokens.push(`${word}${wrap}`);
    else tokens.push(wrap);
  });
  return tokens.join(" ");
}

function lessonBody(focus, allowed, words, sentences, phase, offset = 0) {
  const lettersOnly = [...focus].filter((character) => character !== "\n").join("");
  const drillPhase = phase + offset;
  let drill = [...focus].some(isUpper)
    ? capitalDrill(lettersOnly, drillPhase)
    : variedDrill(focus.replaceAll("\n", ""), allowed, drillPhase);
  if (focus.includes("\n")) {
    drill = drill + "\n" + variedDrill(lettersOnly, allowed, drillPhase + 1);
  }
  const wordsLine = passageFromWords(words, allowed, phase, 18, offset);
  const reading = readingText(sentences, allowed, phase + offset, focus);
  if (phase === 0) {
    let body;
    if (!uniqueCharacters(focus)) {
      body = wordsLine || reading || variedDrill(allowed, allowed, drillPhase);
    } else if (
      [...focus].some(isAlpha) &&
      ![...uniqueCharacters(focus)].some(
        (character) => SYMBOL_CHARS.includes(character) || isDigit(character),
      )
    ) {
      const second = [...focus].some(isUpper)
        ? capitalDrill(lettersOnly, drillPhase + 1)
        : variedDrill(
            reverseString(focus.replaceAll("\n", "")) || focus,
            allowed,
            drillPhase + 1,
          );
      body = joinPieces(drill, second);
    } else {
      body = symbolIntro(focus, allowed, words, drillPhase);
    }
    if (focus.includes("\n") && !body.includes("\n")) {
      body += "\n" + variedDrill(lettersOnly, allowed, drillPhase + 1);
    }
    return ensureFocus(body, focus);
  }
  if (reading && phase >= 3) return reading;
  if (wordsLine && phase >= 1) {
    const extra =
      phase === 2 && ![...focus].some(isUpper) ? drill : "";
    return ensureFocus(joinPieces(wordsLine, extra, reading), focus);
  }
  if (reading) return reading;
  return ensureFocus(drill, focus);
}

function buildKeyboard() {
  const rows = ["`1234567890-=", "qwertyuiop[]\\", "asdfghjkl;'", "zxcvbnm,./"];
  const shifted = ["~!@#$%^&*()_+", "QWERTYUIOP{}|", 'ASDFGHJKL:"', "ZXCVBNM<>?"];
  const fingers = ["0012334456777", "0123344567777", "01233445677", "0123344567"];
  const names = [
    "left little",
    "left ring",
    "left middle",
    "left index",
    "right index",
    "right middle",
    "right ring",
    "right little",
  ];
  const layout = [];
  rows.forEach((row, r) => {
    const keys = [...row].map((key, i) => ({
      key,
      shift: shifted[r][i],
      finger: names[Number(fingers[r][i])],
    }));
    if (r === 0) {
      keys.push({
        key: "Backspace",
        shift: "Backspace",
        finger: "right little",
        wide: "backspace",
      });
    } else if (r === 2) {
      keys.push({
        key: "Enter",
        shift: "Enter",
        finger: "right little",
        wide: "enter",
      });
    } else if (r === 3) {
      keys.unshift({
        key: "Shift",
        shift: "Shift",
        finger: "left little",
        hand: "left",
        wide: "shift",
      });
      keys.push({
        key: "Shift",
        shift: "Shift",
        finger: "right little",
        hand: "right",
        wide: "shift",
      });
    }
    layout.push(keys);
  });
  return layout;
}

function characterFingersFrom(layout) {
  const mapping = new Map([[" ", "thumbs"]]);
  for (const row of layout) {
    for (const key of row) {
      if (key.key === "Enter") {
        mapping.set("\n", key.finger);
        continue;
      }
      if (key.key === "Shift" || key.key === "Backspace") continue;
      mapping.set(key.key, key.finger);
      mapping.set(key.shift, key.finger);
    }
  }
  return mapping;
}

function keysForFinger(finger, allowed = null) {
  let out = "";
  for (const [character, name] of CHARACTER_FINGERS) {
    if (name === finger && (allowed == null || allowed.includes(character))) {
      if (!out.includes(character)) out += character;
    }
  }
  return out;
}

function fingerGuide() {
  return FINGER_ORDER.map((name) => ({
    id: name,
    label: fingerLabel(name),
    home: FINGER_HOME[name],
    keys: keysForFinger(name),
    reaches: FINGER_REACHES[name],
  }));
}

function loadCourse(data) {
  COURSE = data.lessons ? [...data.lessons] : [];
  for (const key of Object.keys(BY_ID)) delete BY_ID[key];
  for (const lesson of COURSE) BY_ID[lesson.id] = lesson;
  CURRICULUM_VERSION = data.version ?? 2;
  const pools = data.pools || {};
  POOLS.child_words = pools.child_words || [];
  POOLS.adult_words = pools.adult_words || [];
  POOLS.child_sentences = pools.child_sentences || [];
  POOLS.adult_sentences = pools.adult_sentences || [];
  POOLS.assessment_child = pools.assessment_child || [];
  POOLS.assessment_adult = pools.assessment_adult || [];
  KEYBOARD = data.keyboard ? data.keyboard : buildKeyboard();
  CHARACTER_FINGERS = characterFingersFrom(KEYBOARD);
  FINGERS = data.fingers ? data.fingers : fingerGuide();
  FINGER_HOME = Object.fromEntries(FINGERS.map(f => [f.id, f.home]));
  FINGER_REACHES = Object.fromEntries(FINGERS.map(f => [f.id, f.reaches]));
}

function taught(learner) {
  let allowed = data.initial_keys || "fj ";
  for (const lesson of COURSE) {
    if (
      lesson.id in learner.lesson_progress ||
      learner.attempts.some((result) => result.lesson_id === lesson.id)
    ) {
      allowed += lesson.allowed;
    }
  }
  return uniqueJoin(allowed);
}

function available(learner, lesson) {
  return lesson.prerequisite == null || lesson.prerequisite in learner.lesson_progress;
}

function nextLesson(learner) {
  return COURSE.find((lesson) => !(lesson.id in learner.lesson_progress)) || null;
}

function fingerFor(character) {
  return CHARACTER_FINGERS.get(character) ?? null;
}

function fingerLabel(finger) {
  return finger.slice(0, 1).toUpperCase() + finger.slice(1);
}

function fingerInstruction(finger) {
  if (!(finger in FINGER_HOME)) throw new Error("Unknown finger");
  if (finger === "thumbs") {
    return (
      "Use either thumb for Space. Keep the other fingers on home row. " +
      "Look at the text. The app cannot see which finger you used."
    );
  }
  if (data.id !== "en-qwerty") {
    const item = FINGERS.find(item => item.id === finger);
    return `Your ${finger} rests on ${item.home.toUpperCase()}. Reach to ${item.reaches} and return home. The app cannot see which finger you used.`;
  }
  const home = FINGER_HOME[finger].toUpperCase();
  return (
    `Your ${finger} finger rests on ${home}. It also types ${FINGER_REACHES[finger]}. ` +
    `Reach, press, and return to ${home}. Look at the text. ` +
    "The app cannot see which finger you used."
  );
}

function fingerTitle(finger, phase) {
  if (!(finger in FINGER_HOME)) throw new Error("Unknown finger");
  const label =
    phase >= 0 && phase < FINGER_PHASES.length ? FINGER_PHASES[phase] : "Practice";
  return `${label}: ${fingerLabel(finger)} finger`;
}

function focusedPracticeText(focus, allowed, { band = "child", phase = 0 } = {}) {
  if (data.id === "uk-macos") return ukrainianPractice(focus, allowed, POOLS[`${band}_words`], POOLS[`${band}_sentences`], Math.min(Math.max(phase, 0), 4));
  if (data.id === "uk-ua") return practiceBody(focus, allowed, POOLS[`${band}_words`], POOLS[`${band}_sentences`], Math.min(Math.max(phase, 0), 4));
  const words = band === "adult" ? POOLS.adult_words : POOLS.child_words;
  const sentences = band === "adult" ? POOLS.adult_sentences : POOLS.child_sentences;
  return lessonBody(focus, allowed, words, sentences, Math.min(Math.max(phase, 0), 4));
}

KEYBOARD = buildKeyboard();
CHARACTER_FINGERS = characterFingersFrom(KEYBOARD);
FINGERS = fingerGuide();

  loadCourse(data);
  return deepFreeze({data, CURRICULUM_VERSION, FINGER_ORDER, FINGER_HOME, FINGER_REACHES, FINGER_PHASES, COURSE, BY_ID, KEYBOARD, FINGERS, POOLS, buildKeyboard, keysForFinger, fingerGuide, taught, available, nextLesson, fingerFor, fingerLabel, fingerInstruction, fingerTitle, focusedPracticeText,
    CHARACTER_FINGERS: { get: key => CHARACTER_FINGERS.get(key), has: key => CHARACTER_FINGERS.has(key), [Symbol.iterator]: () => CHARACTER_FINGERS[Symbol.iterator]() }
  });
}
const english = createCourseRuntime(englishData);
// Legacy module imports are fixed to English. Loading a course returns a new
// instance and cannot redirect a concurrent attempt or recovery operation.
export function loadCourse(data) { return createCourseRuntime(data); }
export const { CURRICULUM_VERSION, FINGER_ORDER, FINGER_HOME, FINGER_REACHES, FINGER_PHASES, COURSE, BY_ID, KEYBOARD, FINGERS, POOLS, buildKeyboard, keysForFinger, fingerGuide, taught, available, nextLesson, fingerFor, fingerLabel, fingerInstruction, fingerTitle, focusedPracticeText, CHARACTER_FINGERS } = english;
export const defaultRuntime = english;
