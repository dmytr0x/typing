// A missing dependency must produce a recoverable page before any storage opens.
try {
  await import("./app.js?v=16");
} catch (error) {
  const main = document.querySelector("#main");
  main.replaceChildren();
  const heading = document.createElement("h1"); heading.textContent = "This release could not load.";
  const detail = document.createElement("p"); detail.textContent = `${error.message} Your household and pending drafts have not been reset. Keep browser storage intact and retry when the complete release is available.`;
  const retry = document.createElement("button"); retry.textContent = "Try again"; retry.onclick = () => location.reload();
  main.append(heading,detail,retry);
}
