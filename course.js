import { dialog, esc, notify } from "./ui.js";
import { ctx, lesson, lessons, mutate, profile } from "./api.js";
import { trainer } from "./trainer.js";

let start = async () => {};
export function connect(handlers) {
  start = handlers.start;
}

const LEVELS = [
  {
    id: "basic",
    title: "Basic",
    blurb: "Letter keys, starting on home row and reaching up and down.",
    until: 15,
  },
  {
    id: "intermediate",
    title: "Intermediate",
    blurb: "Fluent lowercase, then capitals and Enter.",
    until: 21,
  },
  {
    id: "advanced",
    title: "Advanced",
    blurb: "Punctuation, numbers, and the rest of the keyboard.",
    until: 28,
  },
];
const PHASES = [
  "Meet the keys",
  "Find a rhythm",
  "Build connections",
  "Use your skills",
  "Checkpoint",
];

function groupNumber(item) {
  return Number(item.id.slice(1, 3));
}

function phaseIndex(item) {
  return Number(item.id.split("-")[1]) - 1;
}

function levelOf(item) {
  const group = groupNumber(item);
  return LEVELS.find((level) => group <= level.until);
}

function unlocked(item, progress) {
  return !item.prerequisite || Boolean(progress[item.prerequisite]);
}

function secureLesson(item, progress, skills) {
  return (
    progress?.status === "completed" &&
    [...new Set(item.allowed)].every((key) => skills[key]?.secure)
  );
}

function tally(items, progress) {
  const finished = items.filter((item) => progress[item.id]).length;
  return { finished, total: items.length, remaining: items.length - finished };
}

function starsFor(progress) {
  if (progress?.status !== "completed") return 0;
  const accuracy = progress.best_accuracy || 0;
  if (accuracy >= 99) return 5;
  if (accuracy >= 97) return 4;
  if (accuracy >= 95) return 3;
  if (accuracy >= 92) return 2;
  return 1;
}

function nextLesson(all, progress) {
  return (
    all.find((item) => !progress[item.id] && unlocked(item, progress)) ||
    all.find((item) => !progress[item.id])
  );
}

function lessonState(item, progress, nextId, attempted, skills) {
  const record = progress[item.id];
  if (!unlocked(item, progress)) return "locked";
  if (secureLesson(item, record, skills)) return "mastered";
  if (record?.status === "completed") return "done";
  if (record?.status === "skipped") return "skipped";
  if (item.id === nextId) return "next";
  if (attempted) return "progress";
  return "available";
}

function statusText(state) {
  return {
    locked: "Locked",
    mastered: "Mastered",
    done: "Completed",
    skipped: "Skipped",
    next: "Up next",
    progress: "In progress",
    available: "Available",
  }[state];
}

function actionText(state, activeLessonId, itemId) {
  if (activeLessonId === itemId) return "Resume";
  if (state === "locked") return "Locked";
  if (state === "done" || state === "mastered" || state === "skipped") return "Review";
  if (state === "progress") return "Continue";
  return "Begin";
}

function keyGlyphs(keys) {
  if (!keys) return `<span class="key-glyph wide">a–z</span>`;
  return [...keys]
    .slice(0, 4)
    .map((ch) => {
      if (ch === " ") return `<span class="key-glyph wide is-space" title="Space"></span>`;
      const label = ch === "\n" ? "↵" : ch;
      return `<span class="key-glyph${ch === "\n" ? " wide" : ""}">${esc(label)}</span>`;
    })
    .join("");
}

function markHtml(state) {
  if (state === "locked")
    return `<span class="lesson-mark is-locked" title="Locked"></span>`;
  if (state === "next") return `<span class="lesson-mark is-play" title="Up next"></span>`;
  if (state === "skipped")
    return `<span class="lesson-mark is-skipped" title="Skipped"></span>`;
  if (state === "progress")
    return `<span class="lesson-mark is-progress" title="In progress"></span>`;
  if (state === "done" || state === "mastered")
    return `<span class="lesson-mark is-check${state === "mastered" ? " is-mastered" : ""}" title="${state === "mastered" ? "Mastered" : "Completed"}"></span>`;
  return "";
}

function starHtml(count) {
  if (!count) return "";
  return `<span class="lesson-stars" aria-hidden="true">${[1, 2, 3, 4, 5]
    .map((n) => `<span${n <= count ? ' class="filled"' : ""}>★</span>`)
    .join("")}</span>`;
}

