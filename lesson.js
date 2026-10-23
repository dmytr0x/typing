import { Engine, holdingError, letterState, liveWpm, timings } from "./engine.js?v=5";
import {
  checkpoint,
  ctx,
  download,
  lesson,
  mutate,
  profile,
  saveError,
  pendingAttempt, keepDraft, clearDraft, reconcilePending,
} from "./api.js";
import { trainer } from "./trainer.js";
import { playTypingSound, preloadSounds, soundForStroke } from "./sound.js?v=1";
import { $, action, dialog, esc, keyLabel } from "./ui.js";
import { TypingViewport } from "./typing-viewport.js";
import { supportedKey } from "./input-policy.js";

let navigate = async () => {};
let start = async () => {};
let complete = async () => {};
let passage = null;
export function closeLesson() {
  passage?.viewport.dispose();
  passage = null;
}
export function connect(handlers) {
  navigate = handlers.navigate;
  start = handlers.start;
  complete = handlers.complete;
}

function keepTypingFocus() {
  if (ctx.engine && !ctx.engine.finished) $("#typing")?.focus({ preventScroll: true });
}

function icon(name) {
  const svg = (inner, filled = false) =>
    `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" ${
      filled
        ? 'fill="currentColor" stroke="none"'
        : 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'
    }>${inner}</svg>`;
  if (name === "leave") return svg('<path d="M5 7h14M5 12h14M5 17h14"/>');
  if (name === "pause")
    return svg(
      '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
      true,
    );
  if (name === "restart")
    return svg('<path d="M5 12a7 7 0 1 0 2-4.9"/><path d="M4.5 4.5v5h5"/>');
  if (name === "keyboard")
    return svg(
      '<rect x="3" y="6.5" width="18" height="11" rx="2"/><path d="M7 10h.01M12 10h.01M17 10h.01M9.5 14h5"/>',
    );
  if (name === "sound")
    return svg(
      '<path d="M5 10v4h3.5L14 18V6l-5.5 4H5z"/><path d="M17 9a4 4 0 0 1 0 6"/><path d="M19.2 7a7 7 0 0 1 0 10"/>',
    );
  if (name === "soundOff")
    return svg('<path d="M5 10v4h3.5L14 18V6l-5.5 4H5z"/><path d="M18 9l-5 6M13 9l5 6"/>');
  if (name === "help")
    return svg(
      '<circle cx="12" cy="12" r="8.5"/><path d="M9.4 9.5a2.6 2.6 0 1 1 3.9 2.3c-.8.5-1.3 1-1.3 2.1"/><circle cx="12" cy="17.15" r="1.15" fill="currentColor" stroke="none"/>',
    );
  return "";
}

async function saveSettings(patch) {
  try {
  await mutate(() =>
    trainer.updateProfile(ctx.profileId, { ...profile().settings, ...patch }),
  );
  } catch (error) { saveError(error); throw error; }
}

function pausedCue() {
  const cue = $("#input-cue");
  if (cue) cue.textContent = "Paused. Type to continue.";
}

function pauseLesson() {
  if (!ctx.engine?.running) return;
  ctx.engine.pause();
  ctx.dirty = true;
  keepDraft();
  pausedCue();
  keepTypingFocus();
  return checkpoint();
}

