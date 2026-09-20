export function holdingError(text, mode, buffer) {
  return Boolean(
    mode === "guided" &&
      buffer.length &&
      buffer[buffer.length - 1] !== text[buffer.length - 1],
  );
}

// The server replays this same character contract before acknowledging results.
export function replay(text, mode, events, elapsed) {
  const buffer = [],
    first = [];
  let wrong = 0,
    corrections = 0;
  for (const event of events) {
    if (event.key === "Backspace") {
      if (buffer.length) {
        buffer.pop();
        corrections++;
      }
      continue;
    }
    if (buffer.length >= text.length) continue;
    if (holdingError(text, mode, buffer)) continue;
    const position = buffer.length,
      correct = event.key === text[position];
    if (first[position] === undefined) first[position] = correct;
    if (!correct) wrong++;
    buffer.push(event.key);
  }
  const correct = buffer.filter((char, index) => char === text[index]).length;
  return {
    buffer: buffer.join(""),
    accuracy: first.length
      ? (first.filter(Boolean).length / first.length) * 100
      : 0,
    wrong,
    corrections,
    correct,
    wpm: elapsed >= 5000 && correct >= 10 ? liveWpm(correct, elapsed) : null,
    complete: buffer.join("") === text,
    attempted: first.length,
    first,
  };
}

export function liveWpm(correct, elapsed) {
  return elapsed >= 500 && correct >= 1 ? (correct * 12000) / elapsed : null;
}

export function letterState(text, result, index) {
  const cursor = result.buffer.length;
  if (index === cursor) return "cursor";
  if (index > cursor) return "";
  if (result.buffer[index] !== text[index]) return "wrong";
  if (result.first[index] === false) return "corrected";
  return "correct";
}

export function timings(text, mode, events) {
  const ms = [],
    dt = [];
  const buffer = [];
  let last = 0;
  for (const event of events) {
    if (event.key === "Backspace") {
      if (buffer.length) {
        buffer.pop();
        ms.pop();
        dt.pop();
        last = ms.at(-1) || 0;
      }
      continue;
    }
    if (buffer.length >= text.length) continue;
    if (holdingError(text, mode, buffer)) continue;
    dt.push(event.ms - last);
    ms.push(event.ms);
    buffer.push(event.key);
    last = event.ms;
  }
  return { ms, dt };
}

export class Engine {
  constructor(attempt, onChange, onFinish) {
    this.attempt = structuredClone(attempt);
    this.events = [...attempt.events];
    this.elapsed = attempt.elapsed_ms;
    this.running = false;
    this.paused = attempt.paused || attempt.events.length > 0;
    this.ready = !this.paused && this.events.length === 0 && this.elapsed === 0;
    this.onChange = onChange;
    this.onFinish = onFinish;
    this.finished = false;
    this.lastStart = null;
  }
  milliseconds() {
    return Math.min(
      this.attempt.duration ? this.attempt.duration * 1000 : 3600000,
      this.elapsed + (this.running ? performance.now() - this.lastStart : 0),
    );
  }
  snapshot() {
    return {
      events: this.events.slice(),
      elapsed_ms: Math.floor(this.milliseconds()),
      status: this.running ? "running" : "paused",
      paused: this.paused,
    };
  }
  result() {
    return replay(
      this.attempt.text,
      this.attempt.mode,
      this.events,
      this.milliseconds(),
    );
  }
  resume() {
    if (this.finished || this.running) return;
    this.ready = false;
    this.running = true;
    this.lastStart = performance.now();
    this.onChange();
  }
  pause() {
    if (!this.running) return;
    this.elapsed = this.milliseconds();
    this.running = false;
    this.paused = true;
    this.onChange();
  }
  tick() {
    if (
      this.running &&
      this.attempt.duration &&
      this.milliseconds() >= this.attempt.duration * 1000
    )
      this.finish();
  }
  finish() {
    if (this.finished) return;
    this.elapsed = this.milliseconds();
    this.running = false;
    this.finished = true;
    this.onChange();
    this.onFinish();
  }
  key(event) {
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.isComposing ||
      event.repeat ||
      this.finished
    )
      return;
    if (
      [
        "Tab",
        "Control",
        "Meta",
        "Alt",
        "Dead",
        "Unidentified",
      ].includes(event.key)
    )
      return;
    if (event.key === "Escape") {
      event.preventDefault();
      this.pause();
      return;
    }
    if (!this.running) this.resume();
    const key = event.key === "Enter" ? "\n" : event.key;
    if (
      key !== "Backspace" &&
      (key.length !== 1 ||
        (key !== "\n" && (key.charCodeAt(0) < 32 || key.charCodeAt(0) > 126)))
    )
      return;
    event.preventDefault();
    if (!this.running) return;
    if (
      this.attempt.duration &&
      this.milliseconds() >= this.attempt.duration * 1000
    ) {
      this.finish();
      return;
    }
    const current = this.result();
    if (
      key !== "Backspace" &&
      (current.buffer.length >= this.attempt.text.length ||
        holdingError(this.attempt.text, this.attempt.mode, current.buffer))
    )
      return;
    this.events.push({ key, ms: Math.floor(this.milliseconds()) });
    this.onChange();
    if (this.result().complete) this.finish();
  }
}
