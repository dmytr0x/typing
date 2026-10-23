import { notify, status } from "./ui.js";
import { trainer } from "./trainer.js";
import { Coordinator } from "./coordinator.js";
import { minutesToday } from "./dates.js";

export const coordinator = new Coordinator();
const changes = typeof BroadcastChannel === "function" ? new BroadcastChannel("hearth-changes") : null;
export function onHouseholdChange(handler) {
  if (changes) changes.onmessage = handler;
  window.addEventListener("focus", handler);
}

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
  needsReconciliation: false,
  recovering: false,
  pendingSettings: {},
  editingSettings: false,
};

export const profile = () => ctx.state?.profiles[ctx.profileId];
export const lessons = () => ctx.course.lessons;
export const lesson = (id) => lessons().find((item) => item.id === id);

export function currentRevision() {
  return ctx.state.revision;
}

export function mutate(run, key = null) {
  const result = coordinator.run(async () => {
  if (ctx.needsReconciliation) throw new Error("Reload or reconcile saved work before making another change.");
  status("Saving…");
  try {
    ctx.state = await run();
    changes?.postMessage({ revision: ctx.state.revision });
    status("Saved on this computer");
    return ctx.state;
  } catch (error) {
    ctx.needsReconciliation = true;
    status("Save failed — retry or export pending work");
    document.getElementById("reconnect-household").hidden = false;
    throw error;
  }
  }, key);
  ctx.saveQueue = coordinator.tail;
  return result;
}

export function todayMinutes() {
  return minutesToday(profile());
}

export function saveError(error) {
  ctx.engine?.pause(); keepDraft();
  status("Save failed — pending work kept in this tab");
  notify(error.message);
  document.getElementById("reconnect-household").hidden = true;
  for (const id of ["retry-save", "export-pending", "reload-saved", "discard-pending"])
    if (document.getElementById(id)) document.getElementById(id).hidden = false;
}

export function checkpoint() {
  if (!ctx.engine || ctx.engine.finished) return ctx.saveQueue;
  const current = ctx.engine, owner = current.attempt.owner, id = current.attempt.id;
  keepDraft();
  return mutate(async () => {
      const snapshot = current.snapshot();
      const state = await trainer.checkpoint(owner, id, snapshot);
      if (
        ctx.engine === current &&
        ctx.engine.events.length === snapshot.events.length
      )
        { ctx.dirty = false; clearDraft(current.attempt); }
      return state;
    }, `checkpoint:${id}`);
}

const draftSources = new WeakMap();
function draftPrefix(owner) { return `hearth-draft:${trainer.kind}:${owner}:`; }
function draftKey(owner) {
  let tabId = sessionStorage.getItem("hearth-tab");
  if (!tabId) { tabId = crypto.randomUUID(); sessionStorage.setItem("hearth-tab", tabId); }
  return draftPrefix(owner) + tabId;
}
export function pendingAttempt() {
  return { format: "hearth-pending-v1", attempt: ctx.engine.attempt,
    checkpoint: ctx.engine.snapshot(), finish: ctx.pendingFinish || ctx.engine.finished };
}
export function keepDraft() {
  if (!ctx.engine) return;
  try { localStorage.setItem(draftKey(ctx.engine.attempt.owner), JSON.stringify(pendingAttempt())); }
  catch { status("Local draft unavailable — export pending work if saving fails"); }
}
export function readDraft(owner) {
  try {
    const own = draftKey(owner);
    const legacy = `hearth-draft:${trainer.kind}:${owner}`;
    const key = localStorage.getItem(own) ? own : Object.keys(localStorage).find((key) => key.startsWith(draftPrefix(owner))) || legacy;
    const pending = JSON.parse(localStorage.getItem(key) || "null");
    if (pending?.attempt) draftSources.set(pending.attempt, key);
    return pending;
  }
  catch { return null; }
}
export function clearDraft(attempt) {
  try {
    const key = draftSources.get(attempt) || draftKey(attempt.owner);
    const draft = JSON.parse(localStorage.getItem(key) || "null");
    if (draft?.attempt.id === attempt.id) localStorage.removeItem(key);
  } catch { /* storage may be unavailable; in-memory pending work remains */ }
}
export async function reconcilePending() {
  ctx.recovering = true;
  ctx.engine.pause(); keepDraft();
  try {
  await coordinator.tail;
  const pending = pendingAttempt();
  ctx.state = await trainer.getState();
  ctx.needsReconciliation = false;
  await mutate(() => trainer.restorePending(pending));
  clearDraft(pending.attempt);
  ctx.dirty = false;
  } finally { ctx.recovering = false; }
}
export function saveSession() {
  try { localStorage.setItem(`hearth-session:${trainer.kind}:${ctx.profileId}`,
    JSON.stringify({ plan: ctx.sessionPlan, index: ctx.sessionIndex,
      attemptId: profile()?.active_session?.id || ctx.lastResult?.id })); }
  catch { /* session presentation is optional; attempt saving is separate */ }
}
export function restoreSession() {
  ctx.sessionPlan = []; ctx.sessionIndex = 0;
  try {
    const saved = JSON.parse(localStorage.getItem(`hearth-session:${trainer.kind}:${ctx.profileId}`) || "null");
    const valid = saved && Number.isInteger(saved.index) && saved.index >= 0 && Array.isArray(saved.plan) && saved.plan.length <= 10 && saved.plan.every((item) => item && typeof item === "object" && ["review", "lesson", "familiar", "assessment", "finger"].includes(item.kind));
    if (!valid || saved.index >= saved.plan.length) return;
    if (saved.attemptId === profile()?.active_session?.id) {
      ctx.sessionPlan = saved.plan; ctx.sessionIndex = saved.index;
    } else if (!profile()?.active_session && profile()?.attempts.at(-1)?.id === saved.attemptId && saved.index + 1 < saved.plan.length) {
      // A refresh on the result screen resumes the following step, not a new warm-up.
      ctx.sessionPlan = saved.plan; ctx.sessionIndex = saved.index + 1;
    }
  } catch { /* invalid presentation data is ignored */ }
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