function handleLessonKey(event) {
  if (!ctx.engine || ctx.engine.finished || ctx.recovering || !$("#typing")) return;
  if (event.key === "Escape") {
    event.preventDefault();
    pauseLesson()?.catch(saveError);
    return;
  }
  if (event.getModifierState?.("CapsLock"))
    $("#input-cue").textContent = "Caps Lock is on. Check the case of the next letter.";
  if (event.key === "Dead" || event.isComposing) {
    event.preventDefault();
    $("#input-cue").textContent =
      "Use direct input from this course’s keyboard layout; composition and dead keys are not scored.";
    return;
  }
  const before = ctx.engine.result();
  const beforeEvents = ctx.engine.events.length;
  const wasIdle = !ctx.engine.running;
  if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.repeat &&
      (event.key === "Backspace" || event.key === "Enter" || supportedKey(event.key)))
    passage?.viewport.follow(before.buffer.length, { input: true });
  ctx.engine.key(event);
  if (wasIdle && ctx.engine.running && !event.getModifierState?.("CapsLock"))
    $("#input-cue").textContent = "You’ve got this. One key at a time.";
  ctx.dirty = true;
  const after = ctx.engine.result();
  keepDraft();
  const held = holdingError(
    ctx.engine.attempt.text,
    ctx.engine.attempt.mode,
    after.buffer,
  );
  if (after.wrong > before.wrong || (held && event.key !== "Backspace")) {
    $("#input-cue").textContent =
      "Use Backspace to correct the highlighted character.";
  }
  if (profile().settings.sound)
    playTypingSound(
      soundForStroke({
        recorded: ctx.engine.events.length > beforeEvents,
        wrongIncreased: after.wrong > before.wrong,
        bufferChanged: after.buffer !== before.buffer,
      }),
    );
}

