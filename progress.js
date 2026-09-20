import { attemptTitle, esc, fingerSession, keyLabel, notify } from "./ui.js";
import { ctx, lesson, lessons, profile } from "./api.js";
import { trainer } from "./trainer.js";

let start = async () => {};
export function connect(handlers) {
  start = handlers.start;
}

function heatColor(skill) {
  if (!skill || skill.samples < 3) return "";
  const rate = skill.errors / skill.samples;
  if (rate >= 0.15) return "heat-high";
  if (rate >= 0.05) return "heat-mid";
  return "heat-low";
}

function fingerHeat(finger) {
  if (!finger.samples || finger.status === "gathering") return "";
  if (finger.weak) return "heat-high";
  if (finger.slow || finger.status === "developing") return "heat-mid";
  return "heat-low";
}

function homeLabel(home) {
  return home === " " ? "Space" : home === "\n" ? "Enter" : home.toUpperCase();
}

function shortFinger(id) {
  return id === "thumbs" ? "Thumbs" : id.split(" ").at(-1);
}

function handAccuracy(fingers, side) {
  const items = fingers.filter((finger) => finger.id.startsWith(side));
  const samples = items.reduce((sum, finger) => sum + finger.samples, 0);
  const errors = items.reduce((sum, finger) => sum + finger.errors, 0);
  return samples ? `${(100 * (1 - errors / samples)).toFixed(1)}%` : "—";
}

function statusLabel(finger) {
  if (finger.weak) return "Needs practice";
  if (finger.slow) return "Accurate, still slow";
  if (finger.status === "gathering") return "Gathering evidence";
  if (finger.status === "strong") return "Strong";
  return "Developing";
}

function fingerCard(finger) {
  const trainable = finger.taught_keys.length > 0;
  const accuracy =
    finger.accuracy == null ? "—" : `${finger.accuracy.toFixed(0)}%`;
  const weakest = finger.weakest ? keyLabel(finger.weakest).toUpperCase() : "—";
  return `<button type="button" class="finger-card ${fingerHeat(finger)}" data-finger="${esc(finger.id)}" ${trainable ? "" : "disabled"} title="${trainable ? "Start a lesson for this finger" : "Unlock this finger’s keys in the course first"}"><span class="finger-name">${esc(shortFinger(finger.id))}</span><span class="finger-home">${esc(homeLabel(finger.home))}</span><span class="metric">${esc(accuracy)}</span><span class="small">${finger.errors} errors · ${finger.samples} samples</span><span class="tag">${esc(statusLabel(finger))}</span>${finger.weakest ? `<span class="small">Watch ${esc(weakest)}</span>` : ""}</button>`;
}

function fingerDashboard(fingers) {
  const left = fingers.filter((finger) => finger.id.startsWith("left"));
  const right = fingers.filter((finger) => finger.id.startsWith("right"));
  const thumbs = fingers.filter((finger) => finger.id === "thumbs");
  const weak = fingers.filter((finger) => finger.weak);
  const callout = weak.length
    ? `<div class="banner">Your ${esc(weak.map((finger) => finger.label).join(" and "))} finger${weak.length > 1 ? "s are" : " is"} asking for extra care. Software infers this from assigned keys; it cannot see which finger you actually used. <button type="button" class="subtle" data-finger="${esc(weak[0].id)}">Train ${esc(weak[0].label)}</button></div>`
    : `<p class="small">Keep practicing. A finger is marked weak after at least 12 samples and a 5% error rate, or when it is clearly slower than your others.</p>`;
  return `<section class="card finger-dashboard"><h2>Finger strength</h2><p>Accuracy and speed by the US QWERTY finger map. Train a finger to get three short lessons: isolated keys, rhythm, then words you already know.</p><div class="grid three finger-summary"><div><h3>Left hand</h3><span class="metric">${handAccuracy(fingers, "left")}</span><p class="small">Little through index</p></div><div><h3>Right hand</h3><span class="metric">${handAccuracy(fingers, "right")}</span><p class="small">Index through little</p></div><div><h3>Thumbs</h3><span class="metric">${thumbs[0]?.accuracy == null ? "—" : thumbs[0].accuracy.toFixed(0) + "%"}</span><p class="small">Space bar</p></div></div>${callout}<div class="hands" aria-label="Finger accuracy"><div class="hand"><h3>Left hand</h3><div class="finger-row">${left.map(fingerCard).join("")}</div></div><div class="hand"><h3>Right hand</h3><div class="finger-row">${right.map(fingerCard).join("")}</div></div></div><div class="finger-row thumbs-row">${thumbs.map(fingerCard).join("")}</div><div class="table-wrap"><table><thead><tr><th>Finger</th><th>Home</th><th>Accuracy</th><th>Samples</th><th>Avg ms</th><th>Status</th></tr></thead><tbody>${fingers
    .map(
      (finger) =>
        `<tr><td>${esc(finger.label)}</td><td>${esc(homeLabel(finger.home))}</td><td>${finger.accuracy == null ? "—" : finger.accuracy.toFixed(1) + "%"}</td><td>${finger.samples}</td><td>${finger.latency_ms == null ? "—" : Math.round(finger.latency_ms)}</td><td>${esc(statusLabel(finger))}</td></tr>`,
    )
    .join("")}</tbody></table></div></section>`;
}