function unitsOf(items) {
  const units = [];
  for (const item of items) {
    const prefix = item.id.split("-")[0];
    const current = units.at(-1);
    if (!current || current.prefix !== prefix)
      units.push({
        prefix,
        title: item.group,
        keys: item.new_keys,
        lessons: [item],
      });
    else {
      current.lessons.push(item);
      if (item.new_keys) current.keys = item.new_keys;
    }
  }
  return units;
}

function stagesOf(items) {
  const stages = [];
  for (const item of items) {
    const current = stages.at(-1);
    if (!current || current.title !== item.stage)
      stages.push({ title: item.stage, lessons: [item] });
    else current.lessons.push(item);
  }
  return stages;
}

function scrollToId(id) {
  document.getElementById(id)?.scrollIntoView({
    behavior: document.body.classList.contains("no-motion") ? "auto" : "smooth",
    block: "center",
  });
}

function nowBanner(p, next, overall) {
  if (p.active_session) {
    const current = lesson(p.active_session.lesson_id);
    return `<section class="course-now"><div><p class="eyebrow">Right where you left off</p><h2>${esc(current?.title || "Saved practice")}</h2><p>Resume from your last saved checkpoint. Take your time.</p></div><div class="actions"><button type="button" class="primary" id="course-begin">Resume practice</button></div></section>`;
  }
  if (!next)
    return `<section class="course-now is-complete"><div><p class="eyebrow">Course complete</p><h2>You have walked the whole path.</h2><p>Review any lesson to keep the keys warm. Skipped means the path is open; mastered means two later successful reviews.</p></div></section>`;
  const level = levelOf(next);
  const started = p.attempts.some((result) => result.lesson_id === next.id);
  const fresh = overall.finished === 0;
  return `<section class="course-now"><div><p class="eyebrow">${fresh ? "Start here" : "Continue here"} · ${esc(level.title)} · ${esc(next.stage)}</p><h2>${esc(next.title)}</h2><p>Lesson ${overall.finished + 1} of ${overall.total} · ${next.threshold}% accuracy to pass</p></div><div class="actions"><button type="button" class="primary" id="course-begin">${started ? "Continue" : "Begin"}</button><button type="button" class="subtle" data-skip="${esc(next.id)}">Skip</button><button type="button" class="subtle" id="show-on-path">Show on the path</button></div></section>`;
}

function lessonCard(item, number, p, nextId, groupKeys) {
  const record = p.lesson_progress[item.id];
  const attempted = p.attempts.some((result) => result.lesson_id === item.id);
  const state = lessonState(item, p.lesson_progress, nextId, attempted, p.skill_stats);
  const phase = PHASES[phaseIndex(item)] || item.title;
  const action = actionText(state, p.active_session?.lesson_id, item.id);
  const label = `${number}. ${item.title}. ${statusText(state)}. ${action}.`;
  const stars = state === "done" || state === "mastered" ? starsFor(record) : 0;
  return `<button type="button" class="lesson-card is-${esc(state)}" data-lesson="${esc(item.id)}" ${
    state === "locked" ? "disabled" : ""
  } ${item.id === nextId ? 'id="course-next" aria-current="step"' : ""} aria-label="${esc(label)}"><span class="lesson-card-top"><span class="lesson-card-num">${number}</span>${
    state === "next" ? '<span class="lesson-next-tag">Next</span>' : ""
  }${markHtml(state)}</span><span class="key-glyphs">${keyGlyphs(item.new_keys || groupKeys)}</span><span class="lesson-card-title">${esc(phase)}</span>${starHtml(stars)}</button>`;
}

function bindCourse(p, next) {
  document.querySelector("#course-begin")?.addEventListener("click", () => {
    const run = p.active_session
      ? start(null, p.active_session)
      : start({ kind: "lesson", lesson_id: next.id });
    run.catch((error) => notify(error.message));
  });
  document.querySelector("#show-on-path")?.addEventListener("click", () =>
    scrollToId("course-next"),
  );
  document.querySelectorAll("[data-jump]").forEach((button) => {
    button.onclick = () => scrollToId(button.dataset.jump);
  });
  document.querySelectorAll("[data-lesson]").forEach((button) => {
    button.onclick = () => {
      start(
        { kind: "lesson", lesson_id: button.dataset.lesson },
        p.active_session?.lesson_id === button.dataset.lesson ? p.active_session : undefined,
      ).catch((error) => notify(error.message));
    };
  });
  document.querySelectorAll("[data-skip]").forEach((button) => {
    button.onclick = async () => {
      if (
        !(await dialog({
          title: "Skip this step?",
          body: "It will be marked skipped, not mastered. You can review it later.",
          confirmLabel: "Skip",
        }))
      )
        return;
      try {
        await mutate(() => trainer.skipLesson(ctx.profileId, button.dataset.skip));
        courseView();
      } catch (error) {
        notify(error.message);
      }
    };
  });
}

