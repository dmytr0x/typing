import { ensureLength } from "./text.js";

// Keep this deterministic policy in step with ukrainian.practice_text.
export function ukrainianPractice(focus, allowed, words, sentences, phase) {
  const keys = [...new Set([...focus].filter(c => !" \n".includes(c)))];
  let support = [...allowed].filter(c => !" \n".includes(c));
  if (!support.length) support = keys;
  const active = keys.length ? keys : support;
  const tokens = [];
  for (let i = 0; i < 42; i++) {
    const a = active[(i + phase) % active.length];
    const b = active[(Math.floor(i / active.length) + i + phase + 1) % active.length];
    const c = support[(i * 3 + phase) % support.length];
    tokens.push([a, a + b, b + a + c][(i + phase) % 3]);
  }
  const drill = tokens.join(" ");
  const usable = words.filter(word => [...word].every(c => allowed.includes(c)));
  const reading = sentences.filter(line => [...line].every(c => allowed.includes(c)));
  const rank = item => keys.reduce((sum, c) => sum + Number(item.includes(c)), 0);
  usable.sort((a, b) => rank(b) - rank(a));
  reading.sort((a, b) => rank(b) - rank(a));
  const pool = phase >= 3 && reading.length ? reading : usable;
  let body;
  if ((phase === 0 && keys.length) || !pool.length) {
    body = drill;
  } else {
    const start = (phase * 3) % pool.length;
    const ordered = [...pool.slice(start), ...pool.slice(0, start)];
    const picked = [];
    for (const item of ordered) {
      picked.push(item);
      if (picked.join(" ").length >= 160) break;
    }
    body = picked.join(" ");
    for (const character of keys) {
      if (!body.includes(character)) body += " " + (pool.find(item => item.includes(character)) || character);
    }
  }
  if (focus.includes("\n") && !body.includes("\n")) {
    const split = body.indexOf(" ", Math.floor(body.length / 2));
    if (split >= 0) body = body.slice(0, split) + "\n" + body.slice(split + 1);
  }
  return ensureLength(body, drill);
}