document.addEventListener("keydown", (event) => {
  if (ctx.view !== "lesson" || !ctx.engine || ctx.engine.finished) return;
  const typing = $("#typing");
  if (!typing) return;
  if (event.target === typing || typing.contains(event.target)) return;
  if (!$("#dialog")?.hidden) return;
  if (event.key === "Tab") return;
  if (event.key === "Escape") {
    event.preventDefault();
    pauseLesson()?.catch(saveError);
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const blocking = event.target?.closest?.(
    "button, a, summary, input, textarea, select, [role=dialog]",
  );
  if (blocking && (event.key === "Enter" || event.key === " ")) return;
  typing.focus({ preventScroll: true });
  handleLessonKey(event);
});

function fingerId(finger) {
  return finger.replaceAll(" ", "-");
}

function renderFingerLegend() {
  const fingers = [...new Set(ctx.course.keyboard.flat().map((key) => key.finger)), "thumbs"];
  return `<div class="finger-legend" aria-label="Finger colour map">${fingers.map((finger) =>
    `<span data-finger="${fingerId(finger)}">${esc(finger === "thumbs" ? "Either thumb" : finger)}</span>`,
  ).join("")}</div>`;
}

function renderKeyboard() {
  return ctx.course.keyboard
    .map(
      (row) =>
        `<div class="key-row">${row
          .map((key) => {
            const wide = key.wide ? ` ${key.wide}` : "";
            const home = ctx.course.initial_keys.trim().includes(key.key) ? " home" : "";
            const hand = key.hand ? ` data-hand="${key.hand}"` : "";
            const label =
              key.key === "Shift"
                ? "Shift"
                : key.key === "Enter"
                  ? "↵"
                  : key.key === "Backspace"
                    ? "⌫"
                    : esc(key.key);
            const shifted = key.shift !== key.key && key.shift !== key.key.toUpperCase()
              ? `<span class="key-shift" aria-hidden="true">${esc(key.shift)}</span>` : "";
            return `<span class="key${wide}${home}" data-key="${esc(key.key)}" data-finger="${fingerId(key.finger)}"${hand} title="${esc(keyLabel(key.key))} · ${esc(key.finger)} finger">${shifted}${label}</span>`;
          })
          .join("")}</div>`,
    )
    .join("");
}

export function openAttempt(attempt) {
  closeLesson();
  ctx.view = "lesson";
  if (location.hash !== "#lesson") location.hash = "lesson";
  ctx.engine = new Engine(attempt, paint, complete);
  ctx.dirty = false;
  ctx.pendingFinish = false;
  ctx.forceHints = false;
  ctx.stretchBoundary = 0;
  const item = lesson(attempt.lesson_id, attempt.curriculum_version, attempt.course_id),
    hiddenKind = ["assessment", "placement"].includes(attempt.kind),
    hints = profile().settings.hints && !hiddenKind,
    sound = !!profile().settings.sound;
  const previewKeys = item?.new_keys || "";
  const title = item?.title || attempt.title || "Typing practice";
  $("#main").innerHTML = `
    <section class="lesson-panel" aria-label="Lesson">
      <button type="button" id="abandon" class="icon" title="Save your place and return home">${icon("leave")}<span>Finish later</span></button>
      <div class="lesson-heading">
        <p class="lesson-kicker">${esc(item?.stage || attempt.title || attempt.kind)}</p>
        <h1>${esc(title)}</h1>
      </div>
      <div class="stats" aria-label="Live results"><span>Accuracy <strong id="live-accuracy">—</strong></span><span ${profile().settings.quiet_practice ? "hidden" : ""}>WPM <strong id="live-wpm">—</strong></span><span id="timer">0:00</span></div>
      <div class="lesson-controls" aria-label="Lesson controls">
        <button type="button" id="pause" class="icon" aria-label="Pause" title="Pause (Esc)">${icon("pause")}</button>
        <button type="button" id="restart" class="icon" aria-label="Restart" title="Restart">${icon("restart")}</button>
        <button type="button" id="toggle-hints" class="icon" aria-label="Keyboard" title="Keyboard" aria-controls="hints" aria-expanded="${hints}" aria-pressed="${hints}">${icon("keyboard")}</button>
        <button type="button" id="toggle-sound" class="icon" aria-label="Typing sounds" title="Typing sounds" aria-pressed="${sound}">${icon(sound ? "sound" : "soundOff")}</button>
        <details class="lesson-help"><summary class="icon" title="Instructions">${icon("help")}<span>Instructions</span></summary><div>${esc(item?.instruction || attempt.instruction || "Keep your shoulders relaxed and your eyes on the text. Use Backspace to correct errors. Accuracy comes first.")} Use Backspace to fix highlighted characters.</div></details>
        ${attempt.kind === "placement" ? '<button type="button" id="stop-placement">Too difficult</button>' : ""}
      </div>
      <span class="lesson-learner">${esc(profile().settings.avatar)} ${esc(profile().settings.name)}</span>
    </section>
    <div class="lesson-workspace">
    ${
      previewKeys && !hiddenKind
        ? `<aside id="preview" class="preview"><p><strong>New keys:</strong> ${esc(previewKeys.replace("\n", " Enter "))} · opposite-hand Shift for capitals and symbols.</p><p class="small">Demo, not scored: ${esc((profile().settings.band === "adult" ? item.adult_text : item.text).slice(0, 42))}</p></aside>`
        : ""
    }
    <div class="typing-stage">
      <div id="typing" lang="${esc(ctx.course.language || "en")}" class="typing-box" tabindex="0" role="textbox" aria-label="Typing exercise. Type to begin or continue." aria-describedby="character-description input-cue" aria-multiline="true" spellcheck="false"></div>
      <button type="button" id="start-cue" class="start-cue" tabindex="-1" hidden>Start typing</button>
    </div>
    <div class="exercise-progress">
      <progress id="character-progress" max="${attempt.text.length}" value="0" aria-label="Exercise completion"></progress>
      <div class="exercise-progress-details"><span id="character-count"></span>${ctx.sessionPlan.length ? `<span>Step ${ctx.sessionIndex + 1} of ${ctx.sessionPlan.length} · ${esc(ctx.sessionPlan.map((p) => ({ review: "warm-up", lesson: "new lesson", familiar: "familiar practice" })[p.kind] || p.kind).join(" → "))}</span>` : ""}</div>
    </div>
    <p id="input-cue" class="visually-hidden" role="status">Press any key to begin.</p><p id="character-description" class="visually-hidden"></p>
    <div id="hints" ${hints ? "" : "hidden"}>
      <div class="keyboard" aria-label="Finger placement guide">${renderKeyboard()}<div class="key-row"><span class="key space" data-key=" " data-finger="thumbs">Space · either thumb</span></div></div>
      ${renderFingerLegend()}
      <p id="finger-hint" class="hint"></p>
    </div>
    <div class="lesson-recovery"><button id="retry-save" hidden>Retry save</button><button id="export-pending" hidden>Export pending attempt</button><button id="reload-saved" hidden>Reload saved state</button><button id="discard-pending" hidden>Discard pending work and leave</button></div>
    </div>`;
  $("#typing").style.fontSize = profile().settings.font_size + "px";
  action("start-cue", keepTypingFocus);
  $("#typing").onkeydown = handleLessonKey;
  $("#typing").onblur = () => {
    requestAnimationFrame(() => {
      if (!ctx.engine?.running) return;
      if (document.activeElement === $("#typing")) return;
      if (!$("#dialog")?.hidden) {
        ctx.engine.pause();
        ctx.dirty = true;
        pausedCue();
        checkpoint().catch(saveError);
        return;
      }
      if ($("#main")?.contains(document.activeElement)) return;
      ctx.engine.pause();
      ctx.dirty = true;
      pausedCue();
      checkpoint().catch(saveError);
    });
  };
  for (const name of ["paste", "drop", "compositionstart"])
    $("#typing").addEventListener(name, (event) => {
      event.preventDefault();
      $("#input-cue").textContent =
        "Type each character directly. Paste is available in the custom-text editor.";
    });
  action("stop-placement", () => ctx.engine.finish());
  action("pause", pauseLesson);
  action("toggle-hints", async () => {
    const hidden = !$("#hints").hidden;
    $("#hints").hidden = hidden;
    ctx.forceHints = !hidden;
    $("#toggle-hints").setAttribute("aria-expanded", String(!hidden));
    $("#toggle-hints").setAttribute("aria-pressed", String(!hidden));
    keepTypingFocus();
    try {
      await saveSettings({ hints: !hidden });
    } catch (error) {
      $("#hints").hidden = !hidden;
      ctx.forceHints = hidden;
      $("#toggle-hints").setAttribute("aria-expanded", String(hidden));
      $("#toggle-hints").setAttribute("aria-pressed", String(hidden));
      throw error;
    }
  });
  action("toggle-sound", async () => {
    const button = $("#toggle-sound");
    const on = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(on));
    button.innerHTML = icon(on ? "sound" : "soundOff");
    keepTypingFocus();
    try {
      await saveSettings({ sound: on });
      if (on) preloadSounds();
    } catch (error) {
      button.setAttribute("aria-pressed", String(!on));
      button.innerHTML = icon(on ? "soundOff" : "sound");
      throw error;
    }
  });
  action("abandon", () => navigate("home"));
  action("restart", async () => {
    ctx.engine.pause();
    if (
      !(await dialog({
        title: "Start again?",
        body: "This attempt will be abandoned and a fresh one will begin.",
        confirmLabel: "Restart",
        danger: true,
      }))
    ) {
      keepTypingFocus();
      return;
    }
    await ctx.saveQueue;
    const old = ctx.engine.attempt;
    await mutate(() => trainer.abandonAttempt(ctx.profileId, old.id));
    ctx.engine = null;
    await start({
      kind: old.kind,
      lesson_id: old.lesson_id,
      text: old.kind === "custom" ? old.text : "",
      finger: old.finger || "",
      phase: old.phase || 0,
    });
  });
  action("retry-save", async () => {
    try { await reconcilePending(); }
    catch (error) { saveError(error); throw error; }
    if (ctx.pendingFinish) await complete();
  });
  action("export-pending", () =>
    download("hearth-pending-attempt.json", pendingAttempt()),
  );
  action("reload-saved", async () => {
    if (
      !(await dialog({
        title: "Reload saved work?",
        body: "Export pending work first if you want to keep keystrokes that were not acknowledged.",
        confirmLabel: "Reload",
        danger: true,
      }))
    )
      return;
    await ctx.saveQueue.catch(() => {});
    ctx.state = await trainer.getState();
    clearDraft(ctx.engine.attempt);
    ctx.engine = null;
    ctx.pendingFinish = false; ctx.dirty = false; ctx.needsReconciliation = false;
    await navigate("home");
  });
  action("discard-pending", async () => {
    ctx.engine.pause(); keepDraft();
    if (!await dialog({ title: "Discard pending typing?", body: "Unacknowledged keystrokes and this pending result will be discarded. Your last acknowledged checkpoint stays available.", confirmLabel: "Discard and leave", danger: true })) return;
    await ctx.saveQueue.catch(() => {});
    let saved = ctx.state;
    let connected = true;
    try { saved = await trainer.getState(); } catch { connected = false; }
    clearDraft(ctx.engine.attempt);
    ctx.state = saved; ctx.engine = null; ctx.pendingFinish = false;
    ctx.dirty = false; ctx.needsReconciliation = !connected;
    $("#reconnect-household").hidden = connected;
    await navigate("home");
  });
  if (!ctx.engine.ready) pausedCue();
  mountPassage();
  paint();
  if (profile().settings.sound) preloadSounds();
  keepTypingFocus();
}