export async function progressView() {
  const p = profile(),
    recent = p.attempts.slice(-20),
    skills = Object.entries(p.skill_stats),
    secure = skills.filter(([, s]) => s.secure).length,
    assessments = p.assessment_history.filter((result) => result.duration),
    duration = assessments.at(-1)?.duration,
    same = assessments.filter((result) => result.duration === duration),
    bestAccuracy = Math.max(0, ...Object.values(p.lesson_progress).map((item) => item.best_accuracy)),
    bestWpm = Math.max(
      0,
      ...Object.values(p.lesson_progress).map((item) => item.best_wpm || 0),
    );
  ctx.recommendation = await trainer.recommendation(ctx.profileId);
  const fingers = ctx.recommendation.fingers || [];
  document.querySelector("#main").innerHTML =
    `<div class="eyebrow">See how far you’ve come</div><h1>Progress, at your pace.</h1><p>Accuracy, coverage, and speed grow together. Compare tests of the same duration.</p><div class="grid three"><section class="card"><h3>Course coverage</h3><span class="metric">${Object.values(p.lesson_progress).filter((x) => x.status === "completed").length}/${lessons().length}</span><p class="small">${Object.values(p.lesson_progress).filter((x) => x.status === "skipped").length} skipped separately</p></section><section class="card"><h3>Secure characters</h3><span class="metric">${secure}/95</span><p class="small">Two distinct exercises plus a later review</p></section><section class="card"><h3>Time well spent</h3><span class="metric">${(Object.values(p.daily_summary).reduce((sum, d) => sum + d.milliseconds, 0) / 60000).toFixed(0)} min</span><p class="small">No progress is lost for taking a break.</p></section></div>${fingerDashboard(fingers)}<div class="grid"><section class="card"><h3>Personal bests</h3><p>Accuracy ${bestAccuracy.toFixed(1)}% · ${bestWpm ? bestWpm.toFixed(1) + " WPM" : "speed still gathering"}</p><p class="small">${p.achievements.map(esc).join(" · ") || "Your first achievement is ahead."}</p></section><section class="card"><h3>Minutes today</h3><p>${((Object.values(p.daily_summary).at(-1)?.milliseconds || 0) / 60000).toFixed(1)} minutes on this local day.</p></section></div><section class="card"><h2>Keyboard heatmap</h2><div class="keyboard heatmap" aria-label="Error rates by key">${["`1234567890-=", "qwertyuiop[]\\", "asdfghjkl;'", "zxcvbnm,./"].map((row) => `<div class="key-row">${[...row].map((key) => `<span class="key ${heatColor(p.skill_stats[key])}">${esc(key)}</span>`).join("")}</div>`).join("")}</div></section><section class="card"><h2>Recent accuracy</h2><div class="sparkline" role="img" aria-label="Recent accuracy: ${recent.map((r) => r.score.accuracy.toFixed(0) + " percent").join(", ")}">${recent.map((r) => `<div class="bar" data-height="${r.score.accuracy}" title="${r.score.accuracy.toFixed(1)}%"></div>`).join("")}</div><h2>Recent WPM</h2><p class="small">Same-duration assessments only when comparing speed.</p><div class="sparkline" role="img" aria-label="Recent WPM">${same.map((r) => `<div class="bar" data-height="${Math.min(100, (r.score.wpm || 0) * 2)}" title="${r.score.wpm?.toFixed(1) || "—"}"></div>`).join("")}</div><div class="table-wrap"><table><thead><tr><th>Practice</th><th>Accuracy</th><th>WPM</th><th>Seconds</th></tr></thead><tbody>${recent
      .slice()
      .reverse()
      .map((r) => {
        const title = lesson(r.lesson_id)?.title || attemptTitle(r);
        return `<tr><td>${esc(title)}</td><td>${r.score.accuracy.toFixed(1)}%</td><td>${r.score.wpm?.toFixed(1) || "—"}</td><td>${(r.score.elapsed_ms / 1000).toFixed(0)}${r.paused ? " · paused" : ""}</td></tr>`;
      })
      .join(
        "",
      )}</tbody></table></div></section><details><summary>Your keyboard · evidence by key</summary><div class="table-wrap"><table><thead><tr><th>Key</th><th>Samples</th><th>Errors</th><th>Next review</th><th>Confidence</th></tr></thead><tbody>${skills.map(([key, s]) => `<tr><td>${key === " " ? "Space" : key === "\n" ? "Enter" : esc(key)}</td><td>${s.samples}</td><td>${s.errors}</td><td>${s.due.slice(0, 10)}</td><td>${s.secure ? "Secure" : s.samples < 5 ? "Gathering evidence" : "Developing"}</td></tr>`).join("")}</tbody></table></div></details><details><summary>Practice calendar & achievements</summary><p>${p.achievements.map(esc).join(" · ") || "Your first achievement is ahead."}</p>${Object.entries(
      p.daily_summary,
    )
      .slice(-30)
      .map(([day, d]) => `<p>${day} · ${(d.milliseconds / 60000).toFixed(1)} minutes</p>`)
      .join(
        "",
      )}</details><details><summary>Assessment history & individual milestones</summary><p>Your personal goal is ${p.settings.speed_goal} WPM over ${p.settings.assessment_seconds} seconds. The optional sustained-proficiency benchmark is 40 WPM with 97% accuracy on three different, unpaused 3-minute assessments across two days.</p>${p.assessment_history.map((r) => `<p>${r.date.slice(0, 10)} · ${r.duration}s · ${r.score.accuracy.toFixed(1)}% · ${r.score.wpm?.toFixed(1) || "—"} WPM ${r.paused ? "· paused" : ""} ${(r.score.wpm || 0) >= p.settings.speed_goal && r.score.accuracy >= 97 ? "· Personal milestone" : ""}</p>`).join("")}</details>`;
  document.querySelectorAll("[data-finger]").forEach((button) => {
    button.onclick = () => {
      ctx.sessionPlan = fingerSession(button.dataset.finger);
      ctx.sessionIndex = 0;
      return start(ctx.sessionPlan[0]).catch((error) => notify(error.message));
    };
  });
}
