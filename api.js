import { notify, status } from "./ui.js";
import { trainer } from "./trainer.js";

export const ctx = {
  state: null,
  course: null,
  profileId: sessionStorage.getItem("learner"),
  view: "home",
  engine: null,
  recommendation: null,
  saveQueue: Promise.resolve(),
  dirty: false,
  pendingFinish: false,
  sessionPlan: [],
  sessionIndex: 0,
  lastResult: null,
  lastAttempt: null,
  forceHints: false,
  stretchBoundary: 0,
};

export const profile = () => ctx.state?.profiles[ctx.profileId];
export const lessons = () => ctx.course.lessons;
export const lesson = (id) => lessons().find((item) => item.id === id);

export function currentRevision() {
  return ctx.state.revision;
}

export async function mutate(run) {
  status("Saving…");
  try {
    ctx.state = await run();
    status("Saved on this computer");
    return ctx.state;
  } catch (error) {
    status("Save failed — retry or export pending work");
    throw error;
  }
}

export function todayMinutes() {
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: profile().settings.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return (profile().daily_summary[key]?.milliseconds || 0) / 60000;
}

export function saveError(error) {
  status("Save failed — pending work kept in this tab");
  notify(error.message);
  for (const id of ["retry-save", "export-pending", "reload-saved"])
    if (document.getElementById(id)) document.getElementById(id).hidden = false;
}

export function checkpoint() {
  if (!ctx.engine || ctx.engine.finished) return ctx.saveQueue;
  const current = ctx.engine,
    owner = current.attempt.owner,
    id = current.attempt.id,
    snapshot = current.snapshot();
  ctx.saveQueue = ctx.saveQueue
    .catch(() => {})
    .then(async () => {
      await mutate(() => trainer.checkpoint(owner, id, snapshot));
      if (
        ctx.engine === current &&
        ctx.engine.events.length === snapshot.events.length
      )
        ctx.dirty = false;
    });
  return ctx.saveQueue;
}

export function download(name, data) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