function units(text) {
  const items = [];
  for (let i = 0; i < text.length; ) {
    if (text[i] === "\n") {
      items.push({ start: i, end: i + 1, newline: true });
      i += 1;
      continue;
    }
    const start = i;
    while (i < text.length && text[i] !== " " && text[i] !== "\n") i += 1;
    while (i < text.length && text[i] === " ") i += 1;
    items.push({ start, end: i, newline: false });
  }
  return items;
}

function paceMood(wpm) {
  const goal = profile().settings.speed_goal || 40;
  if (wpm >= Math.max(70, goal * 1.5)) return { text: "WOW", star: true };
  if (wpm >= Math.max(52, goal * 1.15)) return { text: "Great!", star: true };
  if (wpm >= Math.max(28, goal * 0.7)) return { text: "Good", star: false };
  return { text: "", star: false };
}

function runWpm(words, ms) {
  const start = words[0].start,
    end = words[words.length - 1].end;
  if (ms.length < end) return null;
  const duration = ms[end - 1] - (start === 0 ? 0 : ms[start - 1]);
  if (duration < 120) return null;
  return ((end - start) * 12000) / duration;
}

function paceRuns(items, cursor) {
  const runs = [];
  let words = [],
    chars = 0;
  const flush = (paced) => {
    if (!words.length) return;
    runs.push({ words, paced });
    words = [];
    chars = 0;
  };
  for (const item of items) {
    if (item.newline) {
      flush(true);
      runs.push({ words: [item], paced: false });
      continue;
    }
    if (item.end > cursor) {
      flush(true);
      runs.push({ words: [item], paced: false });
      continue;
    }
    words.push(item);
    chars += item.end - item.start;
    if (chars >= 16 || words.length >= 4) flush(true);
  }
  flush(true);
  return runs;
}

