import { Engine, holdingError, letterState, liveWpm, timings } from "./engine.js?v=5";
import {
  checkpoint,
  ctx,
  download,
  lesson,
  mutate,
  profile,
  saveError,
} from "./api.js";
import { trainer } from "./trainer.js";
import { playTypingSound, preloadSounds, soundForStroke } from "./sound.js?v=1";
import { $, action, dialog, esc, keyLabel, oppositeShift } from "./ui.js";

let navigate = async () => {};
let start = async () => {};
let complete = async () => {};
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
  await mutate(() =>
    trainer.updateProfile(ctx.profileId, { ...profile().settings, ...patch }),
  );
}

function pausedCue() {
  const cue = $("#input-cue");
  if (cue) cue.textContent = "Paused. Type to continue.";
}

function pauseLesson() {
  if (!ctx.engine?.running) return;
  ctx.engine.pause();
  ctx.dirty = true;
  pausedCue();
  keepTypingFocus();
  return checkpoint();
}

function handleLessonKey(event) {
  if (!ctx.engine || ctx.engine.finished || !$("#typing")) return;
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
      "Use direct US keyboard input; composition and dead keys are not scored.";
    return;
  }
  const before = ctx.engine.result();
  const beforeEvents = ctx.engine.events.length;
  const wasIdle = !ctx.engine.running;
  ctx.engine.key(event);
  if (wasIdle && ctx.engine.running && !event.getModifierState?.("CapsLock"))
    $("#input-cue").textContent = "You’ve got this. One key at a time.";
  ctx.dirty = true;
  const after = ctx.engine.result();
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

function renderKeyboard(attempt) {
  const showPreview = attempt.kind === "lesson" && lesson(attempt.lesson_id)?.new_keys;
  return ctx.course.keyboard
    .map(
      (row) =>
        `<div class="key-row">${row
          .map((key) => {
            const wide = key.wide ? ` ${key.wide}` : "";
            const home = "fj".includes(key.key) ? " home" : "";
            const hand = key.hand ? ` data-hand="${key.hand}"` : "";
            const label =
              key.key === "Shift"
                ? "Shift"
                : key.key === "Enter"
                  ? "↵"
                  : key.key === "Backspace"
                    ? "⌫"
                    : esc(key.key);
            return `<span class="key${wide}${home}" data-key="${esc(key.key)}"${hand}>${label}</span>`;
          })
          .join("")}</div>`,
    )
    .join("");
}

export function openAttempt(attempt) {
  ctx.view = "lesson";
  if (location.hash !== "#lesson") location.hash = "lesson";
  ctx.engine = new Engine(attempt, paint, complete);
  ctx.dirty = false;
  ctx.pendingFinish = false;
  ctx.forceHints = false;
  ctx.stretchBoundary = 0;
  const item = lesson(attempt.lesson_id),
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
      <div class="stats" aria-label="Live results"><span>Accuracy <strong id="live-accuracy">—</strong></span><span>WPM <strong id="live-wpm">—</strong></span><span id="timer">0:00</span></div>
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
      <div id="typing" class="typing-box" tabindex="0" role="textbox" aria-label="Typing exercise. Type to begin or continue." aria-multiline="true" spellcheck="false"></div>
      <button type="button" id="start-cue" class="start-cue" tabindex="-1" hidden>Start typing</button>
    </div>
    <p id="input-cue" class="lesson-cue" role="status">Press any key to begin.</p>
    <div id="hints" ${hints ? "" : "hidden"}>
      <div class="keyboard" aria-label="Finger placement guide">${renderKeyboard(attempt)}<div class="key-row"><span class="key space" data-key=" ">Space · either thumb</span></div></div>
      <p id="finger-hint" class="hint"></p>
    </div>
    <div class="lesson-recovery"><button id="retry-save" hidden>Retry save</button><button id="export-pending" hidden>Export pending attempt</button><button id="reload-saved" hidden>Reload saved state</button></div>
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
  action("retry-save", () => (ctx.pendingFinish ? complete() : checkpoint()));
  action("export-pending", () =>
    download("hearth-pending-attempt.json", {
      attempt: ctx.engine.attempt,
      checkpoint: ctx.engine.snapshot(),
    }),
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
    await ctx.saveQueue;
    ctx.state = await trainer.getState();
    ctx.engine = null;
    await navigate("home");
  });
  if (!ctx.engine.ready) pausedCue();
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

function renderChars(text, start, end, result) {
  return [...text.slice(start, end)]
    .map((char, offset) => {
      const i = start + offset,
        kind = letterState(text, result, i);
      return `<span class="char${kind ? " " + kind : ""}">${char === "\n" ? "↵" : esc(char)}</span>`;
    })
    .join("");
}

function renderExercise(text, cursor, result, ms, startAt, end) {
  const current = units(text).find((item) => item.start <= cursor && cursor < item.end);
  return paceRuns(
    units(text).filter((item) => item.end > startAt && item.start < end),
    cursor,
  )
    .map((run) => {
      const wpm = run.paced ? runWpm(run.words, ms) : null;
      let pace = "";
      if (wpm !== null) {
        const width = run.words[run.words.length - 1].end - run.words[0].start;
        const mood = width >= 10 ? paceMood(wpm) : { text: "", star: false };
        pace = `<span class="pace" aria-hidden="true"><span class="pace-label"><strong>${wpm.toFixed(0)}</strong> wpm${
          mood.text
            ? ` <span class="pace-mood">${esc(mood.text)}${mood.star ? "<span class='pace-star'>★</span>" : ""}</span>`
            : ""
        }</span></span>`;
      }
      const body = run.words
        .map((word, index) => {
          const chars = renderChars(text, word.start, word.end, result);
          if (word.newline) return `${chars}<br>`;
          const now = current && word.start === current.start ? " is-current" : "";
          return `<span class="word${now}">${index === 0 ? pace : ""}${chars}</span>`;
        })
        .join("");
      return `<span class="word-run${pace ? " has-pace" : ""}">${body}</span>`;
    })
    .join("");
}

