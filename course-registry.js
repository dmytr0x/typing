import en1 from "./courses/en-qwerty-v1.json" with {type:"json"};
import en2 from "./courses/en-qwerty-v2.json" with {type:"json"};
import uk1 from "./courses/uk-ua-v1.json" with {type:"json"};
import { createCourseRuntime } from "./course-runtime.js";
const definitions = new Map([en1,en2,uk1].map(data => [`${data.id}:${data.version}`, createCourseRuntime(data)]));
export function getCourse(courseId = "en-qwerty", version) {
  if (version == null) version = Math.max(...[...definitions.values()].filter(r => r.data.id === courseId).map(r => r.data.version));
  const runtime = definitions.get(`${courseId}:${version}`);
  if (!runtime) throw new Error("Course version unavailable; keep data and export a backup");
  return runtime;
}
export function listCourses() { return [getCourse("en-qwerty"), getCourse("uk-ua")].map(r => r.data); }
export function allCourses() { return [...definitions.values()]; }