function mountPassage() {
  const box = $("#typing"), text = ctx.engine.attempt.text;
  const items = units(text), words = [], groups = paceRuns(items, Infinity);
  const markup = groups.map(run => run.words.map((word, index) => {
    const chars = Array.from({ length: word.end - word.start }, (_, offset) => {
      const i = word.start + offset;
      return `<span class="char" data-index="${i}">${text[i] === "\n" ? "↵" : esc(text[i])}</span>`;
    }).join("");
    words.push(word);
    return `<span class="word">${index === 0 && !word.newline ? '<span class="pace" aria-hidden="true" hidden></span>' : ""}${chars}</span>${word.newline ? "<br>" : ""}`;
  }).join("")).join("");
  box.innerHTML = `<div class="typing-leading" aria-hidden="true"></div><div class="typing-passage">${markup}<span class="word end-word" aria-hidden="true"><span class="end-marker" data-index="${text.length}"></span></span></div><div class="typing-trailing" aria-hidden="true"></div>`;
  const chars = [...box.querySelectorAll("[data-index]")];
  const wordNodes = [...box.querySelectorAll(".word")];
  const wordAt = [];
  words.forEach((word, i) => {
    for (let j = word.start; j < word.end; j++) wordAt[j] = wordNodes[i];
  });
  wordAt[text.length] = wordNodes.at(-1);
  const groupAt = [];
  groups.forEach(group => {
    group.label = wordAt[group.words[0].start].querySelector('.pace');
    for (let j = group.words[0].start; j < group.words.at(-1).end; j++) groupAt[j] = group;
  });
  passage = { chars, wordAt, groups, groupAt, cursor: null, eventCount: 0, ms: [],
    viewport: new TypingViewport(box, chars, placeCue) };
  passage.viewport.cursor = ctx.engine.result().buffer.length;
  passage.viewport.reflow();
}

