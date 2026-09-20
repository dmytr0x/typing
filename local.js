import { currentRevision } from "./api.js";
import {
  abandonAttempt,
  applyPlacement,
  checkpointAttempt,
  createProfile,
  exportState,
  finishAttempt,
  importInto,
  importPreview,
  manageProfile,
  recommendationPayload,
  selfCheck,
  skipLesson,
  startAttempt,
  updateProfile,
  learner,
} from "./ops.js";
import { parseImport } from "./validate.js";

export function createLocalTrainer(store, course) {
  const read = () => Promise.resolve(store.read());
  const change = (operation, archive = false) =>
    Promise.resolve(store.change(currentRevision(), operation, archive));

  return {
    kind: "local",
    getState: () => read(),
    getCourse: () => Promise.resolve(course),
    createProfile: (settings) => change((state) => createProfile(state, settings)),
    updateProfile: (id, settings) => change((state) => updateProfile(state, id, settings)),
    manageProfile: (id, action) => change((state) => manageProfile(state, id, action), true),
    recommendation: async (id) => recommendationPayload(learner(await read(), id)),
    applyPlacement: (id) => change((state) => applyPlacement(state, id)),
    skipLesson: (id, lessonId) => change((state) => skipLesson(state, id, lessonId)),
    selfCheck: (id, lessonId, note) =>
      change((state) => selfCheck(state, id, lessonId, note)),
    startAttempt: (id, options) => change((state) => startAttempt(state, id, options)),
    checkpoint: (id, attemptId, snapshot) =>
      change((state) => checkpointAttempt(state, id, attemptId, snapshot)),
    finishAttempt: (id, attemptId, snapshot) =>
      change((state) => finishAttempt(state, id, attemptId, snapshot)),
    abandonAttempt: (id, attemptId) =>
      change((state) => abandonAttempt(state, id, attemptId)),
    exportState: async (profileId) => exportState(await read(), profileId),
    importState: async (body) => {
      const incoming = parseImport(body.data);
      if (!body.confirm) return importPreview(incoming, body.mode, body.target);
      return change((state) => importInto(state, incoming, body.mode, body.target), true);
    },
    recover: () => Promise.resolve(store.recover()),
  };
}
