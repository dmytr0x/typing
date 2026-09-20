import { checkpoint, ctx, mutate, profile, saveError } from "./api.js";
import { bindTrainer, trainer } from "./trainer.js";
import { $, applyTheme, dialog, notify } from "./ui.js";
import { courseView, connect as connectCourse } from "./course.js";
import { home, picker, connect as connectHome } from "./home.js";
import { openAttempt, paint, connect as connectLesson } from "./lesson.js?v=11";
import { progressView, connect as connectProgress } from "./progress.js";
import { practice, results, connect as connectResults } from "./results.js";
import { settingsView, connect as connectSettings } from "./settings.js";

const MAIN_VIEWS = ["home", "course", "practice", "progress", "settings", "profiles"];

function viewFromHash() {
  const next = location.hash.replace("#", "") || "home";
  return MAIN_VIEWS.includes(next) || next === "lesson" || next === "results"
    ? next
    : "home";
}

function chrome() {
  document.body.classList.toggle("lesson-mode", ctx.view === "lesson");
  document.body.classList.toggle("results-mode", ctx.view === "results");
  applyTheme(profile());
  if (ctx.view === "results")
    $("meta[name=theme-color]")?.setAttribute("content", "#3d4a7c");
  const skip = document.querySelector("#skip-link");
  if (skip) skip.href = ctx.view === "lesson" ? "#typing" : "#main";
  $("#profile-button").textContent = profile()
    ? `${profile().settings.avatar} ${profile().settings.name} · Switch`
    : "Choose a learner";
  $("#nav").innerHTML = profile()
    ? ["Home", "Course", "Practice", "Progress", "Settings"]
        .map(
          (name, i) =>
            `<button data-view="${name.toLowerCase()}" class="${ctx.view === name.toLowerCase() ? "active" : ""}">${["⌂", "▤", "⌨", "◷", "⚙"][i]} &nbsp; ${name}</button>`,
        )
        .join("")
    : "";
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.onclick = () => navigate(button.dataset.view);
  });
}

export async function navigate(next, { fromHash = false } = {}) {
  try {
    if (ctx.pendingFinish)
      throw new Error("Save or export your pending result before leaving this exercise.");
    if (ctx.engine) {
      ctx.engine.pause();
      await checkpoint();
      ctx.engine = null;
    }
    ctx.view = next;
  if (!fromHash && location.hash !== "#" + next) location.hash = next;
  chrome();
  await render();
  } catch (error) {
    notify(error.message);
  }
}

async function render() {
  if (!profile()) {
    await picker();
    if (!profile()) chrome();
    return;
  }
  chrome();
  if (ctx.view === "home") await home();
  else if (ctx.view === "course") courseView();
  else if (ctx.view === "practice") await practice();
  else if (ctx.view === "progress") {
    await progressView();
    document
      .querySelectorAll("[data-height]")
      .forEach((bar) => (bar.style.height = bar.dataset.height + "%"));
  } else if (ctx.view === "settings") settingsView();
  else if (ctx.view === "results") results();
  else if (ctx.view === "lesson" && profile().active_session)
    openAttempt(profile().active_session);
  else await home();
}

async function start(options, existing) {
  if (existing) {
    openAttempt(existing);
    chrome();
    return;
  }
  const saved = profile().active_session;
  if (saved) {
    if (!options) {
      openAttempt(saved);
      chrome();
      return;
    }
    const sameLesson =
      options.kind === "lesson" &&
      saved.lesson_id &&
      options.lesson_id === saved.lesson_id;
    if (sameLesson) {
      openAttempt(saved);
      chrome();
      return;
    }
    const replace = await dialog({
      title: "Saved practice is waiting",
      body: "Abandon the saved exercise and start this one? You can also finish later from the exercise itself.",
      confirmLabel: "Start this instead",
      cancelLabel: "Keep saved practice",
      danger: true,
    });
    if (!replace) return;
    await ctx.saveQueue;
    await mutate(() => trainer.abandonAttempt(ctx.profileId, saved.id));
  }
  await mutate(() => trainer.startAttempt(ctx.profileId, options));
  openAttempt(profile().active_session);
  chrome();
}