function updatePace(group, cursor) {
  if (!group?.label) return;
  const words = group.words.filter(word => word.end <= cursor);
  const wpm = words.length ? runWpm(words, passage.ms) : null;
  const label = group.label;
  label.hidden = wpm === null || profile().settings.quiet_practice;
  if (label.hidden) return;
  const width = words.at(-1).end - words[0].start;
  const mood = width >= 10 ? paceMood(wpm) : { text: "", star: false };
  label.innerHTML = `<span class="pace-label"><strong>${wpm.toFixed(0)}</strong> wpm${mood.text
    ? ` <span class="pace-mood">${esc(mood.text)}${mood.star ? '<span class="pace-star">★</span>' : ""}</span>` : ""}</span>`;
}

function updatePassage(result) {
  const text = ctx.engine.attempt.text, cursor = result.buffer.length;
  const previous = passage.cursor;
  const events = ctx.engine.events;
  if (previous === null) {
    passage.ms = timings(text, ctx.engine.attempt.mode, events).ms;
  } else {
    for (let i = passage.eventCount; i < events.length; i++) {
      if (events[i].key === "Backspace") passage.ms.pop();
      else passage.ms.push(events[i].ms);
    }
  }
  const changed = events.length !== passage.eventCount;
  passage.eventCount = events.length;
  // Only edited characters and the two cursor positions need new classes.
  const from = previous === null ? 0 : Math.min(previous, cursor);
  const to = previous === null ? text.length : Math.max(previous, cursor);
  for (let i = from; i <= to; i++) {
    const kind = i === text.length ? (i === cursor ? "cursor" : "") : letterState(text, result, i);
    passage.chars[i].className = `${i === text.length ? "end-marker" : "char"}${kind ? " " + kind : ""}`;
  }
  if (previous !== null) passage.wordAt[previous].classList.remove('is-current');
  passage.wordAt[cursor].classList.add('is-current');
  if (previous === null || passage.quiet !== profile().settings.quiet_practice)
    passage.groups.forEach(group => updatePace(group, cursor));
  else if (changed) {
    const groups = new Set([passage.groupAt[previous], passage.groupAt[cursor], passage.groupAt[cursor - 1]]);
    groups.forEach(group => updatePace(group, cursor));
  }
  passage.quiet = profile().settings.quiet_practice;
  passage.cursor = cursor;
  if (previous === null || ctx.engine.running) passage.viewport.follow(cursor);
  if (passage.running && !ctx.engine.running) passage.viewport.cancel();
  passage.running = ctx.engine.running;
}

function placeCue() {
  const cue = $("#start-cue");
  if (!cue || !ctx.engine) return;
  const show = !ctx.engine.running && !ctx.engine.finished;
  cue.hidden = !show;
  if (!show) return;
  cue.textContent = ctx.engine.ready ? "Start typing" : "Type to continue";
  const stage = cue.parentElement,
    box = $("#typing"),
    caret = $("#typing .cursor") || box,
    stageBox = stage.getBoundingClientRect(),
    caretBox = caret.getBoundingClientRect();
  const scale = stageBox.width / stage.offsetWidth;
  const half = cue.offsetWidth / 2;
  const x = Math.max(half + 6, Math.min(stageBox.width / scale - half - 6,
    (caretBox.left + caretBox.width / 2 - stageBox.left) / scale));
  const y = (caretBox.top - stageBox.top) / scale - cue.offsetHeight - 12;
  const bounds = box.getBoundingClientRect();
  // During manual review the caret may be clipped or outside the field. A
  // floating start button there would cover unrelated text.
  const top = Math.max((6 - stageBox.top) / scale, y);
  if (caretBox.top < bounds.top || caretBox.bottom > bounds.bottom ||
      top + cue.offsetHeight + 4 > (caretBox.top - stageBox.top) / scale) {
    cue.hidden = true;
    return;
  }
  cue.style.left = `${x}px`;
  cue.style.top = `${top}px`;
}