function lineBox(caret) {
  return caret.closest(".word") || caret;
}

function nextLineBottom(box, caret) {
  const current = lineBox(caret).getBoundingClientRect();
  let nextTop = null,
    bottom = null;
  for (const node of box.querySelectorAll(".char")) {
    const rect = node.getBoundingClientRect();
    if (rect.top < current.top + current.height * 0.5) continue;
    if (nextTop === null) nextTop = rect.top;
    if (rect.top > nextTop + current.height * 0.5) break;
    bottom = Math.max(bottom ?? rect.bottom, rect.bottom);
  }
  return bottom;
}

function keepCursorVisible(box) {
  const caret = box.querySelector(".cursor");
  if (!caret) return;
  const lineHeight = lineBox(caret).getBoundingClientRect().height;
  const roomForNext = box.clientHeight >= lineHeight * 1.8;
  const nextBottom = nextLineBottom(box, caret);
  const bounds = box.getBoundingClientRect();
  const caretBox = caret.getBoundingClientRect();
  if (roomForNext && nextBottom !== null && nextBottom > bounds.bottom - 4)
    box.scrollTop += nextBottom - bounds.bottom + 4;
  else if (caretBox.bottom > bounds.bottom - 12)
    box.scrollTop += caretBox.bottom - bounds.bottom + 12;
  const caretNow = caret.getBoundingClientRect(),
    boxNow = box.getBoundingClientRect();
  if (caretNow.top < boxNow.top + 12) box.scrollTop -= boxNow.top + 12 - caretNow.top;
  else if (caretNow.bottom > boxNow.bottom - 12)
    box.scrollTop += caretNow.bottom - boxNow.bottom + 12;
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
  const x = caretBox.left + caretBox.width / 2 - stageBox.left;
  const y = caretBox.top - stageBox.top - cue.offsetHeight - 12;
  cue.style.left = `${x}px`;
  cue.style.top = `${Math.max(6, y)}px`;
}

export function paint() {
  if (!ctx.engine || !$("#typing")) return;
  const result = ctx.engine.result(),
    cursor = result.buffer.length,
    text = ctx.engine.attempt.text;
  let startAt = Math.max(0, Math.floor(cursor / 200) * 200 - 200);
  while (startAt > 0 && text[startAt - 1] !== " " && text[startAt - 1] !== "\n")
    startAt -= 1;
  let end = Math.min(text.length, startAt + 700);
  while (end < text.length && text[end] !== " " && text[end] !== "\n") end += 1;
  const { ms } = timings(text, ctx.engine.attempt.mode, ctx.engine.events);
  $("#typing").innerHTML = renderExercise(text, cursor, result, ms, startAt, end);
  keepCursorVisible($("#typing"));
  placeCue();
  $("#live-accuracy").textContent = result.attempted ? result.accuracy.toFixed(0) + "%" : "—";
  const live = liveWpm(result.correct, ctx.engine.milliseconds());
  $("#live-wpm").textContent = live === null ? "—" : live.toFixed(0);
  const seconds = Math.floor(
    (ctx.engine.attempt.duration
      ? ctx.engine.attempt.duration * 1000 - ctx.engine.milliseconds()
      : ctx.engine.milliseconds()) / 1000,
  );
  $("#timer").textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}${ctx.engine.attempt.duration ? " left" : ""}`;
  const held = holdingError(text, ctx.engine.attempt.mode, result.buffer);
  const target = held ? "Backspace" : text[cursor];
  const secure = profile().skill_stats[target]?.secure;
  const showHint = ctx.forceHints || !secure;
  document.querySelectorAll("[data-key]").forEach((element) => {
    const key = ctx.course.keyboard.flat().find((item) => item.key === element.dataset.key);
    const shiftHit =
      element.dataset.key === "Shift" &&
      oppositeShift(target) &&
      element.dataset.hand === oppositeShift(target);
    element.classList.toggle(
      "target",
      showHint &&
        (element.dataset.key === target ||
          key?.shift === target ||
          (target === "\n" && element.dataset.key === "Enter") ||
          shiftHit),
    );
  });
  const key = ctx.course.keyboard
    .flat()
    .find((item) => item.key === target || item.shift === target);
  const hint = $("#finger-hint");
  if (!showHint) hint.textContent = "";
  else if (target === "Backspace")
    hint.textContent = "Backspace · right little finger";
  else if (key)
    hint.textContent = `${key.finger} finger${key.shift === target ? " + opposite-hand Shift" : ""}`;
  else if (target === " ") hint.textContent = "Space · either thumb";
  else if (target === "\n") hint.textContent = "Enter · right little finger";
  else hint.textContent = keyLabel(target || "");
  $("#pause").disabled = !ctx.engine.running;
}