export function courseView() {
  const p = profile();
  const all = lessons();
  const next = nextLesson(all, p.lesson_progress);
  const overall = tally(all, p.lesson_progress);
  const percent = overall.total
    ? Math.round((overall.finished / overall.total) * 100)
    : 0;
  const skipped = Object.values(p.lesson_progress).filter(
    (item) => item.status === "skipped",
  ).length;
  let number = 0;
  const path = `<ol class="course-path">${LEVELS.map((level) => {
    const items = all.filter((item) => levelOf(item).id === level.id);
    const stats = tally(items, p.lesson_progress);
    const current = next && levelOf(next).id === level.id;
    const complete = stats.total > 0 && stats.finished === stats.total;
    return `<li class="${current ? "is-current" : ""} ${complete ? "is-complete" : ""}"><button type="button" data-jump="level-${esc(level.id)}">${esc(level.title)} · ${stats.finished}/${stats.total}</button></li>`;
  }).join("")}</ol>`;
  const levels = LEVELS.map((level) => {
    const items = all.filter((item) => levelOf(item).id === level.id);
    const stats = tally(items, p.lesson_progress);
    const current = next && levelOf(next).id === level.id;
    const complete = stats.total > 0 && stats.finished === stats.total;
    const stages = stagesOf(items)
      .map((stage) => {
        const stageStats = tally(stage.lessons, p.lesson_progress);
        const open =
          (next && stage.lessons.some((item) => item.id === next.id)) ||
          stage.lessons.some(
            (item) =>
              !p.lesson_progress[item.id] &&
              p.attempts.some((result) => result.lesson_id === item.id),
          );
        const units = unitsOf(stage.lessons)
          .map((unit) => {
            const unitStats = tally(unit.lessons, p.lesson_progress);
            const cards = unit.lessons
              .map((item) => lessonCard(item, ++number, p, next?.id, unit.keys))
              .join("");
            return `<div class="lesson-unit"><h4>${esc(unit.title)} <span class="small">${unitStats.finished}/${unitStats.total}</span></h4><div class="lesson-grid">${cards}</div></div>`;
          })
          .join("");
        return `<details class="course-stage" ${open ? "open" : ""}><summary><span class="course-stage-title">${esc(stage.title)}</span><span class="small">${stageStats.finished} of ${stageStats.total}${stageStats.remaining ? ` · ${stageStats.remaining} left` : " · done"}</span></summary>${units}</details>`;
      })
      .join("");
    return `<section class="course-level${current ? " is-current" : ""}${complete ? " is-complete" : ""}" id="level-${esc(level.id)}"><header class="course-level-header"><div><p class="eyebrow">${complete ? "Finished" : current ? "You are here" : "Up ahead"}</p><h2>${esc(level.title)}</h2><p>${esc(level.blurb)}</p></div><div class="course-level-meter"><strong>${stats.finished}/${stats.total}</strong><progress value="${stats.finished}" max="${stats.total}"></progress><span class="small">${stats.remaining ? stats.remaining + " remaining" : "Level complete"}</span></div></header>${stages}</section>`;
  }).join("");
  document.querySelector("#main").innerHTML =
    `<div class="eyebrow">Small steps, big high-fives</div><h1>Your keyboard path</h1><p>Basic, Intermediate, then Advanced. The highlighted lesson is where you are now — no need to open every group to find it.</p>${nowBanner(
      p,
      next,
      overall,
    )}<div class="course-stats"><span><strong>${percent}%</strong> along the path</span><span>${overall.finished} finished</span>${skipped ? `<span>${skipped} skipped</span>` : ""}<span>${overall.remaining} to go</span><progress value="${overall.finished}" max="${overall.total}"></progress></div>${path}${levels}<p class="small">Skipped means the path is open; mastered means two later successful reviews. They are not the same.</p>`;
  bindCourse(p, next);
}
