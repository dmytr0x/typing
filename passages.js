import { $, action, dialog, esc, notify } from "./ui.js";
import { ctx, mutate, profile } from "./api.js";
import { trainer } from "./trainer.js";
import { normalizeText } from "./text.js";
import { uid } from "./validate.js";

export function textPreview(text) {
  const normalized = normalizeText(text);
  const unsupported = [...new Set([...text].filter((c) => c !== "\n" && !(c >= " " && c <= "~") && !/\s/.test(c)))];
  // Tabs and CR are normalized to spaces/line endings; non-ASCII whitespace is shown too.
  return { normalized, unsupported, changed: normalized !== text };
}

export function passageEditor() {
  return `<section class="card"><h2>Your own words</h2><p>Custom practice stays separate from course unlocks. Save up to 20 passages, 10,000 characters each (100,000 total).</p>
    <form id="custom-form"><label>Passage title<input id="passage-title" maxlength="80" placeholder="Name this passage"></label>
    <label>Passage<textarea id="custom-text" maxlength="10000" placeholder="A story, a note, or something you want to learn…"></textarea></label>
    <p id="text-preview" role="status"></p><details><summary>Normalized text preview</summary><pre id="normalized-text"></pre></details>
    <div class="actions"><button id="custom">Practice this text</button><button type="button" id="save-passage">Save passage</button></div></form>
    <h3>Saved passages</h3><div id="passage-library"></div></section>`;
}

export function connectPassages(start) {
  const owner = ctx.profileId;
  const library = $("#passage-library");
  let editing = null, timer;
  const draftKey = `hearth-editor:${trainer.kind}:${owner}`;
  let localDraft = null;
  try {
    localDraft = localStorage.getItem(draftKey);
    $("#passage-title").value = localStorage.getItem(draftKey + ":title") || "";
  } catch { /* no browser storage */ }
  $("#custom-text").value = localDraft ?? profile().learning.custom_draft;
  const saveDraft = () => {
    const text = $("#custom-text").value;
    try { localStorage.setItem(draftKey, text); localStorage.setItem(draftKey + ":title", $("#passage-title").value); } catch { /* server draft still available */ }
    clearTimeout(timer);
    timer = setTimeout(() => mutate(() => trainer.updateLearning(owner, { custom_draft: text }), `draft:${owner}`).catch((e) => notify(e.message)), 400);
  };
  const preview = () => {
    const p = textPreview($("#custom-text").value);
    $("#text-preview").textContent = p.unsupported.length
      ? `Replace unsupported characters: ${p.unsupported.join(" ")}. Use US keyboard letters, symbols and Enter.`
      : `${p.normalized.length} characters. ${p.changed ? "Extra whitespace will be normalized; preview below." : "Ready for practice."}`;
    $("#normalized-text").textContent = p.normalized;
    $("#custom").disabled = !p.normalized || p.unsupported.length > 0;
    return p;
  };
  $("#custom-text").oninput = () => { preview(); saveDraft(); };
  $("#passage-title").oninput = saveDraft;
  $("#custom-form").onsubmit = async (event) => {
    event.preventDefault();
    const p = preview(); if (p.unsupported.length || !p.normalized) return;
    $("#custom").disabled = true;
    try {
      clearTimeout(timer);
      await mutate(() => trainer.updateLearning(owner, { custom_draft: $("#custom-text").value }), `draft:${owner}`);
      await start({ kind: "custom", text: p.normalized });
    } catch (e) { notify(e.message); }
    finally { if ($("#custom")) preview(); }
  };
  action("save-passage", async () => {
    const text = $("#custom-text").value, title = $("#passage-title").value.trim();
    if (!title || !text.trim()) throw new Error("Give the passage a title and some text.");
    await mutate(() => {
      const passages = [...ctx.state.profiles[owner].learning.passages];
      const index = passages.findIndex((p) => p.id === editing);
      const row = { id: editing || uid(), title, text, favorite: passages[index]?.favorite || false };
      if (index >= 0) passages[index] = row; else passages.push(row);
      return trainer.updateLearning(owner, { passages, custom_draft: text });
    });
    if (library.isConnected) { editing = null; $("#passage-title").value = ""; draw(); }
  });
  function draw() {
    if (!library.isConnected) return;
    $("#passage-library").innerHTML = [...profile().learning.passages]
      .sort((a, b) => Number(b.favorite) - Number(a.favorite))
      .map((p) => `<article class="passage-row"><strong>${esc(p.title)}</strong><span>${p.text.length} characters</span>
        <button data-passage="${esc(p.id)}" data-op="practice">Practice again</button>
        <button data-passage="${esc(p.id)}" data-op="edit">Edit</button>
        <button data-passage="${esc(p.id)}" data-op="favorite" aria-pressed="${p.favorite}">${p.favorite ? "Unfavorite" : "Favorite"}</button>
        <button data-passage="${esc(p.id)}" data-op="delete">Delete</button></article>`).join("") || "<p>No saved passages yet.</p>";
    document.querySelectorAll("[data-passage]").forEach((button) => {
      button.onclick = async () => {
        if (button.disabled) return; button.disabled = true;
        try {
          const row = profile().learning.passages.find((p) => p.id === button.dataset.passage);
          const op = button.dataset.op;
          if (op === "edit" || op === "practice") {
            editing = row.id; $("#passage-title").value = row.title; $("#custom-text").value = row.text;
            const p = preview(); saveDraft(); $("#custom-text").focus();
            if (op === "practice" && !p.unsupported.length) await start({ kind: "custom", text: p.normalized });
          } else {
            if (op === "delete" && !await dialog({ title: "Delete this passage?", body: row.title, confirmLabel: "Delete", danger: true })) return;
            await mutate(() => trainer.updateLearning(owner, { passages: ctx.state.profiles[owner].learning.passages
              .filter((p) => op !== "delete" || p.id !== row.id)
              .map((p) => p.id === row.id ? { ...p, favorite: !p.favorite } : p) }));
            draw();
          }
        } catch (e) { notify(e.message); }
        finally { if (button.isConnected) button.disabled = false; }
      };
    });
  }
  preview(); draw();
}
