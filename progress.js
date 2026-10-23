import { attemptTitle, esc, fingerSession, keyLabel, notify } from "./ui.js";
import { ctx, lesson, lessons, profile } from "./api.js";
import { trainer } from "./trainer.js";
import { minutesToday, localDate, progressCounts } from "./dates.js";

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
  const p = profile(), counts = progressCounts(p);
  const skills = Object.entries(p.skill_stats), secure = skills.filter(([key, s]) => s.secure && (key === "\n" || key.length === 1 && key >= " " && key <= "~")).length;
  ctx.recommendation = await trainer.recommendation(ctx.profileId);
  const taught = ctx.recommendation.taught;
  const trainable = (keys) => [...keys].every((key) => taught.includes(key));
  const keyButton = (key, skill) => `<button data-review="${esc(key)}" ${trainable(key) && skill.samples >= 5 ? "" : "disabled"}>${esc(keyLabel(key))}</button>`;
  const weakPairs = Object.entries(p.pair_stats).filter(([pair, s]) => trainable(pair) && s.latency_samples >= 5)
    .sort((a, b) => b[1].latency_total / b[1].latency_samples - a[1].latency_total / a[1].latency_samples).slice(0, 5);
  const kinds = [...new Set(p.attempts.map((r) => r.kind))];
  const durations = [...new Set(p.assessment_history.map((r) => r.duration).filter(Boolean))].sort((a, b) => a-b);
  document.querySelector("#main").innerHTML = `<div class="eyebrow">See how far you’ve come</div><h1>Progress, at your pace.</h1>
    <div class="grid three"><section class="card"><h3>Completed lessons</h3><span class="metric">${counts.completed}/${lessons().length}</span><p>${counts.skipped} skipped · skipped lessons are not mastered</p></section>
    <section class="card"><h3>Secure characters</h3><span class="metric">${secure}/96</span><p>95 printable characters plus Enter. Two distinct exercises and a later successful review.</p></section>
    <section class="card"><h3>Minutes today</h3><span class="metric">${minutesToday(p).toFixed(1)}</span><p>${esc(localDate(p.settings.timezone))} · ${esc(p.settings.timezone)}</p></section></div>
    <section class="card"><h2>Your next useful practice</h2><p>${esc(ctx.recommendation.explanation)}</p><button id="next-review" class="primary">Start recommended review</button><p>${secure ? `${secure} keys are secure; review keeps them comfortable.` : "Not enough evidence for secure keys yet. Accuracy practice builds it."}</p>
    <h3>Slower pairs with evidence</h3><p>At least five timing samples. Timing suggests a useful review; it cannot measure your fingering.</p><div class="actions">${weakPairs.map(([pair, s]) => `<button data-review="${esc(pair)}">${esc([...pair].map(keyLabel).join(" → "))} · ${Math.round(s.latency_total / s.latency_samples)} ms (${s.latency_samples} samples)</button>`).join("") || "Not enough evidence yet."}</div></section>
    ${fingerDashboard(ctx.recommendation.fingers || [])}
    <section class="card"><h2>Keyboard heatmap</h2><p>Select a key with at least five samples to practice it. Error counts are readable without color.</p><div class="keyboard heatmap" aria-label="Error rates by key">${["`1234567890-=", "qwertyuiop[]\\", "asdfghjkl;'", "zxcvbnm,./", " \n"].map((row) => `<div class="key-row">${[...row].map((key) => {
      const s = p.skill_stats[key];
      return `<button class="key ${heatColor(s)}" data-review="${esc(key)}" ${s?.samples >= 5 && trainable(key) ? "" : "disabled"} aria-label="${esc(keyLabel(key))}: ${s ? `${s.errors} errors in ${s.samples} samples; ${s.secure ? "secure" : "developing"}` : "not enough evidence yet"}">${esc(keyLabel(key))}</button>`;
    }).join("")}</div>`).join("")}</div></section>
    <section class="card"><h2>Dated practice trends</h2><div class="grid"><label>Practice type<select id="trend-kind">${(kinds.length ? kinds : ["lesson"]).map((kind) => `<option>${esc(kind)}</option>`).join("")}</select></label>
    <label>Test duration<select id="trend-duration">${(durations.length ? durations : [p.settings.assessment_seconds]).map((d) => `<option value="${d}">${d} seconds</option>`).join("")}</select></label></div>
    <p id="trend-summary"></p><h3>Accuracy</h3><div id="accuracy-trend" class="sparkline"></div><h3>Speed</h3><p id="speed-context" class="small"></p><div id="speed-trend" class="sparkline"></div><div id="trend-table" class="table-wrap"></div></section>
    <details><summary>Your keyboard · evidence by key</summary><div class="table-wrap"><table><caption>Key evidence and targeted reviews</caption><thead><tr><th>Key</th><th>Samples</th><th>Errors</th><th>Next review</th><th>Confidence</th></tr></thead><tbody>${skills.map(([key, s]) => `<tr><td>${keyButton(key, s)}</td><td>${s.samples}</td><td>${s.errors}</td><td>${esc(localDate(p.settings.timezone, new Date(s.due)))}</td><td>${s.secure ? "Secure" : s.samples < 5 ? "Not enough evidence yet" : "Developing"}</td></tr>`).join("")}</tbody></table></div></details>
    <details><summary>Practice calendar & achievements</summary><p>${p.achievements.map(esc).join(" · ") || "Your first achievement is ahead."}</p>${Object.entries(p.daily_summary).sort(([a], [b]) => a.localeCompare(b)).slice(-30).map(([day, d]) => `<p>${esc(day)} · ${(d.milliseconds / 60000).toFixed(1)} minutes</p>`).join("")}</details>`;
  function drawTrends() {
    const kind = document.querySelector("#trend-kind").value, duration = Number(document.querySelector("#trend-duration").value);
    const isTest = ["assessment", "challenge"].includes(kind);
    document.querySelector("#trend-duration").disabled = !isTest;
    const rows = p.attempts.filter((r) => r.kind === kind && (!isTest || r.duration === duration)).slice(-20);
    const speedRows = rows.filter((r) => !r.paused && r.score.wpm !== null);
    const scale = Math.max(1, ...speedRows.map((r) => r.score.wpm));
    const compatible = rows.length ? rows.filter((r) => r.lesson_id === rows.at(-1).lesson_id && (r.lesson_id || r.text_digest === rows.at(-1).text_digest)) : [];
    const halfway = Math.floor(compatible.length / 2);
    const mean = (values) => values.reduce((n, r) => n + r.score.accuracy, 0) / values.length;
    document.querySelector("#trend-summary").textContent = compatible.length >= 4
      ? `Recent accuracy changed by ${(mean(compatible.slice(halfway)) - mean(compatible.slice(0, halfway))).toFixed(1)} percentage points across ${compatible.length} equivalent exercises.`
      : "Not enough equivalent exercises to measure recent accuracy change yet.";
    document.querySelector("#accuracy-trend").innerHTML = rows.map((r) => `<div class="bar" data-height="${r.score.accuracy}" title="${esc(localDate(p.settings.timezone, new Date(r.date)))} · ${r.score.accuracy.toFixed(1)}%"></div>`).join("");
    document.querySelector("#speed-context").textContent = `Scale: 0–${scale.toFixed(1)} WPM. ${isTest ? `${duration}-second ${kind}s only.` : "Practice speeds depend on exercise text."} Paused tests are practice; missing speed is shown as unavailable in the table.`;
    document.querySelector("#speed-trend").innerHTML = speedRows.map((r) => `<div class="bar" data-height="${r.score.wpm / scale * 100}" title="${esc(localDate(p.settings.timezone, new Date(r.date)))} · ${r.score.wpm.toFixed(1)} WPM"></div>`).join("");
    document.querySelectorAll("[data-height]").forEach((bar) => bar.style.height = bar.dataset.height + "%");
    document.querySelector("#trend-table").innerHTML = `<table><caption>Selected practice · accessible trend values</caption><thead><tr><th>Date</th><th>Exercise / type</th><th>Accuracy</th><th>WPM</th><th>Seconds</th></tr></thead><tbody>${rows.slice().reverse().map((r) => `<tr><td>${esc(localDate(p.settings.timezone, new Date(r.date)))}</td><td>${esc(lesson(r.lesson_id)?.title || attemptTitle(r))} · ${esc(r.kind)}${r.paused ? " · paused" : ""}</td><td>${r.score.accuracy.toFixed(1)}%</td><td>${r.score.wpm === null ? "Unavailable" : r.score.wpm.toFixed(1)}</td><td>${(r.score.elapsed_ms / 1000).toFixed(0)}</td></tr>`).join("")}</tbody></table>`;
  }
  document.querySelector("#trend-kind").onchange = drawTrends;
  document.querySelector("#trend-duration").onchange = drawTrends;
  drawTrends();
  document.querySelector("#next-review").onclick = () => start({ kind: "review" }).catch((e) => notify(e.message));
  document.querySelectorAll("[data-review]").forEach((button) => button.onclick = () => start({ kind: "review", keys: button.dataset.review }).catch((e) => notify(e.message)));
  document.querySelectorAll("[data-finger]").forEach((button) => button.onclick = () => {
    ctx.sessionPlan = fingerSession(button.dataset.finger); ctx.sessionIndex = 0;
    return start(ctx.sessionPlan[0]).catch((error) => notify(error.message));
  });
}
