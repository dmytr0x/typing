import { currentRevision } from "./api.js";
import * as ops from "./ops.js";
import { getCourse, listCourses } from "./course-registry.js";
import { courseView, parseImport, emptyCourse } from "./validate.js";

export function createLocalTrainer(store, _course, courseId = "en-qwerty", ukrainianEnabled = true) {
  const read = () => Promise.resolve(store.read());
  const change = (operation, archive = false) => Promise.resolve(store.change(currentRevision(), operation, archive));
  const scoped = (state, id) => ops.operationsFor(state, id, courseId);
  return {
    kind: "local", courseId,
    forCourse: (id) => createLocalTrainer(store, null, id, ukrainianEnabled),
    getState: read,
    getCourse: (id = courseId, version) => Promise.resolve(getCourse(id, version).data),
    getCatalog: () => Promise.resolve(listCourses().filter(c => c.id !== "uk-ua" || ukrainianEnabled).map(c=>({id:c.id,title:c.title,language:c.language,layout_id:c.layout_id,curriculum_version:c.version,content_digest:c.content_digest,asset:`courses/${c.id}-v${c.version}.json`}))),
    enrollCourse: (id, course = courseId) => change(state => {
      if (course === "uk-ua" && !ukrainianEnabled) throw new Error("New Ukrainian enrollment is disabled in this compatibility release");
      const profile = state.profiles[id];
      if (!profile) throw new Error("Learner not found");
      if (profile.courses[course]) return;
      profile.courses[course] = emptyCourse(getCourse(course).data.version);
    }),
    resetCourse: (id) => change(state => {
      const profile = scoped(state,id).learner(state,id), original = profile.courses[courseId];
      profile.courses[courseId] = { ...emptyCourse(original.curriculum_version), learning: original.learning };
    }, true),
    createProfile: (settings) => change(state => ops.createProfile(state, settings)),
    updateProfile: (id, settings) => change(state => ops.updateProfile(state,id,settings)),
    manageProfile: (id, action) => change(state => ops.manageProfile(state,id,action),true),
    recommendation: async id => { const state = await read(); return scoped(state,id).recommendationPayload(courseView(state.profiles[id],courseId)); },
    applyPlacement: id => change(state => scoped(state,id).applyPlacement(state,id)),
    skipLesson: (id, lessonId) => change(state => scoped(state,id).skipLesson(state,id,lessonId)),
    selfCheck: (id, lessonId,note) => change(state => scoped(state,id).selfCheck(state,id,lessonId,note)),
    startAttempt: (id,options) => change(state => scoped(state,id).startAttempt(state,id,options)),
    checkpoint: (id,attemptId,snapshot) => change(state => scoped(state,id).checkpointAttempt(state,id,attemptId,snapshot)),
    finishAttempt: (id,attemptId,snapshot) => change(state => scoped(state,id).finishAttempt(state,id,attemptId,snapshot)),
    abandonAttempt: (id,attemptId) => change(state => scoped(state,id).abandonAttempt(state,id,attemptId)),
    exportState: async id => ops.exportState(await read(),id),
    importState: async body => {
      const incoming = parseImport(body.data);
      if (!body.confirm) return ops.importPreview(incoming,body.mode,body.target);
      await store.retainImport(body.data);
      return change(state => ops.importInto(state,incoming,body.mode,body.target),true);
    },
    recover: () => Promise.resolve(store.recover()),
    recoverImport: async (data,confirm=false) => {
      const state = parseImport(data);
      if (!confirm) return ops.importPreview(state,"household",null);
      if (!store.problem) throw new Error("Use Settings to import into a healthy household");
      await store.retainImport(data);
      return store.recoverImport(state);
    },
    restorePending: pending => change(state => ops.restorePending(state,pending)),
    updateLearning: (id,patch) => change(state => scoped(state,id).updateLearning(state,id,patch)),
    archives: () => store.archives(), archiveState: id => store.archiveState(id),
    migrationPreparation: () => store.migrationPreparation(),
    originalHousehold: () => store.originalHousehold(),
    migrationSnapshots: () => store.migrationSnapshots(), migrationSnapshot: id => store.migrationSnapshot(id),
  };
}
