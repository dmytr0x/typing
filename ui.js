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
  if (element)
    element.addEventListener("click", () =>
      Promise.resolve()
        .then(handler)
        .catch((error) => notify(error.message)),
    );
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
    root.hidden = false;
    root.innerHTML = `<div class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><h2 id="dialog-title">${esc(title)}</h2><p>${esc(body)}</p><div class="actions"><button id="dialog-cancel">${esc(cancelLabel)}</button><button id="dialog-ok" class="${danger ? "danger" : "primary"}">${esc(confirmLabel)}</button></div></div>`;
    const finish = (value) => {
      root.hidden = true;
      root.innerHTML = "";
      resolve(value);
    };
    $("#dialog-ok").onclick = () => finish(true);
    $("#dialog-cancel").onclick = () => finish(false);
    $("#dialog-ok").focus();
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
  $("meta[name=theme-color]")?.setAttribute("content", dark ? "#1c1d2e" : "#faf7f2");
}

export function timezoneSelect(selected) {
  const zones = Intl.supportedValuesOf
    ? Intl.supportedValuesOf("timeZone")
    : [selected || "UTC"];
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
