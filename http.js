import { currentRevision } from "./api.js";
import { Conflict, RecoveryRequired } from "./errors.js";

export function apiUrl(path) {
  return new URL("api" + path, location.href).href;
}

async function request(path, method = "GET", body) {
  const response = await fetch(apiUrl(path), {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : { Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
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
  return data;
}

function withRevision(body = {}) {
  return { revision: currentRevision(), ...body };
}

export function createHttpTrainer() {
  return {
    kind: "http",
    getState: () => request("/state"),
    getCourse: () => request("/course"),
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
  };
}