export function paint() {
  if (!ctx.engine || !$("#typing")) return;
  const result = ctx.engine.result(),
    cursor = result.buffer.length,
    text = ctx.engine.attempt.text;
  updatePassage(result);
  $("#character-progress").value = result.correct;
  $("#character-count").textContent = `${result.correct} of ${text.length} characters complete`;
  const firstError = [...result.buffer].findIndex((char, i) => char !== text[i]);
  const description = firstError >= 0
    ? `At character ${firstError + 1}, typed ${keyLabel(result.buffer[firstError])}; expected ${keyLabel(text[firstError])}. Use Backspace ${cursor - firstError} time${cursor - firstError === 1 ? "" : "s"}, then type ${keyLabel(text[firstError])}.`
    : cursor < text.length ? `Next: ${keyLabel(text[cursor])}, character ${cursor + 1}.` : "All characters complete.";
  if ($("#character-description").textContent !== description) $("#character-description").textContent = description;
  placeCue();
  paintStats(result);
  const held = holdingError(text, ctx.engine.attempt.mode, result.buffer);
  const needsCorrection = held || (cursor >= text.length && firstError >= 0);
  const target = needsCorrection ? "Backspace" : text[cursor];
  const secure = profile().skill_stats[target]?.secure;
  const showHint = ctx.forceHints || !secure;
  const key = ctx.course.keyboard.flat().find((item) =>
    item.key === target || item.shift === target || (target === "\n" && item.key === "Enter"),
  );
  const shiftHand = key && key.shift === target && key.shift !== key.key
    ? key.finger.startsWith("left") ? "right" : "left" : "";
  document.querySelectorAll("[data-key]").forEach((element) => {
    const shiftHit =
      element.dataset.key === "Shift" &&
      shiftHand && element.dataset.hand === shiftHand;
    element.classList.toggle(
      "target",
      element.dataset.key === target ||
        (element.dataset.key === key?.key && key?.key !== "Shift") ||
        Boolean(shiftHit),
    );
  });
  document.querySelectorAll(".finger-legend [data-finger]").forEach((element) => {
    const active = element.dataset.finger === fingerId(target === " " ? "thumbs" : key?.finger || "") ||
      Boolean(shiftHand && element.dataset.finger === `${shiftHand}-little`);
    element.classList.toggle("is-active", showHint && active);
  });
  const hint = $("#finger-hint");
  if (!showHint) hint.textContent = "";
  else if (target === "Backspace")
    hint.textContent = "Backspace · right little finger";
  else if (key)
    hint.textContent = `${keyLabel(target)} · ${key.finger} finger${shiftHand ? ` + ${shiftHand} Shift` : ""}`;
  else if (target === " ") hint.textContent = "Space · either thumb";
  else if (target === "\n") hint.textContent = "Enter · right little finger";
  else hint.textContent = keyLabel(target || "");
  $("#pause").disabled = !ctx.engine.running;
}

// Timer ticks have no passage writes, glyph measurements, or scroll requests.
export function paintStats(result = ctx.engine?.result()) {
  if (!result || !$("#live-accuracy")) return;
  $("#live-accuracy").textContent = result.attempted ? result.accuracy.toFixed(0) + "%" : "—";
  const live = liveWpm(result.correct, ctx.engine.milliseconds());
  $("#live-wpm").textContent = live === null ? "—" : live.toFixed(0);
  const seconds = Math.floor(
    (ctx.engine.attempt.duration
      ? ctx.engine.attempt.duration * 1000 - ctx.engine.milliseconds()
      : ctx.engine.milliseconds()) / 1000,
  );
  $("#timer").textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}${ctx.engine.attempt.duration ? " left" : ""}`;
}
