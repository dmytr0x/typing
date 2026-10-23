import { checkpoint, ctx, mutate, profile, saveError, clearDraft, keepDraft, onHouseholdChange, coordinator, saveSession, restoreSession, householdProfile, selectCourse, restoreCourseSelection, download } from "./api.js";
import { bindTrainer, trainer } from "./trainer.js";
import { $, applyTheme, dialog, notify, keyboardAccess, esc, status } from "./ui.js";
import { courseView, connect as connectCourse } from "./course.js";
import { home, picker, connect as connectHome } from "./home.js";
import { openAttempt, paint, connect as connectLesson } from "./lesson.js?v=12";
import { progressView, connect as connectProgress } from "./progress.js";
import { practice, results, connect as connectResults } from "./results.js";
import { settingsView, connect as connectSettings } from "./settings.js";
import { getCourse as bundledCourse } from "./course-registry.js";
import { offerDraft, startupRecovery } from "./recovery.js";

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
  const skip = document.querySelector("#skip-link");
  if (skip) skip.href = ctx.view === "lesson" ? "#typing" : "#main";
  $("#profile-button").textContent = profile()
    ? `${profile().settings.avatar} ${profile().settings.name} · Switch`
    : "Choose a learner";
  $("#nav").innerHTML = profile()
    ? ["Home", "Course", "Practice", "Progress", "Settings"]
        .map(
          (name, i) =>
            `<button data-view="${name.toLowerCase()}" ${ctx.view === name.toLowerCase() ? 'aria-current="page"' : ""} class="${ctx.view === name.toLowerCase() ? "active" : ""}">${["⌂", "▤", "⌨", "◷", "⚙"][i]} &nbsp; ${name}</button>`,
        )
        .join("")
    : "";
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.onclick = () => navigate(button.dataset.view);
  });
  let selector = document.querySelector("#course-selector");
  if (!selector) {
    const label = document.createElement("label"); label.id = "course-choice";
    label.innerHTML = 'Course <select id="course-selector" aria-label="Typing course"></select>';
    document.querySelector("#profile-button").before(label);
    selector = label.querySelector("select");
  }
  const choice = selector.closest("label");
  choice.hidden = !profile();
  const courseSlot = ctx.view === "lesson" ? document.querySelector(".lesson-panel") : ctx.view === "results" ? document.querySelector(".summary-bar") : null;
  if (courseSlot) courseSlot.insertBefore(choice, courseSlot.querySelector(".stats"));
  else document.querySelector("#profile-button").before(choice);
  const catalog = [...ctx.catalog];
  for (const [id, value] of Object.entries(householdProfile()?.courses || {})) if (!catalog.some(c => c.id === id)) {
    try { const definition = bundledCourse(id,value.curriculum_version).data; catalog.push({id,title:definition.title,layout_id:definition.layout_id}); }
    catch { catalog.push({id, title: `${id} · unavailable (version ${value.curriculum_version})`, layout_id: "unavailable"}); }
  }
  selector.innerHTML = catalog.map(c => `<option value="${esc(c.id)}" ${c.id === ctx.courseId ? "selected" : ""}>${esc(c.title)}</option>`).join("");
  selector.onchange = () => switchCourse(selector.value);
  document.querySelector("#course-context")?.remove();
  const context = document.createElement("p"); context.id = "course-context";
  context.textContent = profile() ? `${ctx.course?.title || ctx.courseId}` : "";
  document.querySelector("#nav").prepend(context);
  keyboardAccess();
}

let switchingCourse = false;
async function switchCourse(courseId) {
  if (switchingCourse || ctx.recovering) { chrome(); return; }
  switchingCourse = true;
  ctx.recovering = true;
  const main = $("#main"), wasInert = main.inert;
  main.inert = true;
  $("#course-selector").disabled = true;
  try {
    if (ctx.pendingFinish || ctx.engine?.finished) throw new Error("Save or export the pending result before switching courses.");
    // Freeze input and the assessment clock before draining writes. Keep the
    // lock through definition loading, so no keys can arrive after the pause
    // acknowledgement and then disappear when the engine is replaced.
    ctx.engine?.pause();
    status("Saving before switching courses…");
    await coordinator.tail;
    if (ctx.pendingFinish || ctx.engine?.finished) throw new Error("Save or export the pending result before switching courses.");
    if (ctx.engine) {
      ctx.engine.pause(); await checkpoint();
      const saved = householdProfile()?.courses[ctx.engine.attempt.course_id]?.active_session;
      if (!saved || saved.id !== ctx.engine.attempt.id || saved.status !== "paused") throw new Error("Paused checkpoint was not acknowledged; retry or export pending work.");
    }
    status("Opening course…");
    await selectCourse(courseId);
    ctx.engine = null; ctx.pendingFinish = false; ctx.dirty = false;
    ctx.sessionPlan = []; ctx.sessionIndex = 0; ctx.lastResult = null; ctx.lastAttempt = null;
    restoreSession(); ctx.view = "home";
    location.hash = "home"; await render();
    status("Saved on this computer");
  } catch (error) { if (ctx.engine) saveError(error); else notify(error.message); chrome(); }
  finally {
    ctx.recovering = false; switchingCourse = false; main.inert = wasInert;
    if ($("#course-selector")) $("#course-selector").disabled = false;
  }
}

