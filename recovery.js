import { $, action, dialog, esc, notify } from "./ui.js";
import { trainer, storageLocation } from "./trainer.js";
import { ctx, mutate, readDraft, clearDraft } from "./api.js";
import { validatePending } from "./validate.js";

export async function offerDraft() {
  const pending = readDraft(ctx.profileId);
  if (!pending) return;
  const p = ctx.state.profiles[ctx.profileId];
  if (p.attempts.concat(p.assessment_history).some((r) => r.id === pending.attempt?.id)) {
    clearDraft(pending.attempt); return;
  }
  const restore = await dialog({ title: "Unfinished typing was kept on this computer",
    body: "Restore this learner’s pending keystrokes? Choosing Keep for later leaves the draft available in Settings.",
    confirmLabel: "Restore pending work", cancelLabel: "Keep for later" });
  if (restore) {
    try {
    await mutate(() => trainer.restorePending(validatePending(pending)));
    clearDraft(pending.attempt);
    } catch (e) { notify(e.message); }
  }
}

export function startupRecovery(error) {
  $("#main").innerHTML = `<section class="card"><h1>Your progress needs attention.</h1>
    <p>${esc(error.message)}</p><p><strong>Storage:</strong> ${esc(storageLocation())}</p>
    <p>No progress has been reset. Keep your household files or browser data intact.</p>
    <button id="reload" class="primary">Try again</button>
    ${error.recovery && trainer ? '<button id="recover">Restore last valid backup</button><label>Import a household backup<input id="recovery-file" type="file" accept=".json,application/json"></label><button id="recovery-preview">Preview backup</button><div id="recovery-preview-result"></div>' : ""}</section>`;
  action("reload", () => location.reload());
  action("recover", async () => {
    if (!await dialog({ title: "Restore the previous household?", body: "The previous valid backup replaces the damaged or missing household. Damaged data is retained.", confirmLabel: "Restore backup", danger: true })) return;
    await trainer.recover(); location.reload();
  });
  action("recovery-preview", async () => {
    const file = $("#recovery-file").files[0];
    if (!file || file.size > 10000000) throw new Error("Choose a household JSON backup smaller than 10 MB.");
    const data = await file.text(), preview = await trainer.recoverImport(data);
    $("#recovery-preview-result").innerHTML = `<p>Learners: ${preview.profiles.map(esc).join(", ")}. Replaces: entire household.</p><button id="recovery-confirm">Restore this household</button>`;
    action("recovery-confirm", async () => {
      if (!await dialog({ title: "Restore this household?", body: "Replace the damaged household with the learners shown in the preview? Damaged data will be retained.", confirmLabel: "Restore", danger: true })) return;
      await trainer.recoverImport(data, true); location.reload();
    });
  });
  $("#main").focus();
}
