import { action, applyTheme, esc, fingerSession, notify } from "./ui.js";
import { ctx, lesson, lessons, mutate, profile, todayMinutes } from "./api.js";
import { trainer } from "./trainer.js";

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
        const next = lessons().find((row) => !item.lesson_progress[row.id]);
        const minutes =
          (Object.values(item.daily_summary).at(-1)?.milliseconds || 0) / 60000;
        return `<button class="profile-card" data-profile="${item.id}"><span class="avatar">${esc(item.settings.avatar)}</span><h2>${esc(item.settings.name)}</h2><span class="small">${minutes.toFixed(1)} min today · next: ${esc(next?.group || "Practice")}</span></button>`;
      })
      .join(
        "",
      )}</div><section class="card"><h2>A new beginning</h2><form id="new-profile"><div class="grid"><label>Nickname<input name="name" required maxlength="32" placeholder="What should we call you?"></label><label>Reading band<select name="band"><option value="child">Ages 10+ · shorter reading</option><option value="adult">Adult · everyday reading</option></select></label></div><label>Choose a companion<select name="avatar">${["🌿", "🦊", "🐳", "🌙", "🌻", "🐢"].map((a) => `<option>${a}</option>`).join("")}</select></label><button class="primary">Create learner</button></form></section><p class="small">Designed for a physical US QWERTY keyboard. Family profiles share this device; there are no passwords or accounts.</p>`;
  document.querySelectorAll("[data-profile]").forEach(
    (button) =>
      (button.onclick = () =>
        handlersChoose(button.dataset.profile).catch((error) =>
          notify(error.message),
        )),
  );
  document.querySelector("#new-profile").onsubmit = async (event) => {
    event.preventDefault();
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
    }
  };
}

async function handlersChoose(id) {
  ctx.profileId = id;
  sessionStorage.setItem("learner", id);
  await navigate("home");
}

export async function home() {
  ctx.recommendation = await trainer.recommendation(ctx.profileId);
  const p = profile(),
    next = lesson(ctx.recommendation.next),
    minutes = todayMinutes(),
    count = Object.keys(p.lesson_progress).length,
    done = minutes >= p.settings.daily_minutes;
  document.querySelector("#main").innerHTML =
    `<div class="eyebrow">A little practice. A little magic.</div><h1>Hey ${esc(p.settings.name)}!</h1><p>Settle in, stretch your fingers, and see what you can do.</p><section class="hero"><div class="hero-art" aria-hidden="true"><span>f</span><span>j</span><span>✦</span><span>a</span><span>s</span><span>d</span><span>k</span><span>l</span><span>;</span></div><div class="eyebrow">${p.active_session ? "Right where you left off" : next ? esc(next.stage + " · " + next.group) : "Your practice continues"}</div><h2>${p.active_session ? "Your practice is waiting." : done ? "That’s enough for today." : next ? esc(next.title) : "Find your own rhythm."}</h2><p>${p.active_session ? "Resume from your last saved checkpoint. Take your time." : done ? "Missed days have no penalty. Come back when you like, or take one more comfortable round." : "A short warm-up, one new step, and a comfortable finish. Accuracy comes first."}</p>${
      p.active_session
        ? '<button id="continue" class="primary">Resume practice &nbsp; →</button>'
        : done
          ? '<button id="one-more" class="primary">One more &nbsp; →</button>'
          : '<button id="continue" class="primary">Continue &nbsp; →</button>'
    }<span class="small"> &nbsp; US QWERTY · no rush</span></section><div class="grid"><section class="card"><div class="row"><h2>A little, every day</h2><span class="tag">${p.settings.daily_minutes} min goal</span></div><span class="metric">${minutes.toFixed(1)} <span class="small">minutes today</span></span><progress value="${minutes}" max="${p.settings.daily_minutes}"></progress><p class="small">Missed a day? No problem. Your progress is always here.</p></section><section class="card"><h2>Growing confidence</h2><span class="metric">${count} <span class="small">of ${lessons().length} lessons</span></span><p>${p.achievements.length ? "✦ " + esc(p.achievements.at(-1)) : "Your first small step is worth taking."}</p><button id="open-course" class="subtle">Explore your course →</button></section></div><div class="banner">${esc(ctx.recommendation.explanation)} <button id="review">Practice these keys</button>${ctx.recommendation.weak_fingers?.[0] ? `<button id="train-finger">Train ${esc(ctx.recommendation.weak_fingers[0].label)}</button>` : ""}</div><details ${count ? "" : "open"}><summary>Before you begin · hands, posture, and keyboard check</summary><p>Sit comfortably with your feet supported and wrists relaxed. Rest your left fingers on A S D F and your right fingers on J K L ;. Feel the small bumps on F and J. Either thumb can press Space. Return to this position after reaching for a key.</p><p>Look at the text instead of your hands. Use the other hand’s Shift for capitals. The app can measure typing, but it cannot check which fingers you use or whether you look down.</p><label>Check your US keyboard: type fj ; / ?<input id="layout-check" autocomplete="off" spellcheck="false" placeholder="fj ; / ?"></label><p id="layout-feedback" class="small">This is an unscored layout check.</p><div class="actions"><button id="beginning">Start from the beginning</button><button id="placement">Optional placement assessment</button></div></details>`;
  action("continue", async () => {
    if (p.active_session) return start(null, p.active_session);
    if (done) return;
    ctx.sessionPlan = [
      { kind: "review" },
      next ? { kind: "lesson", lesson_id: next.id } : { kind: "assessment" },
      { kind: "familiar" },
    ];
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
  action("beginning", () => start({ kind: "lesson", lesson_id: lessons()[0].id }));
  action("placement", () => start({ kind: "placement" }));
  document.querySelector("#layout-check").oninput = (event) => {
    document.querySelector("#layout-feedback").textContent =
      event.target.value === "fj ; / ?"
        ? "That matches US QWERTY. You’re ready to begin."
        : "Type the sample exactly, including spaces. Use Shift for ?.";
  };
}
