import { action, applyTheme, esc, fingerSession, notify } from "./ui.js";
import { ctx, lesson, lessons, mutate, profile, todayMinutes, restoreSession, restoreCourseSelection } from "./api.js";
import { trainer, storageLocation } from "./trainer.js";
import { minutesToday, progressCounts } from "./dates.js";
import { offerDraft } from "./recovery.js";

let navigate = async () => {};
let start = async () => {};
export function connect(handlers) {
  navigate = handlers.navigate;
  start = handlers.start;
}

export async function picker(force = false) {
  const profiles = Object.values(ctx.state.profiles);
  if (!force && profiles.length === 1) {
    await handlersChoose(profiles[0].id);
    return;
  }
  ctx.view = "profiles";
  applyTheme();
  document.querySelector("#main").innerHTML =
    `<div class="eyebrow">Make yourself at home</div><h1>Who’s practicing today?</h1><p>Everyone gets their own path. Your progress stays on this computer.</p><div class="grid three">${Object.values(
      ctx.state.profiles,
    )
      .map((item) => {
        const next = lessons().find((row) => !item.courses["en-qwerty"]?.lesson_progress[row.id]);
        const minutes =
          Object.values(item.courses).reduce((total,c) => total + minutesToday({...c,settings:item.settings}),0);
        return `<button class="profile-card" data-profile="${item.id}"><span class="avatar">${esc(item.settings.avatar)}</span><h2>${esc(item.settings.name)}</h2><span class="small">${minutes.toFixed(1)} min today · next: ${esc(next?.group || "Practice")}</span></button>`;
      })
      .join(
        "",
      )}</div><section class="card"><h2>A new beginning</h2><form id="new-profile"><div class="grid"><label>Nickname<input name="name" required maxlength="32" placeholder="What should we call you?"></label><label>Reading band<select name="band"><option value="child">Ages 10+ · shorter reading</option><option value="adult">Adult · everyday reading</option></select></label></div><label>Choose a companion<select name="avatar">${["🌿", "🦊", "🐳", "🌙", "🌻", "🐢"].map((a) => `<option>${a}</option>`).join("")}</select></label><button class="primary">Create learner</button></form></section><p class="small">Choose the matching physical keyboard layout in each course. Family profiles share this device; there are no passwords or accounts.</p>`;
  document.querySelectorAll("[data-profile]").forEach(
    (button) =>
      (button.onclick = () =>
        handlersChoose(button.dataset.profile).catch((error) =>
          notify(error.message),
        )),
  );
  let creating = false;
  document.querySelector("#new-profile").onsubmit = async (event) => {
    event.preventDefault();
    if (creating) return;
    creating = true;
    const data = new FormData(event.target),
      before = new Set(Object.keys(ctx.state.profiles));
    try {
      await mutate(() =>
        trainer.createProfile({
          name: data.get("name"),
          band: data.get("band"),
          avatar: data.get("avatar"),
          daily_minutes: data.get("band") === "adult" ? 10 : 5,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          theme: "system",
        }),
      );
      await handlersChoose(Object.keys(ctx.state.profiles).find((id) => !before.has(id)));
    } catch (error) {
      notify(error.message);
    } finally { creating = false; }
  };
}

async function handlersChoose(id) {
  await ctx.saveQueue.catch(() => {});
  ctx.profileId = id;
  sessionStorage.setItem("learner", id);
  await restoreCourseSelection();
  restoreSession();
  await offerDraft();
  await navigate("home");
}

