export const SOUND_FILES = {
  error: new URL("sounds/error.mp3", import.meta.url).href,
  typewriter: new URL("sounds/typewriter.mp3", import.meta.url).href,
};

export function soundForStroke({ recorded, wrongIncreased, bufferChanged }) {
  if (!recorded) return null;
  if (wrongIncreased) return "error";
  if (bufferChanged) return "typewriter";
  return null;
}

export function playTypingSound(kind) {
  const src = SOUND_FILES[kind];
  if (!src || typeof Audio === "undefined") return;
  const audio = new Audio(src);
  audio.volume = 0.45;
  void audio.play().catch(() => {});
}

export function preloadSounds() {
  if (typeof Audio === "undefined") return;
  for (const src of Object.values(SOUND_FILES)) new Audio(src);
}
