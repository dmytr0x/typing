import { $, action, applyTheme, dialog, esc, notify, timezoneSelect } from "./ui.js";
import { ctx, download, mutate, profile } from "./api.js";
import { trainer } from "./trainer.js";

let navigate = async () => {};
let picker = () => {};
export function connect(handlers) {
  navigate = handlers.navigate;
  picker = handlers.picker;
}

export function settingsView() {
  const s = profile().settings;
  const local = trainer.kind === "local";
  const archiveHint = local
    ? "Imports are previewed before changes; a browser backup is kept, and you can download JSON."
    : "Imports are previewed before changes; a local archive is kept before replacement, reset, or removal.";
  const resetHint = local
    ? "A recoverable browser backup will be kept."
    : "A recoverable archive will be saved beside the state file.";
  document.querySelector("#main").innerHTML =
    `<div class="eyebrow">A comfortable fit</div><h1>Your space, your pace.</h1><section class="card"><form id="settings-form"><div class="grid"><label>Nickname<input name="name" value="${esc(s.name)}" required maxlength="32"></label><label>Companion<select name="avatar">${["🌿", "🦊", "🐳", "🌙", "🌻", "🐢"].map((a) => `<option ${a === s.avatar ? "selected" : ""}>${a}</option>`).join("")}</select></label><label>Reading band<select name="band"><option value="child" ${s.band === "child" ? "selected" : ""}>Ages 10+</option><option value="adult" ${s.band === "adult" ? "selected" : ""}>Adult</option></select></label><label>Daily minutes<input name="daily_minutes" type="number" min="1" max="60" value="${s.daily_minutes}"></label><label>Personal speed goal<input name="speed_goal" type="number" min="10" max="120" value="${s.speed_goal}"></label><label>Assessment seconds<input name="assessment_seconds" type="number" min="30" max="300" value="${s.assessment_seconds}"></label><label>Text size<input name="font_size" type="number" min="18" max="40" value="${s.font_size}"></label><label>Theme<select name="theme"><option value="system" ${s.theme === "system" ? "selected" : ""}>Match the computer</option><option value="light" ${s.theme === "light" ? "selected" : ""}>Warm light</option><option value="dark" ${s.theme === "dark" ? "selected" : ""}>Quiet dark</option></select></label><label>Timezone<select name="timezone">${timezoneSelect(s.timezone)}</select></label><label>Typeface<select name="font"><option value="default" ${s.font === "default" ? "selected" : ""}>Rounded default</option><option value="readable" ${s.font === "readable" ? "selected" : ""}>Wider, dyslexia-friendly system fonts</option></select></label></div>${[
      ["hints", "Show finger hints"],
      ["sound", "Typing sounds"],
      ["reduced_motion", "Reduce motion"],
      ["short_exercises", "Shorter exercises"],
    ]
      .map(
        ([key, label]) =>
          `<label><input name="${key}" type="checkbox" ${s[key] ? "checked" : ""}>${label}</label>`,
      )
      .join(
        "",
      )}<p class="small">Keyboard: US QWERTY · English. Settings save when changed.</p><span id="settings-saved" role="status"></span></form></section><section class="card"><h2>Keep a copy</h2><p>Export JSON backups to keep somewhere safe. ${archiveHint}</p><div class="actions"><button type="button" class="button" id="export-learner">Export this learner</button><button type="button" class="button" id="export-household">Export household</button></div><label>Import a backup<input id="import-file" type="file" accept=".json,application/json"></label><label>Import mode<select id="import-mode"><option value="new">Add as a new learner</option><option value="replace">Replace current learner</option><option value="household">Replace entire household</option></select></label><button id="preview-import">Preview import</button><div id="import-preview"></div></section><div class="actions"><button id="reset" class="danger">Reset this learner’s progress</button><button id="remove" class="danger">Remove this learner</button></div>`;
  $("#settings-form").onchange = async () => {
    const form = $("#settings-form"),
      data = new FormData(form),
      settings = { ...s };
    for (const [key, value] of data.entries())
      settings[key] = [
        "daily_minutes",
        "speed_goal",
        "assessment_seconds",
        "font_size",
      ].includes(key)
        ? Number(value)
        : value;
    for (const key of ["hints", "sound", "reduced_motion", "short_exercises"])
      settings[key] = data.has(key);
    if (!form.reportValidity()) return;
    try {
      await mutate(() => trainer.updateProfile(ctx.profileId, settings));
      $("#settings-saved").textContent = "Settings saved";
      applyTheme(profile());
    } catch (error) {
      notify(error.message);
    }
  };
  action("export-learner", async () => {
    download("hearth-backup.json", await trainer.exportState(ctx.profileId));
  });
  action("export-household", async () => {
    download("hearth-backup.json", await trainer.exportState());
  });
  action("preview-import", previewImport);
  $("#import-file").addEventListener("change", () => {
    if ($("#import-file").files[0]) previewImport().catch((error) => notify(error.message));
  });
  $("#import-mode").addEventListener("change", () => {
    if ($("#import-file").files[0]) previewImport().catch((error) => notify(error.message));
  });
  async function previewImport() {
    const file = $("#import-file").files[0];
    if (!file) throw new Error("Choose a JSON backup first.");
    if (file.size > 10000000) throw new Error("Choose a backup smaller than 10 MB.");
    const body = {
      data: await file.text(),
      mode: $("#import-mode").value,
      target: ctx.profileId,
    };
    const preview = await trainer.importState(body);
    $("#import-preview").innerHTML =
      `<div class="banner"><p>Learners: ${preview.profiles.map(esc).join(", ")}<br>Replaces: ${esc(preview.replaces)}</p><button id="confirm-import" class="primary">Confirm import</button></div>`;
    action("confirm-import", async () => {
      await mutate(() => trainer.importState({ ...body, confirm: true }));
      ctx.engine = null;
      ctx.profileId = null;
      picker();
    });
  }
  for (const operation of ["reset", "remove"])
    action(operation, async () => {
      if (
        !(await dialog({
          title: operation === "reset" ? "Reset progress?" : "Remove this learner?",
          body: `${operation === "reset" ? "Reset progress for" : "Remove"} ${s.name}? ${resetHint}`,
          confirmLabel: operation === "reset" ? "Reset" : "Remove",
          danger: true,
        }))
      )
        return;
      await mutate(() => trainer.manageProfile(ctx.profileId, operation));
      if (operation === "remove") {
        ctx.profileId = null;
        picker();
      } else await navigate("home");
    });
}