export async function home() {
  try { ctx.recommendation = await trainer.recommendation(ctx.profileId); }
  catch (error) {
    notify(error.message);
    ctx.recommendation = { next: lessons().find((row) => !profile().lesson_progress[row.id])?.id,
      keys: "fj", explanation: "Reconnect to the household server before starting or saving more practice.", weak_fingers: [] };
  }
  const p = profile(),
    next = lesson(ctx.recommendation.next),
    minutes = todayMinutes(),
    count = progressCounts(p).completed,
    done = minutes >= p.settings.daily_minutes && !ctx.sessionPlan[ctx.sessionIndex];
  if (p.settings.backup_reminder) {
    let last = null;
    try { last = localStorage.getItem(`hearth-export:${trainer.kind}:${ctx.profileId}`); } catch { /* optional */ }
    if (!last || Date.now() - Date.parse(last) > 7 * 86400000) notify("Keep a copy: export a dated backup from Settings. Your last export was over a week ago or has not been recorded.");
  }
  document.querySelector("#main").innerHTML =
    `<div class="eyebrow">A little practice. A little magic.</div><h1>Hey ${esc(p.settings.name)}!</h1><p>Settle in, stretch your fingers, and see what you can do.</p><section class="hero"><div class="hero-art" aria-hidden="true"><span>f</span><span>j</span><span>✦</span><span>a</span><span>s</span><span>d</span><span>k</span><span>l</span><span>;</span></div><div class="eyebrow">${p.active_session ? "Right where you left off" : next ? esc(next.stage + " · " + next.group) : "Your practice continues"}</div><h2>${p.active_session ? "Your practice is waiting." : ctx.sessionPlan[ctx.sessionIndex] ? "Your next daily step is ready." : done ? "That’s enough for today." : next ? esc(next.title) : "Find your own rhythm."}</h2><p>${p.active_session ? "Resume from your last saved checkpoint. Take your time." : ctx.sessionPlan[ctx.sessionIndex] ? `Step ${ctx.sessionIndex + 1} of ${ctx.sessionPlan.length}: ${ctx.sessionPlan[ctx.sessionIndex].kind}. Continue your saved daily session, or finish whenever you like.` : done ? "Missed days have no penalty. Come back when you like, or take one more comfortable round." : "A short warm-up, one new step, and a comfortable finish. Accuracy comes first."}</p>${
      p.active_session
        ? '<button id="continue" class="primary">Resume practice &nbsp; →</button>'
        : done
          ? '<button id="one-more" class="primary">One more &nbsp; →</button>'
          : '<button id="continue" class="primary">Continue &nbsp; →</button>'
    }<span class="small"> &nbsp; ${esc(ctx.course.title)} · no rush</span></section><div class="grid"><section class="card"><div class="row"><h2>A little, every day</h2><span class="tag">${p.settings.daily_minutes} min goal</span></div><span class="metric">${minutes.toFixed(1)} <span class="small">minutes today</span></span><progress value="${minutes}" max="${p.settings.daily_minutes}"></progress><p class="small">Missed a day? No problem. Your progress is always here.</p></section><section class="card"><h2>Growing confidence</h2><span class="metric">${count} <span class="small">of ${lessons().length} completed lessons</span></span><p class="small">${progressCounts(p).skipped} skipped separately</p><p>${p.achievements.length ? "✦ " + esc(p.achievements.at(-1)) : "Your first small step is worth taking."}</p><button id="open-course" class="subtle">Explore your course →</button></section></div><div class="banner">${esc(ctx.recommendation.explanation)} <button id="review">Practice these keys</button>${ctx.recommendation.weak_fingers?.[0] ? `<button id="train-finger">Train ${esc(ctx.recommendation.weak_fingers[0].label)}</button>` : ""}</div><details ${count ? "" : "open"}><summary>Before you begin · hands, posture, and keyboard check</summary><p>Sit comfortably with your feet supported and wrists relaxed. Rest your fingers on ${esc(ctx.course.fingers.slice(0,8).map(f => f.home.toUpperCase()).join(" "))}. Feel the physical home-key bumps. Either thumb can press Space. Return to this position after reaching for a key.</p><p>Look at the text instead of your hands. Use the other hand’s Shift for capitals. The app can measure typing, but it cannot check which fingers you use or whether you look down.</p><label>Check your keyboard: type ${esc(ctx.course.layout_check)}<input id="layout-check" autocomplete="off" spellcheck="false" placeholder="${esc(ctx.course.layout_check)}"></label><p id="layout-feedback" class="small">This is an unscored layout check.</p><div class="actions"><button id="beginning">Start from the beginning</button><button id="placement">Optional placement assessment</button></div></details>`;
  action("continue", async () => {
    if (p.active_session) return start(null, p.active_session);
    if (ctx.sessionPlan[ctx.sessionIndex]) return start(ctx.sessionPlan[ctx.sessionIndex]);
    if (done) return;
    await onboard();
    ctx.sessionPlan = count ? [
      { kind: "review" },
      next ? { kind: "lesson", lesson_id: next.id } : { kind: "assessment" },
      { kind: "familiar" },
    ] : [{ kind: "lesson", lesson_id: next?.id || lessons()[0].id }, { kind: "familiar" }];
    ctx.sessionIndex = 0;
    await start(ctx.sessionPlan[0]);
  });
  action("one-more", () => start({ kind: "review" }));
  action("open-course", () => navigate("course"));
  action("review", () => start({ kind: "review" }));
  action("train-finger", () => {
    const finger = ctx.recommendation.weak_fingers[0].id;
    ctx.sessionPlan = fingerSession(finger);
    ctx.sessionIndex = 0;
    return start(ctx.sessionPlan[0]);
  });
  async function onboard() {
    if (!profile().learning.onboarding_done)
      await mutate(() => trainer.updateLearning(ctx.profileId, { onboarding_done: true }));
  }
  action("beginning", async () => { await onboard(); return start({ kind: "lesson", lesson_id: lessons()[0].id }); });
  action("placement", async () => { await onboard(); return start({ kind: "placement" }); });
  const before = document.createElement("section");
  if (!p.learning.onboarding_done) {
    before.className = "card onboarding";
    before.innerHTML = `<h2>Your first session</h2><p>1. You chose ${esc(p.settings.name)}. 2. Check your keyboard below. 3. Choose new to touch typing or optional placement.</p><p>New learners begin with ${esc(ctx.course.initial_keys.trim())}, then familiar practice. Later daily sessions offer warm-up → new lesson → familiar practice. Pause at any time.</p><p>Saving means keeping your place here: ${esc(storageLocation())}. There is no account or cloud copy. Export a backup from Settings.</p><button id="first-beginner" class="primary">New to touch typing</button><button id="first-placement">Try optional placement</button>`;
    document.querySelector(".hero").before(before);
    const checkKeyboard = (next) => {
      if (document.querySelector("#layout-check").value === ctx.course.layout_check) document.querySelector(next).click();
      else { document.querySelector("#layout-check").focus(); notify("Try the unscored keyboard check first. If keys differ, select the course’s layout in your computer’s keyboard settings."); }
    };
    before.append(document.querySelector("#layout-check").closest("details"));
    action("first-beginner", () => checkKeyboard("#beginning"));
    action("first-placement", () => checkKeyboard("#placement"));
  }
  if (!p.learning.correction_done) {
    const demo = document.createElement("section"); demo.className = "card";
    demo.innerHTML = `<h2>Try a correction · unscored</h2><p>Target: ${esc(ctx.course.initial_keys[0])}. Type x, press Backspace, then type ${esc(ctx.course.initial_keys[0])}. In guided lessons, an error waits for Backspace. In fluent practice, you can continue, then Backspace to the error before finishing.</p><label>Correction demonstration<input id="correction-demo" autocomplete="off"></label><p id="demo-feedback" role="status">Type x to try an error.</p>`;
    document.querySelector(".hero").before(demo);
    let step = 0;
    document.querySelector("#correction-demo").onkeydown = async (event) => {
      if (event.key === "Tab") return;
      event.preventDefault();
      if (step === 0 && event.key === "x") { step = 1; event.target.value = "x"; document.querySelector("#demo-feedback").textContent = `Typed x; expected ${ctx.course.initial_keys[0]}. Press Backspace to remove x.`; }
      else if (step === 1 && event.key === "Backspace") { step = 2; event.target.value = ""; document.querySelector("#demo-feedback").textContent = `Error removed. Now type ${ctx.course.initial_keys[0]}.`; }
      else if (step === 2 && event.key === ctx.course.initial_keys[0]) {
        step = 3; event.target.value = ctx.course.initial_keys[0]; document.querySelector("#demo-feedback").textContent = "Correct! This demonstration earned no score.";
        try { await mutate(() => trainer.updateLearning(ctx.profileId, { correction_done: true })); } catch (e) { notify(e.message); }
      }
    };
  }
  document.querySelector("#layout-check").oninput = (event) => {
    document.querySelector("#layout-feedback").textContent =
      event.target.value === ctx.course.layout_check
        ? `That matches ${ctx.course.title}. You’re ready to begin.`
        : "Type the sample exactly, including spaces and Shift symbols.";
  };
}