export async function navigate(next, { fromHash = false } = {}) {
  try {
    if (ctx.pendingFinish)
      throw new Error("Retry saving, or choose Discard pending work to leave this exercise.");
    if (ctx.engine) {
      ctx.engine.pause();
      await checkpoint();
      ctx.engine = null;
    }
    await coordinator.tail;
    ctx.view = next;
  if (!fromHash && location.hash !== "#" + next) location.hash = next;
  chrome();
  await render();
  if (!["lesson", "results"].includes(ctx.view)) $("#main").focus({ preventScroll: true });
  } catch (error) {
    notify(error.message);
  }
}

async function render() {
  if (!profile()) {
    await picker();
    keyboardAccess();
    if (!profile()) chrome();
    return;
  }
  chrome();
  if (ctx.view !== "settings" && ctx.view !== "profiles" && ctx.course.unavailable) {
    $("#main").innerHTML = `<section class="card"><h1>${esc(ctx.courseId)} is unavailable</h1><p>Saved progress and exercises are retained. Practice requires the compatible course definition.</p><button id="unavailable-export">Export all course progress</button><button id="unavailable-settings">Backups and settings</button></section>`;
    $("#unavailable-export").onclick = async () => download("hearth-backup.json", await trainer.exportState(ctx.profileId));
    $("#unavailable-settings").onclick = () => navigate("settings");
    return;
  }
  if (!["settings", "profiles"].includes(ctx.view) && !householdProfile().courses[ctx.courseId]) {
    $("#main").innerHTML = `<section class="card"><h1>${esc(ctx.course.title)}</h1><p>This course has its own lessons, saved exercise and progress.</p><button id="enroll-course" class="primary">Start this course</button></section>`;
    $("#enroll-course").onclick = async () => { try { await mutate(() => trainer.enrollCourse(ctx.profileId)); await render(); } catch (error) { notify(error.message); } };
    return;
  }
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
  keyboardAccess();
}

let starting = false;
async function start(options, existing) {
  if (starting) return;
  starting = true;
  try { await startOnce(options, existing); }
  finally { starting = false; }
}
async function startOnce(options, existing) {
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
  saveSession();
  openAttempt(profile().active_session);
  chrome();
}

async function complete() {
  if (!ctx.engine) return;
  ctx.pendingFinish = true;
  keepDraft();
  const current = ctx.engine;
  try {
    await ctx.saveQueue.catch(() => {});
    await mutate(() =>
      trainer.finishAttempt(current.attempt.owner, current.attempt.id, current.snapshot()),
    );
    ctx.lastAttempt = { ...current.attempt, ...current.snapshot() };
    ctx.lastResult = profile().attempts.find((result) => result.id === current.attempt.id);
    clearDraft(current.attempt);
    saveSession();
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
$("#reconnect-household").onclick = async () => {
  try {
    if (ctx.engine) { saveError(new Error("Use the exercise recovery controls to keep or discard pending typing.")); return; }
    await coordinator.tail;
    ctx.state = await trainer.getState(); ctx.needsReconciliation = false;
    $("#reconnect-household").hidden = true;
    await render();
  } catch (error) { notify(error.message); }
};
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
    await coordinator.tail;
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
  if (ctx.engine && !ctx.needsReconciliation && (ctx.dirty || ctx.engine.running) && !ctx.engine.finished)
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
    keepDraft();
    event.returnValue = "";
  }
});
let refreshing = false;
onHouseholdChange(async () => {
  if (!ctx.state || refreshing || coordinator.count) return;
  refreshing = true;
  try {
    const saved = await trainer.getState();
    if (saved.revision === ctx.state.revision) return;
    const settingsPending = ctx.view === "settings" && (ctx.editingSettings || Object.keys(ctx.pendingSettings[ctx.profileId] || {}).length);
    if (ctx.dirty || ctx.pendingFinish || ctx.engine?.running || settingsPending) {
      ctx.engine?.pause(); keepDraft(); ctx.needsReconciliation = true;
      if (settingsPending) {
        notify("Another tab changed this household. Reconcile your pending settings with the saved household.");
        $("#settings-reconnect").hidden = false;
      } else saveError(new Error("Another tab changed this household. Reconcile pending typing or reload saved work."));
    } else {
      ctx.state = saved; ctx.needsReconciliation = false;
      if (ctx.engine) {
        const active = profile()?.active_session;
        ctx.engine = null;
        if (active) openAttempt(active); else { ctx.view = "home"; await render(); }
      } else await render();
    }
  } catch (error) { notify(error.message); }
  finally { refreshing = false; }
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () =>
  applyTheme(profile()),
);

try {
  await bindTrainer();
  [ctx.state, ctx.catalog] = await Promise.all([trainer.getState(), trainer.getCatalog()]);
  await restoreCourseSelection();
  if (profile()) { restoreSession(); await offerDraft(); }
  const initial = viewFromHash();
  if (initial === "lesson" && profile()?.active_session) ctx.view = "lesson";
  else ctx.view = MAIN_VIEWS.includes(initial) ? initial : "home";
  if (!location.hash) history.replaceState({ view: "home" }, "", "#home");
  await render();
} catch (error) {
  startupRecovery(error);
}
