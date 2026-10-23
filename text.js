export function normalizeText(text) {
  return text
    .split("\n")
    .map((line) => line.split(/\s+/).filter(Boolean).join(" "))
    .join("\n")
    .trim();
}

export function joinPieces(...parts) {
  const nonempty = parts.map(normalizeText).filter(Boolean);
  if (nonempty.some((part) => part.includes("\n"))) {
    return normalizeText(nonempty.join("\n"));
  }
  const tokens = [];
  for (const part of nonempty) {
    let nextTokens = part.split(" ");
    if (tokens.length && nextTokens.length && tokens.at(-1) === nextTokens[0]) {
      nextTokens = nextTokens.slice(1);
    }
    tokens.push(...nextTokens);
  }
  return tokens.join(" ");
}

export function rotateWords(text) {
  text = normalizeText(text);
  if (text.includes("\n")) {
    const lines = text.split("\n");
    return normalizeText([...lines.slice(1), lines[0]].join("\n"));
  }
  const words = text.split(" ");
  if (words.length < 2) return text;
  return [...words.slice(1), words[0]].join(" ");
}

export const MIN_LESSON_LENGTH = 100;

export function shorterLessonText(text) {
  text = normalizeText(text);
  for (let end = MIN_LESSON_LENGTH; end < text.length; end++) {
    if (/\s/.test(text[end]) && text.slice(0, end).trimEnd().length >= MIN_LESSON_LENGTH)
      return text.slice(0, end).trimEnd();
  }
  return text;
}

export function ensureLength(
  text,
  filler = "",
  { minimum_length: minimumLength = MIN_LESSON_LENGTH } = {},
) {
  text = normalizeText(text);
  filler = normalizeText(filler);
  if (!text) {
    text = filler;
    filler = "";
  }
  const chunks = text ? [text] : [];
  const pool = [filler, text].filter(Boolean);
  let seen = 0;
  while (pool.length && joinPieces(...chunks).length < minimumLength) {
    let candidate = pool[seen % pool.length];
    seen += 1;
    if (chunks.length && candidate === chunks.at(-1)) {
      candidate = rotateWords(candidate);
    }
    if (!candidate || (chunks.length && candidate === chunks.at(-1))) {
      if (seen > pool.length * 4) break;
      continue;
    }
    chunks.push(candidate);
    if (seen > 24) break;
  }
  return chunks.length ? joinPieces(...chunks) : "";
}

export function repeatText(
  text,
  count,
  { minimum_length: minimumLength = 0 } = {},
) {
  text = normalizeText(text);
  if (!text) return "";
  count = Math.max(
    count,
    Math.floor((minimumLength + text.length + 1) / (text.length + 1)),
  );
  return Array.from({ length: count }, () => text).join(" ");
}
