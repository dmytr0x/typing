import { $, action, applyTheme, dialog, esc, notify, timezoneSelect } from "./ui.js";
import { ctx, download, mutate, profile, coordinator, readDraft, clearDraft } from "./api.js";
import { trainer, storageLocation } from "./trainer.js";
import { validatePending } from "./validate.js";

let navigate = async () => {};
let picker = () => {};
export function connect(handlers) { navigate = handlers.navigate; picker = handlers.picker; }

export function backupName(learnerName = "household", date = new Date()) {
  const name = learnerName.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 40) || "learner";
  return `hearth-${name}-${date.toISOString().replace(/[:.]/g, "-")}.json`;
}

export function settingsView() {
  const s = { ...profile().settings, ...ctx.pendingSettings[ctx.profileId] }, local = trainer.kind === "local", owner = ctx.profileId;
  const number = (key, label, min, max) => `<label>${label}<input name="${key}" type="number" min="${min}" max="${max}" value="${s[key]}"></label>`;
  const check = (key, label) => `<label><input name="${key}" type="checkbox" ${s[key] ? "checked" : ""}>${label}</label>`;
  const exportKey = `hearth-export:${trainer.kind}:${owner}`;
  let lastExport = null;
  try { lastExport = localStorage.getItem(exportKey); } catch { /* optional reminder */ }
  $("#main").innerHTML = `<div class="eyebrow">A comfortable fit</div><h1>Your space, your pace.</h1>
    <section class="card"><h2>Learning</h2><form id="settings-form"><div class="grid">
    <label>Nickname<input name="name" value="${esc(s.name)}" required maxlength="32"></label>
    <label>Companion<select name="avatar">${["🌿", "🦊", "🐳", "🌙", "🌻", "🐢"].map((a) => `<option ${a === s.avatar ? "selected" : ""}>${a}</option>`).join("")}</select></label>
    <label>Reading band<select name="band"><option value="child" ${s.band === "child" ? "selected" : ""}>Ages 10+</option><option value="adult" ${s.band === "adult" ? "selected" : ""}>Adult</option></select></label>
    ${number("daily_minutes", "Daily minutes", 1, 60)}</div>${check("hints", "Show finger hints")}${check("sound", "Typing sounds")}${check("quiet_practice", "Quiet practice · hide live speed and pace praise")}${check("short_exercises", "Shorter exercises")}
    <p class="small">Course lessons need at least 100 character submissions. Pause for a rest anytime. A shorter retry appears only when it really reduces the exercise.</p>
    <details><summary>Advanced learning choices</summary><div class="grid">${number("speed_goal", "Personal speed goal", 10, 120)}${number("assessment_seconds", "Assessment seconds", 30, 300)}<label>Timezone<select name="timezone">${timezoneSelect(s.timezone)}</select></label></div></details>
    <h2>Appearance</h2><div class="grid">${number("font_size", "Text size", 18, 40)}<label>Theme<select name="theme">${[["system", "Match the computer"], ["light", "Warm light"], ["dark", "Quiet dark"]].map(([value, label]) => `<option value="${value}" ${s.theme === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><label>Typeface<select name="font"><option value="default" ${s.font === "default" ? "selected" : ""}>Rounded default</option><option value="readable" ${s.font === "readable" ? "selected" : ""}>Wider system fonts</option></select></label></div>${check("reduced_motion", "Reduce motion")}
    <h2>Backup reminders</h2>${check("backup_reminder", "Remind me to export a backup after a week")}
    <p class="small">Keyboard: US QWERTY · English. Settings save when changed.</p><span id="settings-saved" role="status"></span><button type="button" id="settings-reconnect" hidden>Reconcile pending settings</button></form></section>
    <section class="card"><h2>Backups and storage</h2><p><strong>Active storage:</strong> ${esc(storageLocation())} <span id="storage-path"></span></p>
    <p>Last export for this learner: <span id="last-export">${lastExport ? esc(new Date(lastExport).toLocaleString()) : "No export recorded on this browser"}</span>. Downloads stay wherever you save them.</p>
    <div class="actions"><button id="export-learner">Export this learner</button><button id="export-household">Export household</button></div>
    ${local ? '<p>Private windows, browser data removal and eviction can lose progress. Persistent storage reduces eviction; it is not a backup.</p><button id="persistent-storage">Request persistent browser storage</button><p id="persistence-status" role="status"></p>' : '<p>A local archive is kept before imports, resets and removals.</p>'}
    <label>Import a backup<input id="import-file" type="file" accept=".json,application/json"></label><label>Import mode<select id="import-mode"><option value="new">Add as a new learner</option><option value="replace">Replace current learner</option><option value="household">Replace entire household</option></select></label><button id="preview-import">Preview import</button><div id="import-preview"></div>
    <details><summary>Saved archives</summary><button id="list-archives">Browse archives</button><div id="archives"></div></details></section>
    <section class="card"><h2>Restore unfinished typing</h2><p>A pending-attempt file restores only its original saved learner and exercise. Restore the matching household backup first if necessary; completed attempts cannot earn progress twice.</p><label>Pending attempt<input id="pending-file" type="file" accept=".json,application/json"></label><button id="restore-pending">Restore pending attempt</button>${readDraft(owner) ? '<button id="restore-local-draft">Restore local pending draft</button><button id="export-local-draft">Export local pending draft</button><button id="discard-local-draft">Discard local pending draft</button>' : ""}</section>
    <div class="actions"><button id="reset" class="danger">Reset this learner’s progress</button><button id="remove" class="danger">Remove this learner</button></div>`;
  if (!local) trainer.getStorageLocation().then((value) => { if ($("#storage-path")) $("#storage-path").textContent = value.location; }).catch((e) => notify(e.message));
  const pending = ctx.pendingSettings[owner] ||= {};
  const capture = (event) => {
    const input = event.target, key = input.name;
    if (!key) return;
    pending[key] = input.type === "checkbox" ? input.checked
      : ["daily_minutes", "speed_goal", "assessment_seconds", "font_size"].includes(key) ? Number(input.value) : input.value;
    ctx.editingSettings = true;
  };
  async function savePending() {
    await mutate(async () => {
      const snapshot = { ...pending };
      const state = await trainer.updateProfile(owner, { ...ctx.state.profiles[owner].settings, ...snapshot });
      for (const key of Object.keys(snapshot)) if (pending[key] === snapshot[key]) delete pending[key];
      ctx.editingSettings = Object.keys(pending).length > 0;
      return state;
    }, `settings:${owner}`);
    if ($("#settings-saved")) $("#settings-saved").textContent = "Settings saved";
    applyTheme(profile());
  }
  $("#settings-form").oninput = capture;
  $("#settings-form").onchange = async (event) => {
    capture(event);
    if (!$("#settings-form").reportValidity()) return;
    try { await savePending(); }
    catch (e) { notify(e.message); if ($("#settings-reconnect")) $("#settings-reconnect").hidden = false; }
  };
  action("settings-reconnect", async () => {
    await coordinator.tail; ctx.state = await trainer.getState(); ctx.needsReconciliation = false;
    await savePending();
    $("#settings-reconnect").hidden = true;
    $("#reconnect-household").hidden = true;
  });
  if (Object.keys(pending).length) $("#settings-reconnect").hidden = false;
  $("#settings-form").onsubmit = (event) => event.preventDefault();
  for (const scope of ["learner", "household"]) action(`export-${scope}`, async () => {
    const data = await trainer.exportState(scope === "learner" ? owner : null);
    download(backupName(scope === "learner" ? profile().settings.name : "household"), data);
    const at = new Date().toISOString();
    try { localStorage.setItem(exportKey, at); } catch { /* reminder optional */ }
    $("#last-export").textContent = new Date(at).toLocaleString();
  });
  action("persistent-storage", async () => {
    $("#persistence-status").textContent = !navigator.storage?.persist ? "This browser does not support persistent storage. Keep JSON backups." : await navigator.storage.persist() ? "Persistent storage granted. Keep exporting backups." : "Persistence was not granted. Keep exporting backups.";
  });
  action("preview-import", previewImport);
  for (const id of ["import-file", "import-mode"]) $("#" + id).onchange = () => { if ($("#import-file").files[0]) previewImport().catch((e) => notify(e.message)); };
  async function previewImport() {
    const file = $("#import-file").files[0];
    if (!file || file.size > 10000000) throw new Error("Choose a JSON backup smaller than 10 MB.");
    await showPreview({ data: await file.text(), mode: $("#import-mode").value, target: owner });
  }
  async function showPreview(body) {
    const preview = await trainer.importState(body);
    $("#import-preview").innerHTML = `<div class="banner"><p>Learners: ${preview.profiles.map(esc).join(", ")}<br>Replaces: ${esc(preview.replaces)}</p><button id="confirm-import">Confirm import</button></div>`;
    action("confirm-import", async () => {
      if (!await dialog({ title: "Import this backup?", body: `Learners: ${preview.profiles.join(", ")}. Replaces: ${preview.replaces}. A validated archive is kept first.`, confirmLabel: "Import", danger: body.mode !== "new" })) return;
      await mutate(() => trainer.importState({ ...body, confirm: true }));
      ctx.engine = null; ctx.profileId = null; ctx.sessionPlan = []; ctx.pendingSettings = {}; ctx.editingSettings = false; await picker();
    });
  }
  action("list-archives", async () => {
    const rows = await trainer.archives();
    $("#archives").innerHTML = rows.map((r) => `<p>${esc(r.at)} · ${r.profiles.map(esc).join(", ")} <button data-archive="${esc(r.id)}">Preview restore</button></p>`).join("") || "No archives yet.";
    document.querySelectorAll("[data-archive]").forEach((b) => b.onclick = async () => {
      try { await showPreview({ data: JSON.stringify(await trainer.archiveState(b.dataset.archive)), mode: "household" }); }
      catch (e) { notify(e.message); }
    });
  });
  async function restore(raw) {
    const pending = validatePending(raw);
    if (!await dialog({ title: "Restore pending typing?", body: `Restore exercise ${pending.attempt.id} for its original learner? Saved history must match.`, confirmLabel: "Restore" })) return;
    await mutate(() => trainer.restorePending(pending)); clearDraft(raw.attempt); await navigate("home");
  }
  action("restore-pending", async () => {
    const file = $("#pending-file").files[0];
    if (!file || file.size > 10000000) throw new Error("Choose a pending-attempt JSON file smaller than 10 MB.");
    await restore(JSON.parse(await file.text()));
  });
  action("restore-local-draft", () => restore(readDraft(owner)));
  action("export-local-draft", () => download(backupName(`${s.name}-pending`), readDraft(owner)));
  action("discard-local-draft", async () => {
    if (await dialog({ title: "Discard local draft?", body: "Unacknowledged typing in this draft will be removed. Saved progress stays intact.", danger: true, confirmLabel: "Discard" })) { clearDraft(readDraft(owner).attempt); settingsView(); }
  });
  for (const operation of ["reset", "remove"]) action(operation, async () => {
    if (!await dialog({ title: operation === "reset" ? "Reset progress?" : "Remove this learner?", body: `${s.name}: a recoverable archive is kept first.`, confirmLabel: operation === "reset" ? "Reset" : "Remove", danger: true })) return;
    await mutate(() => trainer.manageProfile(owner, operation));
    if (operation === "remove") { ctx.profileId = null; await picker(); } else await navigate("home");
  });
}
