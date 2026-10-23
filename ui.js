export const $ = (selector) => document.querySelector(selector);
export const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );

let noticeTimer;
export function notify(message) {
  $("#notice").textContent = message;
  $("#notice").style.display = "block";
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => ($("#notice").style.display = "none"), 6500);
}
export function clearNotice() {
  clearTimeout(noticeTimer);
  $("#notice").style.display = "none";
}
export function status(message) {
  $("#save-status").textContent = message;
}
export function action(id, handler) {
  const element = $("#" + id);
  if (element) {
    element.tabIndex = 0;
    element.addEventListener("click", async () => {
      if (element.disabled || element.dataset.busy) return;
      element.dataset.busy = "true";
      element.setAttribute("aria-disabled", "true");
      element.focus({ preventScroll: true });
      try { await handler(); } catch (error) { notify(error.message); }
      finally { if (element.isConnected) { delete element.dataset.busy; element.removeAttribute("aria-disabled"); } }
    });
  }
}

export function keyboardAccess() {
  document.querySelectorAll("button, summary, a[href]").forEach((control) => {
    if (!control.hasAttribute("tabindex")) control.tabIndex = 0;
  });
}

export function dialog({
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const root = $("#dialog");
    const invoking = document.activeElement;
    const surfaces = [...document.body.children].filter((el) => el !== root);
    const prior = surfaces.map((el) => el.inert);
    surfaces.forEach((el) => el.inert = true);
    root.hidden = false;
    root.innerHTML = `<div class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><h2 id="dialog-title">${esc(title)}</h2><p>${esc(body)}</p><div class="actions"><button id="dialog-cancel">${esc(cancelLabel)}</button><button id="dialog-ok" class="${danger ? "danger" : "primary"}">${esc(confirmLabel)}</button></div></div>`;
    const finish = (value) => {
      root.hidden = true;
      root.innerHTML = "";
      root.removeEventListener("keydown", keys);
      surfaces.forEach((el, i) => el.inert = prior[i]);
      if (invoking?.isConnected) {
        invoking.focus({ preventScroll: true });
        requestAnimationFrame(() => { if (invoking.isConnected && root.hidden) invoking.focus({ preventScroll: true }); });
      }
      else $("#main")?.focus();
      resolve(value);
    };
    const keys = (event) => {
      if (event.key === "Escape") { event.preventDefault(); finish(false); }
      if (event.key === "Tab") {
        event.preventDefault();
        const next = document.activeElement === $("#dialog-ok") ? $("#dialog-cancel") : $("#dialog-ok");
        next.focus();
      }
    };
    root.addEventListener("keydown", keys);
    $("#dialog-ok").onclick = () => finish(true);
    $("#dialog-cancel").onclick = () => finish(false);
    $(danger ? "#dialog-cancel" : "#dialog-ok").focus();
  });
}

export function applyTheme(profile) {
  const root = document.documentElement;
  const theme = profile?.settings.theme || "system";
  const dark =
    theme === "dark" ||
    (theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  root.dataset.theme = dark ? "dark" : "light";
  document.body.classList.toggle("readable-font", profile?.settings.font === "readable");
  document.body.classList.toggle("no-motion", !!profile?.settings.reduced_motion);
  $("meta[name=theme-color]")?.setAttribute("content", getComputedStyle(root).getPropertyValue("--page").trim());
}

export function timezoneSelect(selected) {
  const zones = Intl.supportedValuesOf
    ? Intl.supportedValuesOf("timeZone")
    : [selected || "UTC"];
  if (selected && !zones.includes(selected)) zones.unshift(selected);
  const groups = {};
  for (const zone of zones) {
    const region = zone.split("/")[0];
    (groups[region] ??= []).push(zone);
  }
  return Object.entries(groups)
    .map(
      ([region, items]) =>
        `<optgroup label="${esc(region)}">${items
          .map(
            (zone) =>
              `<option value="${esc(zone)}" ${zone === selected ? "selected" : ""}>${esc(zone)}</option>`,
          )
          .join("")}</optgroup>`,
    )
    .join("");
}

const LEFT = "qwertasdfgzxcvb";
export function oppositeShift(character) {
  if (!character || character === character.toLowerCase()) return "";
  return LEFT.includes(character.toLowerCase()) ? "right" : "left";
}

export function keyLabel(key) {
  if (key === " ") return "Space";
  if (key === "\n") return "Enter";
  return key;
}

export function attemptTitle(attemptOrResult) {
  if (!attemptOrResult) return "Practice";
  if (attemptOrResult.title) return attemptOrResult.title;
  if (attemptOrResult.finger)
    return `${attemptOrResult.finger} finger`;
  return attemptOrResult.kind || "Practice";
}

export function fingerSession(finger) {
  return [0, 1, 2].map((phase) => ({ kind: "finger", finger, phase }));
}
