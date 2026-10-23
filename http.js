import { currentRevision } from "./api.js";
import { Conflict, RecoveryRequired } from "./errors.js";
import { validateState } from "./validate.js";

export const REQUEST_TIMEOUT_MS = 8000;

export function apiUrl(path) {
  return new URL("api" + path, location.href).href;
}

async function request(path, method = "GET", body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
  const response = await fetch(apiUrl(path), {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : { Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: controller.signal,
  });
  let data;
  try { data = await response.json(); }
  catch { throw new Error("The server returned unreadable data. Your storage location has not changed. Retry the connection."); }
  if (!response.ok) {
    const message =
      typeof data.detail === "string" ? data.detail : "Please check the supplied values.";
    if (response.status === 409) throw new Conflict(message);
    if (data.recovery) throw new RecoveryRequired(message);
    const error = new Error(message);
    error.recovery = Boolean(data.recovery);
    error.conflict = response.status === 409;
    throw error;
  }
  const preview = ["/import", "/recover/import"].includes(path) && !body?.confirm;
  const expectsState = path === "/state" || path.startsWith("/export") || method !== "GET" && !preview;
  if (expectsState) {
    if (!data || data.schema_version !== 1 || !Number.isInteger(data.revision) || !data.profiles || typeof data.updated_at !== "string")
      throw new Error("The server returned an incomplete household. Keep your data intact and retry the connection.");
    data = validateState(data);
  }
  if (path === "/course" && (!Array.isArray(data.lessons) || !data.lessons.length))
    throw new Error("The server returned an incomplete course. Retry the connection.");
  return data;
  } catch (error) {
    if (error.name === "AbortError" || error instanceof TypeError)
      throw new Error("The household server did not respond. Pending work is kept; a write may already have saved. Reconnect and reconcile before retrying.");
    throw error;
  } finally { clearTimeout(timeout); }
}

function withRevision(body = {}) {
  return { revision: currentRevision(), ...body };
}

export function createHttpTrainer() {
  return {
    kind: "http",
    getState: () => request("/state"),
    getCourse: () => request("/course"),
    getStorageLocation: () => request("/storage"),
    createProfile: (settings) => request("/profiles", "POST", withRevision({ settings })),
    updateProfile: (id, settings) =>
      request(`/profiles/${id}`, "PUT", withRevision({ settings })),
    manageProfile: (id, action) =>
      request(`/profiles/${id}/manage/${action}`, "POST", withRevision()),
    recommendation: (id) => request(`/profiles/${id}/recommendation`),
    applyPlacement: (id) => request(`/profiles/${id}/placement/apply`, "POST", withRevision()),
    skipLesson: (id, lessonId) =>
      request(`/profiles/${id}/skip/${lessonId}`, "POST", withRevision()),
    selfCheck: (id, lessonId, note) =>
      request(`/profiles/${id}/self-check`, "POST", withRevision({ lesson_id: lessonId, note })),
    startAttempt: (id, options) =>
      request(`/profiles/${id}/attempts`, "POST", withRevision(options)),
    checkpoint: (id, attemptId, snapshot) =>
      request(`/profiles/${id}/attempts/${attemptId}`, "PUT", withRevision(snapshot)),
    finishAttempt: (id, attemptId, snapshot) =>
      request(`/profiles/${id}/attempts/${attemptId}/finish`, "POST", withRevision(snapshot)),
    abandonAttempt: (id, attemptId) =>
      request(`/profiles/${id}/attempts/${attemptId}/abandon`, "POST", withRevision()),
    exportState: async (profileId) => {
      const path = profileId ? `/export?profile_id=${encodeURIComponent(profileId)}` : "/export";
      return request(path);
    },
    importState: (body) => request("/import", "POST", withRevision(body)),
    recover: () => request("/recover", "POST", {}),
    recoverImport: (data, confirm = false) => request("/recover/import", "POST", { data, confirm }),
    restorePending: (pending) => request("/pending", "POST", withRevision({ pending })),
    updateLearning: (id, patch) => request(`/profiles/${id}/learning`, "PUT", withRevision({ patch })),
    archives: () => request("/archives"),
    archiveState: (id) => request(`/archives/${encodeURIComponent(id)}`),
  };
}