async function complete() {
  if (!ctx.engine) return;
  ctx.pendingFinish = true;
  const current = ctx.engine;
  try {
    await ctx.saveQueue.catch(() => {});
    await mutate(() =>
      trainer.finishAttempt(current.attempt.owner, current.attempt.id, current.snapshot()),
    );
    ctx.lastAttempt = current.attempt;
    ctx.lastResult = profile().attempts.find((result) => result.id === current.attempt.id);
    ctx.engine = null;
    ctx.pendingFinish = false;
    results();
    chrome();
    location.hash = "results";
  } catch (error) {
    saveError(error);
  }
}

const handlers = { navigate, start, complete, picker };
connectHome(handlers);
connectCourse(handlers);
connectLesson(handlers);
connectResults(handlers);
connectProgress(handlers);
connectSettings(handlers);

$("#profile-button").onclick = async () => {
  try {
    if (ctx.pendingFinish)
      throw new Error("Save your pending result before switching learners.");
    if (ctx.engine) {
      ctx.engine.pause();
      await checkpoint();
      ctx.engine = null;
    }
    ctx.sessionPlan = [];
    await picker(true);
    chrome();
    location.hash = "profiles";
  } catch (error) {
    notify(error.message);
  }
};

window.addEventListener("hashchange", () => {
  const next = viewFromHash();
  if (next === ctx.view) return;
  const allowed =
    MAIN_VIEWS.includes(next) ||
    (next === "lesson" && profile()?.active_session) ||
    (next === "results" && ctx.lastResult);
  navigate(allowed ? next : "home", { fromHash: true });
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && ctx.engine?.running) {
    ctx.engine.pause();
    ctx.dirty = true;
    checkpoint().catch(saveError);
  }
});
setInterval(() => {
  if (ctx.engine?.running) {
    ctx.engine.tick();
    if (ctx.engine) paint();
  }
}, 200);
setInterval(() => {
  if (ctx.engine && (ctx.dirty || ctx.engine.running) && !ctx.engine.finished)
    checkpoint().catch(saveError);
}, 2000);
setInterval(() => {
  if (!ctx.engine?.running) return;
  const boundary = Math.floor(ctx.engine.milliseconds() / 600000);
  if (boundary > 0 && boundary !== ctx.stretchBoundary) {
    ctx.stretchBoundary = boundary;
    notify("A good moment to relax your hands. Pause whenever you like.");
  }
}, 10000);
window.addEventListener("beforeunload", (event) => {
  if (ctx.engine && (ctx.dirty || ctx.pendingFinish)) {
    event.preventDefault();
    event.returnValue = "";
  }
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () =>
  applyTheme(profile()),
);

try {
  await bindTrainer();
  [ctx.state, ctx.course] = await Promise.all([trainer.getState(), trainer.getCourse()]);
  const initial = viewFromHash();
  if (initial === "lesson" && profile()?.active_session) ctx.view = "lesson";
  else ctx.view = MAIN_VIEWS.includes(initial) ? initial : "home";
  if (!location.hash) history.replaceState({ view: "home" }, "", "#home");
  await render();
} catch (error) {
  $("#main").innerHTML =
    `<section class="card"><h1>Your progress needs attention.</h1><p>${error.message}</p>${error.recovery ? '<button id="recover" class="primary">Restore last valid backup</button>' : '<button id="reload">Try again</button>'}<p class="small">${trainer?.kind === "local" ? "No progress has been reset. A browser backup can restore the last valid household." : "No progress has been reset. Keep the data folder intact."}</p></section>`;
  document.querySelector("#recover")?.addEventListener("click", async () => {
    await trainer.recover();
    location.reload();
  });
  document.querySelector("#reload")?.addEventListener("click", () => location.reload());
}
