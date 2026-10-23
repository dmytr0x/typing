import { action, dialog, esc, fingerSession, notify } from "./ui.js";
import { ctx, lesson, lessons, mutate, profile, saveSession } from "./api.js";
import { trainer } from "./trainer.js";
import { shorterLessonText } from "./text.js";
import { passageEditor, connectPassages } from "./passages.js";

let navigate = async () => {};
let start = async () => {};
export function connect(handlers) {
  navigate = handlers.navigate;
  start = handlers.start;
}

function notesFrom(attempt) {
  if (!attempt) return [];
  const errors = {},
    swaps = {};
  const buffer = [];
  for (const event of attempt.events) {
    if (event.key === "Backspace") {
      buffer.pop();
      continue;
    }
    const expected = attempt.text[buffer.length];
    if (expected == null) continue;
    if (expected !== event.key) {
      errors[expected] = (errors[expected] || 0) + 1;
      swaps[expected + "→" + event.key] = (swaps[expected + "→" + event.key] || 0) + 1;
    }
    buffer.push(event.key);
  }
  const notes = [];
  const worst = Object.entries(errors)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key]) => (key === " " ? "Space" : key === "\n" ? "Enter" : key.toUpperCase()));
  if (worst.length) notes.push("Most missed: " + worst.join(", ") + ".");
  const missed = Object.entries(errors).sort((a, b) => b[1] - a[1])[0];
  if (missed) {
    const finger = (ctx.course?.fingers || []).find((item) =>
      item.keys.includes(missed[0]),
    );
    if (finger) notes.push(`That key is assigned to the ${finger.id} finger on ${ctx.course.title}.`);
  }
  const swap = Object.entries(swaps).sort((a, b) => b[1] - a[1])[0];
  if (swap) {
    const [expected, actual] = swap[0].split("→");
    const left = expected === " " ? "Space" : expected === "\n" ? "Enter" : expected.toUpperCase();
    const right = actual === " " ? "Space" : actual === "\n" ? "Enter" : actual.toUpperCase();
    notes.push(`You typed ${right} for ${left}.`);
  }
  return notes;
}

function prefersStill() {
  return (
    document.body.classList.contains("no-motion") ||
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function formatDuration(ms) {
  const rounded = Math.round(ms / 1000);
  const total = ms > 0 && rounded === 0 ? 1 : Math.max(0, rounded);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function starsForAttempt(accuracy) {
  if (accuracy >= 99) return 5;
  if (accuracy >= 97) return 4;
  if (accuracy >= 95) return 3;
  if (accuracy >= 92) return 2;
  if (accuracy > 0) return 1;
  return 0;
}

function pointsFor(score) {
  return Math.round(
    score.accuracy * 20 + (score.wpm || 0) * 30 + (score.complete ? 200 : 0),
  );
}

function previousBest(result) {
  return Math.max(
    0,
    ...profile()
      .attempts.filter(
        (row) =>
          row.id !== result.id && row.course_id === result.course_id && row.curriculum_version === result.curriculum_version &&
          row.kind === result.kind && row.lesson_id === result.lesson_id &&
          row.duration === result.duration && row.paused === result.paused &&
          (["assessment", "challenge"].includes(result.kind)
            ? true : result.kind === "finger"
              ? row.finger === result.finger && row.title === result.title
              : row.text_digest === result.text_digest),
      )
      .map((row) => pointsFor(row.score)),
  );
}

function lessonLabel(result, item) {
  if (item) {
    const number = lessons().findIndex((row) => row.id === item.id) + 1;
    return `Lesson ${number}: ${item.title}`;
  }
  return (
    result.title ||
    {
      review: "Recommended practice",
      custom: "Your own words",
      assessment: "Timed assessment",
      placement: "Placement check",
      challenge: "Calm challenge",
      familiar: "Familiar text",
      finger: "Finger gym",
    }[result.kind] ||
    "Practice"
  );
}

function ringMarkup(progress, kind) {
  const p = Math.max(0, Math.min(1, progress || 0));
  return `<svg class="gauge-svg" viewBox="0 0 120 120" aria-hidden="true"><circle class="gauge-track" cx="60" cy="60" r="52"/><circle class="gauge-value is-${kind}" cx="60" cy="60" r="52" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" data-offset="${(100 - p * 100).toFixed(2)}"/></svg>`;
}

function starMarkup(filled, index) {
  return `<span class="summary-star${filled ? " is-filled" : ""}" style="--i:${index}" aria-hidden="true"><svg viewBox="0 0 64 64"><path d="M32 6.5 39.2 24l19.3 1.6-14.7 12.3 4.6 18.8L32 46.6 15.6 56.7l4.6-18.8L5.5 25.6 24.8 24z"/></svg></span>`;
}

function easeOut(t) {
  return 1 - (1 - t) ** 3;
}

function animateValue(el, to, duration, render) {
  if (!el) return;
  if (prefersStill()) {
    el.textContent = render(to);
    return;
  }
  const startAt = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - startAt) / duration);
    el.textContent = render(to * easeOut(t));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function playSummary({ accuracy, ms, wpm, points }) {
  const root = document.querySelector("#lesson-summary");
  const fill = () => {
    document.querySelectorAll("#lesson-summary .gauge-value").forEach((el) => {
      el.style.strokeDashoffset = el.dataset.offset;
    });
    root?.classList.add("is-ready");
  };
  if (prefersStill()) fill();
  else requestAnimationFrame(fill);
  animateValue(
    document.querySelector("#summary-accuracy"),
    accuracy,
    1100,
    (value) => `${Math.round(value)}%`,
  );
  animateValue(document.querySelector("#summary-duration"), ms, 1100, formatDuration);
  const wpmEl = document.querySelector("#summary-wpm");
  if (wpm == null) {
    if (wpmEl) wpmEl.textContent = "—";
  } else {
    animateValue(wpmEl, wpm, 1100, (value) => `${Math.round(value)}`);
  }
  animateValue(document.querySelector("#summary-points"), points, 1250, (value) =>
    `${Math.round(value)}`,
  );
  if (prefersStill()) root?.classList.add("is-settled");
  else setTimeout(() => root?.classList.add("is-settled"), 1400);
}

export function results() {
  if (!ctx.lastResult) return navigate("home");
  ctx.view = "results";
  document.body.classList.add("results-mode");
  document.body.classList.remove("lesson-mode");
  const result = ctx.lastResult,
    score = result.score,
    item = lesson(result.lesson_id, result.curriculum_version, result.course_id);
  const specific = notesFrom(ctx.lastAttempt);
  const tip = specific.length
    ? specific.join(" ")
    : score.wrong
      ? "Slow down slightly and return your fingers to home row after each reach."
      : "Keep that steady rhythm. Try looking at the text for the whole next exercise.";
  const placementNext = result.kind === "placement" && !profile().placement_done;
  const sessionNext =
    ctx.sessionPlan.length && ctx.sessionIndex + 1 < ctx.sessionPlan.length;
  const hasNext = placementNext || sessionNext;
  const threshold = item?.threshold ?? 95;
  const goal = profile().settings.speed_goal || 40;
  const stars = starsForAttempt(score.accuracy);
  const points = pointsFor(score);
  const best = previousBest(result), highscore = points > best;
  const tied = points > 0 && points === best;
  const shorterLength = item ? shorterLessonText(profile().settings.band === "adult" ? item.adult_text : item.text).length : 0;
  const canShorten = item && shorterLength < (ctx.lastAttempt?.text.length || 0);
  const title = lessonLabel(result, item);
  const speedScale = Math.max(80, goal, score.wpm || 0);
  const durationScale = Math.max(90000, score.elapsed_ms || 1);
  const status =
    result.kind === "assessment"
      ? "Assessment saved. " +
        (result.paused
          ? "Paused assessments remain practice and do not count toward proficiency."
          : "Your test duration is recorded alongside your score.")
      : score.complete
        ? result.passed
          ? "You completed the exercise. Your next step is ready."
          : `Accuracy was ${score.accuracy.toFixed(1)}%; this lesson needs ${threshold}%. Take a break or try a careful repeat.`
        : "Timed practice complete; only attempted positions were scored.";
  const spoken = [
    title,
    result.passed ? "Passed." : "Keep practicing.",
    `Accuracy ${score.accuracy.toFixed(1)} percent.`,
    `Duration ${formatDuration(score.elapsed_ms)}.`,
    score.wpm == null
      ? "Speed not yet available."
      : `Speed ${score.wpm.toFixed(1)} words per minute.`,
    `${stars} of 5 stars.`,
    `Score ${points}${highscore ? ", new highscore" : ""}.`,
  ].join(" ");
  document.querySelector("#main").innerHTML = `
    <section id="lesson-summary" class="summary" aria-label="Lesson summary">
      <header class="summary-bar">
        <h1>${esc(title)}</h1>
        <p class="summary-learner">${esc(profile().settings.avatar)} ${esc(profile().settings.name)}</p>
      </header>
      <p class="visually-hidden">${esc(spoken)}</p>
      <div class="result-recommendation"><h2>${result.lesson_id ? result.passed ? "Lesson passed" : "More accuracy practice will help" : "Practice saved"}</h2><p>${esc(status)}</p></div>
      <div class="summary-stage">
        <div class="summary-stars" aria-hidden="true">${[1, 2, 3, 4, 5].map((n) => starMarkup(n <= stars, n - 1)).join("")}</div>
        <div class="summary-gauges">
          <div class="summary-gauge is-accuracy">
            <p class="gauge-aside is-start">${threshold}% to pass</p>
            <div class="gauge-dial">${ringMarkup(score.accuracy / 100, "accuracy")}<div class="gauge-readout"><strong id="summary-accuracy">0%</strong><span class="gauge-sub">${score.first_correct} of ${score.first_attempted} first tries</span></div></div>
            <h2>accuracy</h2>
          </div>
          <div class="summary-gauge is-duration">
            <div class="gauge-dial">${ringMarkup(score.elapsed_ms / durationScale, "duration")}<div class="gauge-readout"><strong id="summary-duration">0:00</strong><span class="gauge-sub">min : sec</span></div></div>
            <h2>duration</h2>
          </div>
          <div class="summary-gauge is-speed">
            <p class="gauge-aside is-end">${goal} wpm goal</p>
            <div class="gauge-dial">${ringMarkup((score.wpm || 0) / speedScale, "speed")}<div class="gauge-readout"><strong id="summary-wpm">0</strong><span class="gauge-sub">wpm</span></div></div>
            <h2>speed</h2>
          </div>
        </div>
        <div class="summary-score">
          <strong id="summary-points">0</strong>
          <p>${highscore ? "New personal best for this exercise" : tied ? "Matched personal best" : "Score"}</p>
        </div>
      </div>
      <div class="summary-follow">
        <div class="banner">${esc(tip)}</div>
        ${result.kind === "placement" ? `<p>Placement sampled ${profile().placement_stage} of 4 skill groups successfully. ${profile().placement_done ? "Use the recommendation to begin with untested keys, or start from the beginning. Demonstrated groups are marked skipped, not mastered." : "Continue to sample the next group."}</p>` : ""}
        ${result.lesson_id?.endsWith("-5") ? `<label><input id="look-down" type="checkbox"> I did not look down (optional note, not proof of technique)</label>` : ""}
        <div class="actions">
          <button id="recommended-next" class="primary">${!result.passed && result.lesson_id ? "Practice this lesson again" : hasNext ? "Continue →" : "Done"}</button>
          ${!result.passed && result.lesson_id ? `<button id="result-continue">${hasNext ? "Continue →" : "Done"}</button>` : ""}
          ${!result.passed && canShorten ? `<button id="result-shorter">Retry shorter · ${shorterLength} characters</button>` : ""}
          ${result.kind === "placement" && profile().placement_stage > 0 ? '<button id="apply-placement">Use placement recommendation</button>' : ""}
          ${result.passed || !result.lesson_id ? '<button id="result-retry">Try again</button>' : ""}
          <button id="result-targeted">Targeted practice</button>
          ${hasNext ? '<button id="result-home">Finish for now</button>' : ""}
        </div>
        <details class="summary-scoring small"><summary>How speed is calculated</summary><p>WPM here means correctly completed characters ÷ 5 ÷ active minutes. Deleted characters are not counted twice. A speed value needs at least 10 correct characters and 5 seconds.</p></details>
      </div>
    </section>`;
  playSummary({
    accuracy: score.accuracy,
    ms: score.elapsed_ms,
    wpm: score.wpm,
    points,
  });
  let advancing = false;
  const continueResult = async () => {
    if (advancing) return;
    advancing = true;
    try {
    if (result.kind === "placement" && !profile().placement_done)
      return start({ kind: "placement" });
    ctx.sessionIndex += 1;
    saveSession();
    if (ctx.sessionPlan.length && ctx.sessionIndex < ctx.sessionPlan.length)
      return start(ctx.sessionPlan[ctx.sessionIndex]);
    ctx.sessionPlan = [];
    saveSession();
    await navigate("home");
    } catch (error) { advancing = false; throw error; }
  };
  action("result-continue", continueResult);
  action("recommended-next", () => !result.passed && result.lesson_id
    ? start({ kind: "lesson", lesson_id: result.lesson_id }) : continueResult());
  action("apply-placement", async () => {
    if (
      !(await dialog({
        title: "Use this placement?",
        body: "Demonstrated groups will be marked skipped, not mastered. You can review them anytime.",
        confirmLabel: "Apply",
      }))
    )
      return;
    await mutate(() => trainer.applyPlacement(ctx.profileId));
    await navigate("course");
  });
  action("result-retry", () =>
    start(
      result.lesson_id
        ? { kind: "lesson", lesson_id: result.lesson_id }
        : {
            kind: result.kind,
            text: result.kind === "custom" ? ctx.lastAttempt.text : "",
            finger: ctx.lastAttempt?.finger || "",
            phase: ctx.lastAttempt?.phase || 0,
          },
    ),
  );
  action("result-shorter", () =>
    start({ kind: "lesson", lesson_id: result.lesson_id, shorter: true }),
  );
  action("result-targeted", () => {
    const finger =
      ctx.lastAttempt?.finger || ctx.recommendation?.weak_fingers?.[0]?.id;
    ctx.sessionPlan = finger ? fingerSession(finger) : [];
    ctx.sessionIndex = 0;
    return start(finger ? ctx.sessionPlan[0] : { kind: "review" });
  });
  action("result-home", () => {
    ctx.sessionPlan = [];
    saveSession();
    return navigate("home");
  });
  const box = document.querySelector("#look-down");
  if (box)
    box.onchange = async () => {
      if (!box.checked) return;
      await mutate(() =>
        trainer.selfCheck(ctx.profileId, result.lesson_id, "I did not look down"),
      );
    };
  document.querySelector("#recommended-next")?.focus({ preventScroll: true });
}

export async function practice() {
  ctx.recommendation = await trainer.recommendation(ctx.profileId);
  const fingers = ctx.recommendation.fingers || [];
  const gym = fingers
    .filter((finger) => finger.taught_keys)
    .map((finger) => {
      const label = finger.weak ? "Needs practice" : finger.slow ? "Slow" : "Train";
      return `<button type="button" data-finger="${esc(finger.id)}" class="${finger.weak ? "primary" : ""}">${esc(finger.label)} · ${label}</button>`;
    })
    .join("");
  document.querySelector("#main").innerHTML =
    `<div class="eyebrow">Make it your own</div><h1>Pick your playground</h1><p>Follow a recommendation or choose what feels useful today.</p><div class="grid"><section class="card"><h2>A personal warm-up</h2><p>${esc(ctx.recommendation.explanation)}</p><button id="weak" class="primary">Practice recommended keys</button></section><section class="card"><h2>Selected keys</h2><form id="selected-form"><label>Already introduced keys<input id="selected-keys" value="${esc(ctx.recommendation.keys)}" maxlength="100"></label><button id="selected">Start focused practice</button></form></section><section class="card"><h2>Words & passages</h2><p>Revisit familiar words and natural sentences from keys you already know.</p><button id="words">Practice familiar text</button></section><section class="card"><h2>A moment of focus</h2><p>${profile().settings.assessment_seconds} seconds of mixed text. Hints are hidden. Pausing makes this a practice result.</p><button id="timed">Start timed assessment</button></section></div><section class="card"><h2>Finger gym</h2><p>Specialized lessons for one finger at a time: isolated keys, a rhythm drill, then words. Keys are inferred from US QWERTY assignments; the app cannot see which finger you used.</p><div class="actions finger-gym">${gym || '<p class="small">Finish a lesson to unlock finger drills.</p>'}</div></section>${passageEditor()}<div class="actions"><button id="challenge" ${Object.keys(profile().lesson_progress).length === ctx.course.lessons.length ? "" : "disabled"}>Calm challenge · opens after the course</button></div>`;
  action("weak", () => start({ kind: "review" }));
  document.querySelector("#selected-form").onsubmit = (event) => {
    event.preventDefault();
    start({ kind: "review", keys: document.querySelector("#selected-keys").value }).catch(
      (error) => notify(error.message),
    );
  };
  action("words", () => start({ kind: "familiar" }));
  action("timed", () => start({ kind: "assessment" }));
  connectPassages(start);
  action("challenge", () => start({ kind: "challenge" }));
  document.querySelectorAll("[data-finger]").forEach((button) => {
    button.onclick = () => {
      ctx.sessionPlan = fingerSession(button.dataset.finger);
      ctx.sessionIndex = 0;
      return start(ctx.sessionPlan[0]).catch((error) => notify(error.message));
    };
  });
}
